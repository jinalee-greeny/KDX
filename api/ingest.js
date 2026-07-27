// KDX 브랜드 인제스트 — Vercel 서버리스 함수
// GET /api/ingest?url=https://...   → 사이트 HTML+CSS에서 컬러·폰트 추출
// GET /api/ingest?figma=<링크|key>  → Figma API로 파일 채움색 수집 (환경변수 FIGMA_TOKEN 필요)
// 응답: { colors:[{hex,count}], fonts:[이름], source }

const UA = 'Mozilla/5.0 (compatible; KDX-BrandIngest/1.0)';

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

// 브랜드 시그널: --primary/--brand/--accent 등 변수명·클래스명에 물린 hex는 강하게 가중
function collectBrandSignals(text, counts) {
  const re = /(?:--|\$)?[\w-]*(?:primary|brand|accent|point|key-?color|main-?color)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,6})\b/gi;
  for (const m of text.matchAll(re)) collectHex((m[1] + ' ').repeat(30), counts);
}

async function ingestUrl(url) {
  const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const counts = {}, fonts = new Set();
  collectHex(html, counts); collectFonts(html, fonts); collectBrandSignals(html, counts);
  // theme-color 메타는 최우선 시그널 — 강하게 가중
  const theme = html.match(/name=["']theme-color["'][^>]*content=["'](#[0-9a-fA-F]{3,6})["']/i)
             || html.match(/content=["'](#[0-9a-fA-F]{3,6})["'][^>]*name=["']theme-color["']/i);
  if (theme) collectHex((theme[1] + ' ').repeat(60), counts);
  // 링크된 스타일시트 최대 6개
  const links = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
    .map(m => (m[0].match(/href=["']([^"']+)["']/) || [])[1]).filter(Boolean).slice(0, 6);
  await Promise.all(links.map(async href => {
    try {
      const css = await (await fetch(new URL(href, url).href, { headers: { 'User-Agent': UA } })).text();
      collectHex(css, counts); collectFonts(css, fonts); collectBrandSignals(css, counts);
    } catch (_) { /* 개별 실패 무시 */ }
  }));
  return { counts, fonts };
}

async function ingestFigma(input, token) {
  const key = (input.match(/(?:file|design)\/([A-Za-z0-9]+)/) || [])[1] || input;
  const r = await fetch(`https://api.figma.com/v1/files/${key}?depth=4`, { headers: { 'X-Figma-Token': token } });
  if (!r.ok) throw new Error('Figma API ' + r.status + (r.status === 403 ? ' — 토큰 권한 확인' : ''));
  const doc = await r.json();
  const counts = {}, fonts = new Set();
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
    (node.children || []).forEach(walk);
  })(doc.document);
  return { counts, fonts };
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
    const colors = Object.entries(out.counts).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([hex, count]) => ({ hex, count }));
    res.status(200).json({ colors, fonts: [...out.fonts].slice(0, 6), source: figma ? 'figma' : 'url' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};
