// KDX 브랜드 판정 — Vercel 서버리스 함수 (v0.51 1단계: 텍스트 판정)
// POST /api/judge  body: { host, candidates:[{hex,src,count,source}], gradients:[{css,seed}], fonts:[], shape:{} }
// 응답: { ok:true, verdict:{primary,gradient,radius,density,font,confidence,why} } | { ok:false, reason }
//
// 설계 원칙(설계문서 v0.51 §3):
//  - 에이전트는 새 색을 만들지 않는다. 이미 수집된 후보 배열의 "인덱스"와 enum만 답한다.
//  - 서버가 모든 필드를 검증한다. 하나라도 어긋나면 전체를 버리고 ok:false → 클라이언트는 규칙 판정 유지.
//  - ANTHROPIC_API_KEY가 없으면 200 + reason:'judge-disabled' — 클라이언트가 이 층을 영구 비활성화한다.
//  - ingest와 분리한 이유: ingest는 결정적·캐시 가능, judge는 비결정적·유료. 북마클릿/파일/텍스트 경로도 여기만 부른다.

const MODEL = process.env.JUDGE_MODEL || 'claude-haiku-4-5';
const API = 'https://api.anthropic.com/v1/messages';
const RADIUS = ['sharp', 'default', 'rounded'];
const DENSITY = ['compact', 'default', 'comfortable'];
const CONF = ['high', 'mid', 'low'];

const SYSTEM = `당신은 브랜드 아이덴티티 분석가입니다. 어떤 사이트에서 기계적으로 수집한 색·그라디언트·서체·형태 후보를 받고, 그중 무엇이 그 브랜드의 것인지 판정합니다.

판정 기준:
- 브랜드 색은 로고 마크·주요 CTA·헤더·링크에 반복해서 쓰이는 색입니다.
- 프로모션 배너색, 콘텐츠 썸네일에서 새어나온 색, 차트 팔레트, 상태색(성공 녹색·경고 노랑·오류 빨강), 광고 영역 색은 브랜드 색이 아닙니다.
- 사용 빈도가 높다는 것만으로 브랜드 색이 되지는 않습니다. 그 색이 놓인 자리가 중요합니다.
- 도메인에서 브랜드를 알아볼 수 있다면 알고 있는 그 브랜드의 아이덴티티 색을 근거로 삼으십시오.

엄격한 제약:
- 새로운 색을 제안하지 마십시오. 반드시 주어진 후보 중에서 고르고, 배열 인덱스(0부터)로 답하십시오.
- 서체는 fonts 배열에 있는 문자열을 글자 그대로 하나 고르거나 null.
- 확신이 서지 않으면 confidence를 "low"로 두십시오. 억지로 고르지 마십시오.
- 오직 JSON 객체 하나만 출력하십시오. 설명·코드펜스·머리말 금지.

출력 형식:
{"primary":<정수 인덱스>,"gradient":<정수 인덱스 또는 null>,"radius":"sharp"|"default"|"rounded"|null,"density":"compact"|"default"|"comfortable"|null,"font":<fonts의 문자열 또는 null>,"confidence":"high"|"mid"|"low","why":"<한국어 한 문장, 왜 그 색인지>"}`;

function clampArr(a, n) { return Array.isArray(a) ? a.slice(0, n) : []; }

function buildUser(b) {
  const cands = clampArr(b.candidates, 12).map((c, i) =>
    `${i}. ${c.hex}  출처=${c.src || 'css'}${c.source ? '(' + String(c.source).slice(0, 40) + ')' : ''}${c.count != null ? '  등장=' + c.count : ''}`);
  const grads = clampArr(b.gradients, 8).map((g, i) => `${i}. ${String(g.css || g).slice(0, 160)}`);
  const fonts = clampArr(b.fonts, 8).map(f => String(f).slice(0, 40));
  const sh = b.shape || {};
  return [
    `사이트: ${String(b.host || '(알 수 없음)').slice(0, 80)}`,
    '',
    '색 후보(인덱스 순):',
    cands.length ? cands.join('\n') : '(없음)',
    '',
    '그라디언트 후보:',
    grads.length ? grads.join('\n') : '(없음)',
    '',
    `서체 후보: ${fonts.length ? JSON.stringify(fonts) : '(없음)'}`,
    `형태 측정값: 최빈 곡률=${sh.radiusTop != null ? sh.radiusTop + 'px(' + sh.radiusPct + '%)' : '없음'}, 최빈 여백=${sh.padTop != null ? sh.padTop + 'px(' + sh.padPct + '%)' : '없음'}`,
    '',
    'JSON 하나만 출력하십시오.'
  ].join('\n');
}

// 모델이 코드펜스나 머리말을 붙였을 때도 첫 JSON 객체만 건져낸다.
function firstJson(t) {
  const s = String(t || '');
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}

/* 검증이 이 파일의 핵심이다. 모델 출력은 신뢰하지 않는다.
   primary가 범위를 벗어나면 판정 전체를 버린다(부분 신뢰 금지).
   나머지 필드는 개별적으로 null로 떨어뜨린다 — primary만 맞아도 얻는 값이 있다. */
function validate(v, b) {
  if (!v || typeof v !== 'object') return null;
  const nC = clampArr(b.candidates, 12).length;
  const nG = clampArr(b.gradients, 8).length;
  const fonts = clampArr(b.fonts, 8).map(f => String(f));
  const p = v.primary;
  if (!Number.isInteger(p) || p < 0 || p >= nC) return null;   // 필수 · 실패 시 전체 폐기
  let g = Number.isInteger(v.gradient) && v.gradient >= 0 && v.gradient < nG ? v.gradient : null;
  const out = {
    primary: p,
    gradient: g,
    radius: RADIUS.indexOf(v.radius) >= 0 ? v.radius : null,
    density: DENSITY.indexOf(v.density) >= 0 ? v.density : null,
    font: fonts.indexOf(String(v.font)) >= 0 ? String(v.font) : null,
    confidence: CONF.indexOf(v.confidence) >= 0 ? v.confidence : 'mid',
    why: String(v.why == null ? '' : v.why).replace(/\s+/g, ' ').trim().slice(0, 200)
  };
  return out;
}

async function ask(body, key) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: ctl.signal,
      body: JSON.stringify({
        model: MODEL, max_tokens: 400, temperature: 0, system: SYSTEM,
        messages: [{ role: 'user', content: buildUser(body) }]
      })
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error('upstream ' + r.status + ' ' + String(j && j.error && j.error.message || '').slice(0, 120));
    const txt = (j && j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    return firstJson(txt);
  } finally { clearTimeout(tm); }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return null; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(200).json({ ok: false, reason: 'method' });

  const key = process.env.ANTHROPIC_API_KEY;
  // 키가 없는 배포에서 매번 왕복하지 않도록, 오류가 아니라 "이 층은 꺼져 있다"로 알린다.
  if (!key) return res.status(200).json({ ok: false, reason: 'judge-disabled' });

  try {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.candidates) || !body.candidates.length)
      return res.status(200).json({ ok: false, reason: 'no-candidates' });
    const raw = await ask(body, key);
    const verdict = validate(raw, body);
    if (!verdict) return res.status(200).json({ ok: false, reason: 'schema' });
    res.status(200).json({ ok: true, verdict, model: MODEL });
  } catch (e) {
    // 판정은 선택 층이다 — 실패해도 200으로 조용히 돌려보내고 클라이언트는 규칙 판정을 유지한다.
    res.status(200).json({ ok: false, reason: String(e.message || e).slice(0, 160) });
  }
};
