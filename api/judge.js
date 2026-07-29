// Freesm 브랜드 판정 — Vercel 서버리스 함수 (v0.51 1단계: 텍스트 판정)
// POST /api/judge  body: { host, candidates:[{hex,src,count,source}], gradients:[{css,seed}], fonts:[], shape:{} }
// 응답: { ok:true, verdict:{primary,gradient,radius,density,font,confidence,why} } | { ok:false, reason }
// v0.57 — 화면 추천 모드 추가. POST body에 mode:'screens'가 오면
//   body: { host, site:{title,desc,siteName,ogType,lang,types,nav}, templates:[{k,t,d}] }
//   응답: { ok:true, plan:{kind,screens:[{tpl,title,desc,crumb}],confidence,why} }
//   같은 계약 — 에이전트는 templates의 인덱스만 고르고, 서버가 범위·중복·상표문자열을 검증한다.
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

/* ── v0.57 · 화면 추천 모드 (mode:'screens')
   같은 계약을 그대로 쓴다: 에이전트는 화면을 새로 만들지 않는다. 이미 있는 템플릿 목록의 인덱스만 고른다.
   제목·설명만 문장으로 받는데, 그것도 서버가 길이를 자르고 브랜드명이 섞이면 통째로 버린다 —
   데모 화면에 남의 상표 문자열을 심어두지 않기 위해서다(버리면 클라이언트가 템플릿 기본 문구를 쓴다). */
const SCR_SYSTEM = `당신은 정보구조 분석가입니다. 어떤 웹서비스의 제목·설명·메뉴 링크를 받고, 그 서비스의 성격을 파악해 디자인 시스템 예시 화면으로 만들 만한 페이지 유형 3개를 고릅니다.

판단 기준:
- 그 서비스에 실제로 있을 법한 페이지를 고르십시오. 메뉴 링크에 드러난 것이 가장 강한 근거입니다.
- 서로 성격이 다른 3개를 고르십시오. 비슷한 유형 셋보다 목록형·문서형·전환형이 섞인 쪽이 디자인 시스템 점검에 쓸모가 큽니다.
- 근거가 약하면 confidence를 "low"로 두십시오.

엄격한 제약:
- 템플릿은 반드시 주어진 목록의 배열 인덱스(0부터)로만 답하십시오. 새 유형을 만들지 마십시오.
- 제목·설명은 일반 명사로만 쓰십시오. 회사명·서비스명·상표를 넣지 마십시오. 예: "요금 안내"(O), "○○ 요금제"(X).
- 제목은 20자 이내, 설명은 한 문장, 경로(crumb)는 2~3단계.
- 오직 JSON 객체 하나만 출력하십시오. 설명·코드펜스·머리말 금지.

출력 형식:
{"kind":"<서비스 성격 한 단어, 일반 명사>","screens":[{"tpl":<정수 인덱스>,"title":"<제목>","desc":"<한 문장>","crumb":["홈","..."]}],"confidence":"high"|"mid"|"low","why":"<한국어 한 문장, 왜 이 셋인지>"}`;

function buildScrUser(b) {
  const s = b.site || {};
  const tpls = clampArr(b.templates, 16).map((t, i) => `${i}. ${String(t.t || '').slice(0, 30)} — ${String(t.d || '').slice(0, 60)}`);
  const nav = clampArr(s.nav, 28).map(n => `${String(n.t || '').slice(0, 30)}${n.h ? ' (' + String(n.h).slice(0, 40) + ')' : ''}`);
  return [
    `사이트: ${String(b.host || '(알 수 없음)').slice(0, 80)}`,
    `제목: ${String(s.title || '(없음)').slice(0, 120)}`,
    `설명: ${String(s.desc || '(없음)').slice(0, 160)}`,
    `서비스명 메타: ${String(s.siteName || '(없음)').slice(0, 60)} · 유형 메타: ${String(s.ogType || '(없음)').slice(0, 40)}`,
    `구조화 데이터 유형: ${clampArr(s.types, 6).join(', ') || '(없음)'}`,
    `언어: ${String(s.lang || '(없음)').slice(0, 12)}`,
    '',
    '메뉴·푸터 링크:',
    nav.length ? nav.join('\n') : '(없음 — 자바스크립트로 그리는 화면일 수 있습니다)',
    '',
    '고를 수 있는 화면 템플릿(인덱스 순):',
    tpls.join('\n'),
    '',
    '서로 다른 성격의 3개를 고르고, JSON 하나만 출력하십시오.'
  ].join('\n');
}

// 호스트에서 브랜드 토큰을 뽑는다 — 'www.instagram.com' → 'instagram'.
// 이 문자열이 제목·설명에 섞이면 그 필드를 버린다. 데모는 남의 서비스를 흉내 내는 물건이 아니다.
function brandToken(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '').split(':')[0];
  const first = h.split('.')[0];
  return first.length >= 3 ? first : '';
}
// 호스트 라벨만으로는 부족하다 — 에이전트는 한국어로 답하고, '인스타그램'은 'instagram'을 포함하지 않는다.
// 그래서 그 사이트가 스스로 밝힌 이름(og:site_name)도 같은 자격의 토큰으로 본다.
// 이름이 일반명사에 가까워 과하게 걸리더라도 손해는 '템플릿 기본 문구로 되돌아간다'뿐이다 — 그쪽이 안전하다.
function brandTokens(b) {
  const out = [], add = (s, min) => {
    const v = String(s || '').toLowerCase().trim();
    if (v.length >= min && out.indexOf(v) < 0) out.push(v);
  };
  add(brandToken(b && b.host), 3);
  const nm = (b && b.site && b.site.siteName) || '';
  add(nm, 2);
  add(String(nm).split(/[\s·|—–-]+/)[0], 2);
  return out.filter(Boolean);
}
function scrText(v, brands, cap) {
  let s = String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const low = s.toLowerCase();
  const list = Array.isArray(brands) ? brands : (brands ? [brands] : []);
  for (const t of list) if (t && low.indexOf(t) >= 0) return '';  // 상표 문자열이 섞이면 그 필드는 통째로 버린다
  return s.slice(0, cap);
}

/* 검증은 판정 모드와 같은 태도다 — 항목 단위로 버리고, 하나도 못 건지면 전체를 버린다.
   전체를 버리면 클라이언트가 규칙 폴백으로 내려가 화면 3개는 어쨌든 나온다. */
function validateScr(v, b) {
  if (!v || typeof v !== 'object') return null;
  const n = clampArr(b.templates, 16).length;
  const arr = Array.isArray(v.screens) ? v.screens : null;
  if (!n || !arr || !arr.length) return null;
  const brand = brandTokens(b);
  const out = [], used = new Set();
  for (const s of arr) {
    if (out.length >= 3) break;
    if (!s || typeof s !== 'object') continue;
    const t = s.tpl;
    if (!Number.isInteger(t) || t < 0 || t >= n) continue;        // 범위 밖 인덱스는 그 항목만 버린다
    if (used.has(t)) continue;                                    // 같은 템플릿 세 번은 추천이 아니다
    used.add(t);
    const crumb = (Array.isArray(s.crumb) ? s.crumb : []).map(c => scrText(c, brand, 20)).filter(Boolean).slice(0, 3);
    out.push({ tpl: t, title: scrText(s.title, brand, 20), desc: scrText(s.desc, brand, 140), crumb });
  }
  if (!out.length) return null;
  return {
    kind: scrText(v.kind, brand, 20),
    screens: out,
    confidence: CONF.indexOf(v.confidence) >= 0 ? v.confidence : 'mid',
    why: scrText(v.why, brand, 200)
  };
}

async function ask(body, key) {
  const scr = body.mode === 'screens';
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: ctl.signal,
      body: JSON.stringify({
        model: MODEL, max_tokens: scr ? 700 : 400, temperature: 0, system: scr ? SCR_SYSTEM : SYSTEM,
        messages: [{ role: 'user', content: scr ? buildScrUser(body) : buildUser(body) }]
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
    // 화면 추천 모드 — 색 판정과 입력·출력이 다르므로 여기서 갈라진다. 실패 규약(200·무음)은 같다.
    if (body && body.mode === 'screens') {
      if (!Array.isArray(body.templates) || !body.templates.length)
        return res.status(200).json({ ok: false, reason: 'no-templates' });
      const rawS = await ask(body, key);
      const plan = validateScr(rawS, body);
      if (!plan) return res.status(200).json({ ok: false, reason: 'schema' });
      return res.status(200).json({ ok: true, plan, model: MODEL });
    }
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
