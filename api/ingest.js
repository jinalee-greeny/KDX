// KDX 브랜드 인제스트 — Vercel 서버리스 함수
// v0.53 — 스타일시트 수집 확장: rel="stylesheet" 외에 preload as=style · .css 확장자 · @import 한 겹
// v0.55 — Figma 토큰을 요청 헤더(X-Figma-Token)로도 받는다. 서버 환경변수는 폴백.
// GET /api/ingest?url=https://...   → 사이트 HTML+CSS에서 컬러·폰트 추출
// GET /api/ingest?figma=<링크|key>  → Figma API로 파일 채움색 수집
//   토큰 출처: 요청 헤더 X-Figma-Token(사용자별) → 없으면 환경변수 FIGMA_TOKEN(배포자)
//   토큰은 통과만 시키고 저장·기록하지 않는다.
// 응답: { colors:[{hex,count}], fonts:[이름], gradients:[css], source }

// 실제 브라우저처럼 요청(봇 차단 회피) + 403/429 시 모바일 UA로 1회 재시도 + 8초 타임아웃
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const BASE_HDRS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8'
};
async function fget(url, as, ms) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms || 8000);
  try {
    let r = await fetch(url, { headers: { ...BASE_HDRS, 'User-Agent': UA_DESKTOP }, redirect: 'follow', signal: ctl.signal });
    if (r.status === 403 || r.status === 429 || r.status === 503) {
      r = await fetch(url, { headers: { ...BASE_HDRS, 'User-Agent': UA_MOBILE }, redirect: 'follow', signal: ctl.signal });
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return as === 'buf' ? { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || '' } : await r.text();
  } catch (e) {
    throw new Error((e.name === 'AbortError' ? '응답 시간 초과' : e.message) + ' — 봇 차단·로그인 사이트일 수 있습니다. URL 탭의 북마클릿을 사용해 보세요.');
  } finally { clearTimeout(tm); }
}

function collectHex(text, counts) {
  for (let m of text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []) {
    if (m.length === 4) m = '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
    m = m.toLowerCase();
    const n = parseInt(m.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 24 || mx < 35 || mn > 238) continue; // 무채색·극단값 제외
    counts[m] = (counts[m] || 0) + 1;
  }
}

function collectFonts(text, set) {
  for (const m of text.match(/font-family\s*:\s*([^;}]+)/gi) || []) {
    const name = m.split(':')[1].split(',')[0].trim().replace(/["']/g, '');
    if (name && !/^(inherit|initial|unset|var\()/.test(name)) set.add(name);
  }
}

// 1순위 시그널 — 사이트가 '선언한' 브랜드 색: theme-color 메타 + --primary/--brand 계열 변수
function validHex(h) {
  if (!h) return null;
  h = h.toLowerCase();
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (!/^#[0-9a-f]{6}$/.test(h)) return null;
  const n = parseInt(h.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 24 || mx < 35 || mn > 238) return null; // 무채색·극단값은 선언이라도 브랜드색 아님
  return h;
}
function collectDeclared(html, css, list) {
  const seen = new Map(list.map(d => [d.hex, d]));
  const add = (hex, source) => {
    const h = validHex(hex); if (!h) return;
    const ex = seen.get(h);
    if (ex) ex.count++;
    else { const d = { hex: h, count: 1, source }; seen.set(h, d); list.push(d); }
  };
  const theme = html.match(/name=["']theme-color["'][^>]*content=["'](#[0-9a-fA-F]{3,6})["']/i)
             || html.match(/content=["'](#[0-9a-fA-F]{3,6})["'][^>]*name=["']theme-color["']/i);
  if (theme) add(theme[1], 'theme-color');
  const tile = html.match(/name=["']msapplication-TileColor["'][^>]*content=["'](#[0-9a-fA-F]{3,6})["']/i);
  if (tile) add(tile[1], 'tile-color');
  const re = /(?:--|\$)[\w-]*(?:primary|brand|accent|point|key-?color|main-?color)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,6})\b/gi;
  for (const m of (html + '\n' + css).matchAll(re)) add(m[1], 'brand-var');
  // theme-color > tile > brand-var(빈도순)
  list.sort((a, b) => (a.source === 'theme-color' ? -1 : b.source === 'theme-color' ? 1 : 0) || b.count - a.count);
}

// 형태 통계: 사용 빈도 기반 — 모드 버킷별 등장 횟수를 집계해 다수 버킷 채택 (중앙값 아님)
// 동률이면 버킷 내 최빈값의 빈도가 높은 쪽. 근거로 최빈값·버킷 점유율 반환.
function pickMode(vals, buckets, minN) {
  if (vals.length < minN) return null;
  const scored = buckets.map(([name, test]) => {
    const inB = vals.filter(test);
    const freq = {}; inB.forEach(v => freq[v] = (freq[v] || 0) + 1);
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    return { name, cnt: inB.length, top: top[0] != null ? +top[0] : null, topFreq: top[1] };
  }).sort((a, b) => b.cnt - a.cnt || b.topFreq - a.topFreq);
  const best = scored[0];
  if (!best.cnt) return null;
  return { mode: best.name, top: best.top, pct: Math.round(best.cnt / vals.length * 100) };
}
const RAD_BUCKETS = [['sharp', v => v < 6], ['default', v => v >= 6 && v <= 14], ['rounded', v => v > 14]];
const PAD_BUCKETS = [['compact', v => v <= 9], ['default', v => v > 9 && v < 18], ['comfortable', v => v >= 18]];
// 그라디언트 원문 수집 — 판별·정규화는 클라이언트(parseGradients)가 수행. 빈도순 상위만 전달.
function collectGradients(text, counts) {
  const re = /(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/gi;
  let m, n = 0;
  while ((m = re.exec(text)) && n < 400) {
    const start = m.index; let d = 1, i = m.index + m[0].length;
    while (i < text.length && d > 0) { const ch = text[i]; if (ch === '(') d++; else if (ch === ')') d--; i++; }
    if (d === 0) {
      const css = text.slice(start, i);
      if (css.length < 400) { counts[css] = (counts[css] || 0) + 1; n++; }
    }
    re.lastIndex = i;
  }
}

// SVG 로고 그라디언트(<linearGradient>/<radialGradient> defs) 원문 수집 —
// 인스타그램류처럼 브랜드 그라디언트가 CSS가 아니라 로고 SVG에만 있는 경우를 위한 경로.
function collectSvgGradients(text, counts) {
  const re = /<(linear|radial)Gradient\b[\s\S]{0,4000}?<\/\1Gradient>/gi;
  let m, n = 0;
  while ((m = re.exec(text)) && n < 40) {
    const src = m[0];
    if (src.length < 4000 && /stop/i.test(src)) { counts[src] = (counts[src] || 0) + 1; n++; }
  }
}

function shapeFromCss(text) {
  const nums = re => [...text.matchAll(re)].map(m => parseFloat(m[1])).filter(v => v >= 0 && v <= 48);
  const r = pickMode(nums(/border-radius\s*:\s*([\d.]+)px/gi), RAD_BUCKETS, 3);
  const p = pickMode(nums(/padding(?:-top|-bottom|-left|-right)?\s*:\s*([\d.]+)px/gi), PAD_BUCKETS, 5);
  return {
    radius: r ? r.mode : null, radiusTop: r ? r.top : null, radiusPct: r ? r.pct : null,
    density: p ? p.mode : null, padTop: p ? p.top : null, padPct: p ? p.pct : null
  };
}

// 2순위 시그널 — 로고 마크만: apple-touch-icon > icon > favicon.
// og:image는 콘텐츠 이미지(블로그 썸네일·사진)라 브랜드 마크가 아님 → 제외.
async function fetchAssets(html, base) {
  const abs = h => { try { return new URL(h, base).href; } catch (_) { return null; } };
  const attr = (tag, name) => (tag && tag.match(new RegExp(name + '=["\']([^"\']+)["\']', 'i')) || [])[1];
  const touch = attr((html.match(/<link[^>]+apple-touch-icon[^>]*>/i) || [])[0], 'href');
  const icon = attr((html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i) || [])[0], 'href');
  const out = [];
  for (const [href, label] of [[touch, 'apple-touch-icon'], [icon, 'icon'], ['/favicon.ico', 'favicon']]) {
    if (out.length >= 2) break;
    const full = href && abs(href); if (!full) continue;
    try {
      const { buf, type: ct } = await fget(full, 'buf');
      if (!/image\//.test(ct) && !/\.(png|jpe?g|webp|gif|ico|svg)/i.test(full)) continue;
      if (buf.length < 100 || buf.length > 400000) continue;
      out.push({ label, type: /image\//.test(ct) ? ct.split(';')[0] : 'image/png', b64: buf.toString('base64') });
    } catch (_) { /* 개별 실패 무시 */ }
  }
  return out;
}

// ── 스타일시트 링크 수집(v0.53에서 넓힘)
// 예전에는 rel="stylesheet"만 봤다. 그런데 요즘 빌드 도구는 CSS를
// <link rel="preload" as="style">로 먼저 걸어두고 JS가 나중에 rel을 stylesheet로 바꾼다.
// 서버는 초기 HTML만 읽으므로 그 '나중'이 오지 않는다 — 그래서 preload와 .css 확장자도 함께 받는다.
// 넓힌 만큼 요청 수가 늘어나므로 상한과 시간 예산으로 묶는다(서버리스 실행 시간).
const CSS_CAP = 10, CSS_MS = 6000, IMP_CAP = 4, IMP_MS = 3500, IMP_DEADLINE = 5000;
function collectStyleLinks(html, base, seen) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const rel = ((tag.match(/\brel\s*=\s*["']([^"']*)["']/i) || [])[1] || '').toLowerCase();
    const as = ((tag.match(/\bas\s*=\s*["']([^"']*)["']/i) || [])[1] || '').toLowerCase();
    const isSheet = /(?:^|\s)stylesheet(?:\s|$)/.test(rel);
    const isPre = as === 'style' && /(?:^|\s)(?:preload|prefetch|modulepreload)(?:\s|$)/.test(rel);
    const isCssExt = /\.css(?:[?#]|$)/i.test(href);
    if (!isSheet && !isPre && !isCssExt) continue;
    let full; try { full = new URL(href, base).href; } catch (_) { continue; }
    if (!/^https?:/i.test(full) || seen.has(full)) continue;   // data:·blob:은 받지 않는다
    seen.add(full); out.push(full);
    if (out.length >= CSS_CAP) break;
  }
  return out;
}
// @import는 한 겹만 따라간다. 컴포넌트 CSS를 인덱스 파일 하나로 묶는 구성이 흔해서,
// 그 한 겹을 안 열면 실제 색이 든 파일에는 아예 닿지 못한다. 두 겹부터는 비용이 이득을 넘는다.
function collectImports(css, base, seen) {
  const out = [];
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) {
    let full; try { full = new URL(m[1], base).href; } catch (_) { continue; }
    if (!/^https?:/i.test(full) || seen.has(full)) continue;
    seen.add(full); out.push(full);
    if (out.length >= IMP_CAP) break;
  }
  return out;
}

async function ingestUrl(url) {
  const html = await fget(url);
  // HTML(실제 렌더 콘텐츠)과 CSS 번들(라이브러리 상태색 노이즈 포함)을 분리 집계
  const htmlCounts = {}, cssCounts = {}, fonts = new Set(), declared = [];
  collectHex(html, htmlCounts); collectFonts(html, fonts);
  // 링크된 스타일시트 — stylesheet · preload as=style · .css 확장자, 최대 CSS_CAP개. @import는 한 겹 더.
  let allCss = html;
  const t0 = Date.now(), seen = new Set();
  const take = async (u, ms, depth) => {
    let css;
    try { css = await fget(u, null, ms); } catch (_) { return; }   // 개별 실패 무시
    allCss += '\n' + css;
    collectHex(css, cssCounts); collectFonts(css, fonts);
    if (depth <= 0 || Date.now() - t0 > IMP_DEADLINE) return;      // 남은 시간이 없으면 더 파고들지 않는다
    await Promise.all(collectImports(css, u, seen).map(i => take(i, IMP_MS, depth - 1)));
  };
  await Promise.all(collectStyleLinks(html, url, seen).map(u => take(u, CSS_MS, 1)));
  collectDeclared(html, allCss, declared);
  const assets = await fetchAssets(html, url);
  // 병합: html 출처 수를 별도 보존(클라이언트가 '실사용 색' 가중에 사용)
  const counts = {};
  for (const [h, n] of Object.entries(htmlCounts)) counts[h] = { count: n, html: n };
  for (const [h, n] of Object.entries(cssCounts)) {
    if (counts[h]) counts[h].count += n; else counts[h] = { count: n, html: 0 };
  }
  const gcounts = {}; collectGradients(allCss, gcounts);
  const gradients = Object.entries(gcounts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .flatMap(([css, n]) => Array(Math.min(n, 20)).fill(css));
  // SVG defs: 인라인 SVG + SVG 파비콘/로고. 원문 그대로 전달하고 판별은 클라이언트가 한다.
  const scounts = {}; collectSvgGradients(html, scounts);
  for (const a of assets) {
    if (!/svg/i.test(a.type)) continue;
    try { collectSvgGradients(Buffer.from(a.b64, 'base64').toString('utf8'), scounts); } catch (_) { /* 무시 */ }
  }
  gradients.push(...Object.keys(scounts).slice(0, 4));
  return { counts, fonts, declared, shape: shapeFromCss(allCss), assets, gradients };
}

// Figma 링크에서 file key를 뽑는다. 사람은 자기가 보고 있던 주소를 그대로 붙여넣지,
// 그게 design인지 board인지 proto인지 구분해서 오지 않는다 — 경로 이름을 넓게 받는다.
// key는 영숫자 연속이고 실제로는 22자 안팎이라, 링크 안에서는 10자 이상만 key로 본다
// (짧은 경로 조각을 key로 오인하지 않기 위한 하한).
function figmaKey(input) {
  const s = String(input || '').trim();
  const m = s.match(/(?:file|design|board|proto|slides|deck)\/([A-Za-z0-9]{10,})/);
  if (m) return m[1];
  return (s.match(/^[A-Za-z0-9]+/) || [''])[0];      // 링크가 아니면 앞쪽 영숫자만 — key 직접 입력 경로
}

// 토큰은 그대로 아웃바운드 헤더 값이 된다. 줄바꿈·제어문자가 섞이면 헤더가 갈라지므로
// 출력 가능한 ASCII만 통과시킨다. 값 자체는 어디에도 기록하지 않는다(로그·응답·에러 문자열 전부).
function cleanToken(t) {
  const s = String(t || '').trim();
  if (!s) return '';
  return /^[\x21-\x7e]+$/.test(s) ? s : '';
}

async function ingestFigma(input, token) {
  const key = figmaKey(input);
  if (!key) throw new Error('Figma 파일 링크 또는 file key를 확인해 주세요.');
  const r = await fetch(`https://api.figma.com/v1/files/${key}?depth=4`, { headers: { 'X-Figma-Token': token } });
  if (!r.ok) {
    // 무엇을 고쳐야 하는지가 상태코드마다 다르다 — 숫자만 던지면 사용자가 할 수 있는 게 없다.
    const hint = r.status === 403 ? ' — 토큰 권한 확인(file_content:read 스코프, 그리고 이 파일에 접근 가능한 계정인지)'
      : r.status === 404 ? ' — 파일을 찾을 수 없습니다. 링크가 맞는지, 그 토큰의 계정이 이 파일을 볼 수 있는지 확인하세요.'
        : r.status === 429 ? ' — 요청이 몰렸습니다. 잠시 후 다시 시도하세요.' : '';
    throw new Error('Figma API ' + r.status + hint);
  }
  const doc = await r.json();
  const counts = {}, fonts = new Set(), radii = [], spacings = [];
  (function walk(node) {
    if (!node) return;
    for (const f of node.fills || []) {
      if (f.type === 'SOLID' && f.visible !== false && f.color) {
        const to = v => Math.round(v * 255);
        const [rr, gg, bb] = [to(f.color.r), to(f.color.g), to(f.color.b)];
        const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
        if (mx - mn >= 24 && mx >= 35 && mn <= 238) {
          const hex = '#' + [rr, gg, bb].map(v => v.toString(16).padStart(2, '0')).join('');
          counts[hex] = (counts[hex] || 0) + 1;
        }
      }
    }
    if (node.style && node.style.fontFamily) fonts.add(node.style.fontFamily);
    if (typeof node.cornerRadius === 'number' && node.cornerRadius >= 0 && node.cornerRadius <= 48) radii.push(node.cornerRadius);
    if (typeof node.itemSpacing === 'number' && node.itemSpacing > 0 && node.itemSpacing <= 48) spacings.push(node.itemSpacing);
    (node.children || []).forEach(walk);
  })(doc.document);
  const rB = pickMode(radii, RAD_BUCKETS, 3), pB = pickMode(spacings, PAD_BUCKETS, 5);
  const shape = {
    radius: rB ? rB.mode : null, radiusTop: rB ? rB.top : null, radiusPct: rB ? rB.pct : null,
    density: pB ? pB.mode : null, padTop: pB ? pB.top : null, padPct: pB ? pB.pct : null
  };
  return { counts, fonts, declared: [], shape, assets: [], gradients: [] };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 토큰을 커스텀 헤더로 받으므로 브라우저가 먼저 프리플라이트를 보낸다 — 그걸 통과시켜야 본 요청이 온다.
  // 토큰을 쿼리스트링에 싣지 않는 이유가 여기 있다: URL은 접근 로그·리퍼러·브라우저 기록에 남는다.
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Figma-Token, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { url, figma } = req.query || {};
  try {
    let out;
    if (figma) {
      // 사용자가 보낸 토큰이 우선, 없으면 서버에 심어둔 토큰으로 폴백한다.
      // 이 순서여야 여러 사람이 각자 자기 권한으로 자기 파일을 읽는다 —
      // 서버 토큰만 쓰면 모든 방문자가 배포자의 자격으로 Figma에 들어가게 된다.
      const sent = cleanToken((req.headers || {})['x-figma-token']);
      const raw = (req.headers || {})['x-figma-token'];
      if (raw && !sent) return res.status(400).json({ error: '토큰에 사용할 수 없는 문자가 들어 있습니다. 다시 복사해 붙여넣어 주세요.' });
      const token = sent || cleanToken(process.env.FIGMA_TOKEN);
      if (!token) return res.status(400).json({ error: 'Figma 토큰이 필요합니다 — 입력칸에 개인 액세스 토큰을 넣거나, 배포에 FIGMA_TOKEN 환경변수를 설정하세요.', need: 'token' });
      out = await ingestFigma(figma, token);
    } else if (url) {
      if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'http(s) URL만 지원합니다.' });
      out = await ingestUrl(url);
    } else {
      return res.status(400).json({ error: 'url 또는 figma 파라미터가 필요합니다.' });
    }
    const colors = Object.entries(out.counts)
      .map(([hex, v]) => typeof v === 'number' ? { hex, count: v, html: 0 } : { hex, count: v.count, html: v.html })
      .sort((a, b) => (b.html * 10 + b.count) - (a.html * 10 + a.count)).slice(0, 12);
    res.status(200).json({ colors, fonts: [...out.fonts].slice(0, 6), declared: (out.declared || []).slice(0, 6), shape: out.shape || null, assets: out.assets || [], gradients: out.gradients || [], source: figma ? 'figma' : 'url' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};
