// KDX 브랜드 인제스트 — Vercel 서버리스 함수
// GET /api/ingest?url=https://...   → 사이트 HTML+CSS에서 컬러·폰트 추출
// GET /api/ingest?figma=<링크|key>  → Figma API로 파일 채움색 수집 (환경변수 FIGMA_TOKEN 필요)
// 응답: { colors:[{hex,count}], fonts:[이름], gradients:[css], source }

// 실제 브라우저처럼 요청(봇 차단 회피) + 403/429 시 모바일 UA로 1회 재시도 + 8초 타임아웃
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const BASE_HDRS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8'
};
async function fget(url, as) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
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

async function ingestUrl(url) {
  const html = await fget(url);
  // HTML(실제 렌더 콘텐츠)과 CSS 번들(라이브러리 상태색 노이즈 포함)을 분리 집계
  const htmlCounts = {}, cssCounts = {}, fonts = new Set(), declared = [];
  collectHex(html, htmlCounts); collectFonts(html, fonts);
  // 링크된 스타일시트 최대 6개
  let allCss = html;
  const links = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
    .map(m => (m[0].match(/href=["']([^"']+)["']/) || [])[1]).filter(Boolean).slice(0, 6);
  await Promise.all(links.map(async href => {
    try {
      const css = await fget(new URL(href, url).href);
      allCss += '\n' + css;
      collectHex(css, cssCounts); collectFonts(css, fonts);
    } catch (_) { /* 개별 실패 무시 */ }
  }));
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

async function ingestFigma(input, token) {
  const key = (input.match(/(?:file|design)\/([A-Za-z0-9]+)/) || [])[1] || input;
  const r = await fetch(`https://api.figma.com/v1/files/${key}?depth=4`, { headers: { 'X-Figma-Token': token } });
  if (!r.ok) throw new Error('Figma API ' + r.status + (r.status === 403 ? ' — 토큰 권한 확인' : ''));
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
  const { url, figma } = req.query || {};
  try {
    let out;
    if (figma) {
      const token = process.env.FIGMA_TOKEN;
      if (!token) return res.status(400).json({ error: 'Vercel 환경변수 FIGMA_TOKEN이 설정되지 않았습니다.' });
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
