/* ───────── Figma 화면을 가져온다 (Figma REST 노드 → 내보내기와 같은 트리) ─────────
 *
 * 방향만 반대일 뿐 v0.85 의 내보내기(sxCapture)와 같은 일을 한다.
 *   내보내기: 데모 DOM  → 트리 → Figma 프레임
 *   가져오기: Figma 노드 → 트리 → 데모 DOM
 *
 * **트리 모양을 새로 만들지 않는다.** sxCapture 가 내는 것과 같은 모양을 낸다
 * ({t,name,x,y,w,h,fill,stroke,radius,layout,gap,pad,kids,text,svg} …).
 * 그래야 (a) 가져온 화면을 그대로 다시 내보낼 수 있고, (b) 두 방향의 되짚기 숫자를
 * 같은 자로 잰 값으로 비교할 수 있다.
 *
 * 되짚기 표도 새로 만들지 않는다. demo/index.html 의 SXCORE 구간을 **잘라서 그대로 쓴다**.
 * 사본을 두면 언젠가 갈라지고, 갈라지는 순간 "내보낼 때는 92%인데 가져올 때는 61%" 같은
 * 숫자가 나와도 그게 화면 탓인지 표 탓인지 알 수 없게 된다.
 *
 * 이 파일이 하는 것 / 안 하는 것
 *   한다   — 구조·기하·글자·색/수치의 **정확 일치 되짚기**, 못 되짚은 값 세기, 모르는 것 보고
 *   안 한다 — 가까운 토큰으로 **치환**(고객 색 #1A73E8 → 우리 강조색). 그건 다음 단계다.
 *            정확 일치만으로는 화면이 하나도 안 바뀐다 — 값이 같아야 걸리기 때문이다.
 *            치환은 역할별 후보군과 색 거리(ΔE)가 필요하고, 그 설계는 문서에 따로 적었다.
 *
 * 사용(Node):
 *   const SI = require('./figma/screen-import');
 *   const core = SI.loadCore();                       // 데모의 SXCORE 를 잘라 온다
 *   const ix   = core.sxMakeIndex(payload).desktop;
 *   const tm   = core.sxMakeTextMatch(payload);
 *   const rep  = SI.newReport();
 *   const tree = SI.restToTree(figmaNode, { core, ix, tmatch: tm, rep });
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ── 데모의 SXCORE 구간을 잘라 실행한다 ──
   사본이 아니라 잘라 쓰는 것이 요점이다. 표식이 없어지면 조용히 넘어가지 않고 던진다. */
function loadCore(demoPath) {
  const file = demoPath || path.join(ROOT, 'demo', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf('/* SXCORE-BEGIN');
  const b = html.indexOf('/* SXCORE-END */');
  if (a < 0 || b < 0) {
    throw new Error('demo/index.html 에서 SXCORE 표식을 찾지 못했습니다 — '
      + '되짚기 표를 데모와 나눠 쓸 수 없습니다. 표식을 지웠다면 되돌려 주세요.');
  }
  const blk = html.slice(html.indexOf('*/', a) + 2, b);
  const ctx = { console: console, Math: Math, JSON: JSON, Object: Object, Array: Array,
    Map: Map, Set: Set, String: String, Number: Number, parseInt: parseInt,
    parseFloat: parseFloat, isFinite: isFinite };
  vm.createContext(ctx);
  vm.runInContext(blk + '\n;globalThis.__core = { SXW, SXTOL, SXSCOPE, SXPREF, sxRank, '
    + 'sxMakeIndex, sxPick, sxMakeTextMatch, sxColor, sxHex2, sxN };', ctx, { filename: 'demo:SXCORE' });
  return ctx.__core;
}

function newReport() {
  return {
    nodes: 0, texts: 0, icons: 0, images: 0, rects: 0, frames: 0,
    bind: { color: { bound: 0, literal: 0 }, num: { bound: 0, literal: 0 } },
    literals: { color: [] },
    drift: { type: {} },
    textOverride: 0,
    layout: { auto: 0, abs: 0, rejected: 0 },
    /* 버리는 것은 전부 이름을 남긴다 — 화면이 비어 보일 때 "왜 비었는지" 를
       추측이 아니라 목록으로 답할 수 있어야 한다. */
    skipped: { hidden: 0, zeroArea: 0, noBox: 0, depth: 0, empty: 0 },
    unknown: [],           // 처음 보는 노드 타입
    unsupported: []        // 아는 타입이지만 이 판이 아직 못 그리는 것(그라디언트 등)
  };
}
const note = (arr, s) => { if (arr.indexOf(s) < 0 && arr.length < 40) arr.push(s); };

/* ── Figma 색(0~1 실수) → #RRGGBB + 알파 ── */
function paintHex(p) {
  const c = p.color || {};
  const to = (v) => Math.max(0, Math.min(255, Math.round((v || 0) * 255)));
  const h2 = (n) => (n < 16 ? '0' : '') + n.toString(16);
  const hex = '#' + h2(to(c.r)) + h2(to(c.g)) + h2(to(c.b));
  const a = (typeof c.a === 'number' ? c.a : 1) * (typeof p.opacity === 'number' ? p.opacity : 1);
  return { hex: hex, a: Math.round(a * 1000) / 1000 };
}
/* 보이는 첫 SOLID 하나만 쓴다. 여러 겹이면 위의 것이 이긴다(Figma 는 뒤가 위다).
   SOLID 가 아닌 겹은 버리지 않고 보고한다. */
function firstSolid(paints, rep, where) {
  if (!Array.isArray(paints)) return null;
  for (let i = paints.length - 1; i >= 0; i--) {
    const p = paints[i];
    if (!p || p.visible === false) continue;
    if (p.type === 'SOLID') return paintHex(p);
    note(rep.unsupported, where + ' — ' + p.type + ' (지금은 단색만 되짚습니다)');
  }
  return null;
}
function hasImage(paints) {
  return Array.isArray(paints) && paints.some((p) => p && p.visible !== false && p.type === 'IMAGE');
}

const R2 = (n) => Math.round(n * 100) / 100;

/* ── 오토레이아웃 검산 ──
   Figma 가 "이건 세로 오토레이아웃이다" 라고 말해 줘도 그대로 믿지 않는다.
   말해 준 값(gap·padding·정렬)으로 자식 자리를 되짚어 계산해 보고, 실제 좌표와
   1px 넘게 어긋나면 오토레이아웃을 포기하고 절대배치로 내린다.
   내보내기 때와 똑같은 약속이다 — 검산을 통과한 자리에만 오토레이아웃을 건다.
   (자식 하나가 layoutPositioning:'ABSOLUTE' 이거나 layoutGrow 로 늘어난 경우가 여기서 걸린다.) */
function verifyLayout(node, kids, box, tol) {
  const dir = node.layoutMode;
  if (dir !== 'HORIZONTAL' && dir !== 'VERTICAL') return null;
  if (!kids.length) return null;
  const gap = typeof node.itemSpacing === 'number' ? node.itemSpacing : 0;
  const pad = {
    t: node.paddingTop || 0, r: node.paddingRight || 0,
    b: node.paddingBottom || 0, l: node.paddingLeft || 0
  };
  const vert = dir === 'VERTICAL';
  const main = vert ? 'y' : 'x';
  const cross = vert ? 'x' : 'y';
  const crossSize = vert ? 'w' : 'h';
  const crossBox = vert ? box.w : box.h;

  const order = kids.slice().sort((a, b) => a[main] - b[main]);
  let cur = vert ? pad.t : pad.l;
  const counterRaw = node.counterAxisAlignItems || 'MIN';
  for (const k of order) {
    if (Math.abs(k[main] - cur) > tol) return null;
    const padS = vert ? pad.l : pad.t;
    const padE = vert ? pad.r : pad.b;
    const free = crossBox - padS - padE - k[crossSize];
    const want = counterRaw === 'CENTER' ? padS + free / 2
      : counterRaw === 'MAX' ? padS + free
        : padS;
    if (Math.abs(k[cross] - want) > tol) return null;
    cur += (vert ? k.h : k.w) + gap;
  }
  const endPad = vert ? pad.b : pad.r;
  const total = cur - gap + endPad;
  if (Math.abs(total - (vert ? box.h : box.w)) > tol + 0.5) return null;

  return { dir: dir, gap: gap, pad: pad, counter: counterRaw, order: order };
}

/* ─────────────────────────── 본체 ─────────────────────────── */
/* opt: { core, ix, tmatch, rep, maxDepth }
   ix 는 sxMakeIndex(payload)[mode] 하나(색·수치 표). */
function restToTree(root, opt) {
  const core = opt.core, ix = opt.ix, tmatch = opt.tmatch, rep = opt.rep;
  const tol = typeof opt.tol === 'number' ? opt.tol : (core.SXTOL || 1);
  const maxDepth = opt.maxDepth || 24;

  const colTok = (c, use) => {
    if (!c) return null;
    const ak = (c.hex + core.sxHex2(Math.round(c.a * 255))).toUpperCase();
    const t = core.sxPick(ix.color.get(ak), use) || core.sxPick(ix.color.get(c.hex.toUpperCase() + 'FF'), use);
    if (t) { rep.bind.color.bound++; return { token: t, a: c.a }; }
    rep.bind.color.literal++;
    note(rep.literals.color, c.hex);
    return { hex: c.hex, a: c.a };
  };
  const numTok = (n, use) => {
    if (!(n > 0)) return { v: 0 };
    const t = core.sxPick(ix.num.get(R2(n)), use);
    if (t) { rep.bind.num.bound++; return { token: t, v: n }; }
    rep.bind.num.literal++;
    return { v: R2(n) };
  };

  const TEXTY = { TEXT: 1 };
  const VECTORY = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, LINE: 1, REGULAR_POLYGON: 1 };
  const BOXY = { FRAME: 1, GROUP: 1, COMPONENT: 1, COMPONENT_SET: 1, INSTANCE: 1, RECTANGLE: 1, ELLIPSE: 1, SECTION: 1 };

  function walk(n, pBox, depth) {
    if (!n) return null;
    if (n.visible === false) { rep.skipped.hidden++; return null; }
    const op = typeof n.opacity === 'number' ? n.opacity : 1;
    if (op <= 0.01) { rep.skipped.hidden++; return null; }
    const bb = n.absoluteBoundingBox;
    if (!bb) { rep.skipped.noBox++; return null; }
    if (!(bb.width > 0.5) || !(bb.height > 0.5)) { rep.skipped.zeroArea++; return null; }
    if (depth > maxDepth) { rep.skipped.depth++; return null; }
    rep.nodes++;

    const box = {
      x: R2(bb.x - pBox.x), y: R2(bb.y - pBox.y),
      w: R2(bb.width), h: R2(bb.height)
    };
    const name = n.name || (n.type || 'NODE').toLowerCase();

    /* ① 벡터 — REST 는 geometry=paths 를 붙여 받으면 fillGeometry 에 SVG path 를 준다.
          없으면 그릴 수 없으니 사각형으로 떨어뜨리되 그 사실을 보고한다. */
    if (VECTORY[n.type]) {
      const g = (n.fillGeometry || []).map((x) => x && x.path).filter(Boolean);
      const sg = (n.strokeGeometry || []).map((x) => x && x.path).filter(Boolean);
      const paths = g.length ? g : sg;
      if (paths.length) {
        rep.icons++;
        const col = firstSolid(n.fills, rep, name) || firstSolid(n.strokes, rep, name) || { hex: '#000000', a: 1 };
        return Object.assign({
          t: 'svg', name: name,
          svg: '<svg viewBox="0 0 ' + R2(bb.width) + ' ' + R2(bb.height) + '" xmlns="http://www.w3.org/2000/svg">'
            + paths.map((p) => '<path d="' + p + '" fill="' + col.hex + '"/>').join('') + '</svg>'
        }, box);
      }
      note(rep.unsupported, name + ' — 벡터인데 경로가 없습니다 (nodes 요청에 geometry=paths 를 붙이세요)');
    }

    /* ② 글자 */
    if (TEXTY[n.type]) {
      const st = n.style || {};
      const fs2 = st.fontSize || 0, fw = st.fontWeight || 400;
      const lh = typeof st.lineHeightPx === 'number' ? st.lineHeightPx : null;
      const chars = String(n.characters || '').replace(/\s+/g, ' ').trim();
      if (!chars) { rep.skipped.empty++; return null; }
      rep.texts++;
      const m = tmatch(fs2, fw, lh);
      if (m && !m.exact) {
        rep.textOverride++;
        const k = R2(fs2) + 'px/' + fw;
        rep.drift.type[k] = (rep.drift.type[k] || 0) + 1;
      }
      const node = Object.assign({ t: 'text', name: name }, box);
      node.text = {
        chars: chars,
        style: m ? m.style : null, exact: m ? m.exact : false,
        sizeToken: null,
        size: m && m.exact ? null : R2(fs2),
        lh: m && m.exact ? null : (lh ? R2(lh) : null),
        fill: colTok(firstSolid(n.fills, rep, name), 'text'),
        align: st.textAlignHorizontal === 'CENTER' ? 'CENTER'
          : st.textAlignHorizontal === 'RIGHT' ? 'RIGHT' : 'LEFT',
        /* 원본 서체는 되짚기에 쓰지 않지만 버리지도 않는다 — "이 화면은 Pretendard 가
           아니라 Noto 로 그려져 있었다" 를 나중에 말할 수 있어야 한다. */
        srcFont: st.fontFamily || null
      };
      if (op < 1) node.opacity = R2(op);
      return node;
    }

    if (!BOXY[n.type]) note(rep.unknown, n.type + ' (' + name + ')');

    /* ③ 면 */
    const node = Object.assign({ t: 'frame', name: name }, box);
    const fill = firstSolid(n.fills, rep, name);
    if (fill) node.fill = colTok(fill, 'fill');
    if (!fill && hasImage(n.fills)) {
      rep.images++;
      node.image = true;   // 실제 픽셀은 /v1/images 로 따로 받는다. 지금은 자리를 남긴다.
    }
    const stroke = firstSolid(n.strokes, rep, name);
    const sw = typeof n.strokeWeight === 'number' ? n.strokeWeight : 0;
    if (stroke && sw > 0) {
      node.stroke = colTok(stroke, 'stroke');
      node.strokeW = numTok(sw, 'strokeW');
      const iw = n.individualStrokeWeights;
      if (iw) {
        const sides = [iw.top || 0, iw.right || 0, iw.bottom || 0, iw.left || 0];
        if (sides.some((s) => Math.abs(s - sw) > 0.01)) node.strokeSides = sides;
      }
    }
    if (Array.isArray(n.rectangleCornerRadii)) {
      const four = n.rectangleCornerRadii.map(R2);
      node.radius = four.every((v) => Math.abs(v - four[0]) < 0.01)
        ? numTok(four[0], 'radius') : { v4: four };
    } else if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
      node.radius = numTok(n.cornerRadius, 'radius');
    }
    if (op < 1) node.opacity = R2(op);
    if (n.clipsContent) node.clip = true;

    /* ④ 자식 */
    const kids = [];
    for (const ch of (n.children || [])) {
      const k = walk(ch, bb, depth + 1);
      if (k) kids.push(k);
    }
    if (!kids.length && !node.fill && !node.stroke && !node.image) { rep.skipped.empty++; return null; }
    if (!kids.length) { node.t = 'rect'; rep.rects++; return node; }
    rep.frames++;

    const L = verifyLayout(n, kids, box, tol);
    if (L) {
      rep.layout.auto++;
      node.layout = L.dir;
      node.gap = numTok(L.gap, 'gap');
      node.pad = L.pad;
      node.alignCounter = L.counter;
      node.kids = L.order;
      for (const k of node.kids) {
        k.grow = (L.dir === 'VERTICAL') ? { h: 'FIXED', v: 'FIXED' } : { h: 'FIXED', v: 'FIXED' };
        k._x = k.x; k._y = k.y;
        delete k.x; delete k.y;
      }
    } else {
      if (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL') rep.layout.rejected++;
      rep.layout.abs++;
      node.layout = 'NONE';
      node.kids = kids;
    }
    return node;
  }

  const bb = root && root.absoluteBoundingBox;
  const out = walk(root, bb ? { x: bb.x, y: bb.y } : { x: 0, y: 0 }, 0);
  /* 화면 바닥 — 내보내기에서 겪은 것과 같은 자리다. 루트에 색이 없으면 Figma 에서도
     데모에서도 통째로 투명해진다. 여기서는 조상이 없으므로 흰 종이로 떨어뜨린다. */
  if (out && !out.fill && !out.image) out.fill = colTok({ hex: '#ffffff', a: 1 }, 'fill');
  return out;
}

/* ── 트리 → 데모가 그릴 수 있는 HTML ──
   토큰으로 되짚은 자리는 var(--tok-…) 로, 못 되짚은 자리는 원본 값 그대로 낸다.
   그리고 **못 되짚은 자리에 표시를 남긴다**(data-lit) — 숫자만으로는 어디가 어긋났는지
   짚을 수 없기 때문이다. 원본 이미지를 겹쳐 볼 때 이 표시가 대조점이 된다. */
function tokenCssName(t) { return '--tok-' + String(t).replace(/[^a-zA-Z0-9]+/g, '-'); }

function treeToHtml(tree, opt) {
  const o = opt || {};
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const used = new Set();
  const colOf = (c) => {
    if (!c) return null;
    if (c.token) { used.add(c.token); return 'var(' + tokenCssName(c.token) + ')'; }
    if (c.a != null && c.a < 1) {
      const n = parseInt(c.hex.slice(1), 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + c.a + ')';
    }
    return c.hex;
  };
  const numOf = (v) => {
    if (!v) return null;
    if (v.token) { used.add(v.token); return 'var(' + tokenCssName(v.token) + ')'; }
    if (v.v4) return v.v4.map((x) => x + 'px').join(' ');
    return (v.v || 0) + 'px';
  };

  function draw(n, isRoot) {
    const st = [];
    const lit = [];
    if (isRoot) st.push('position:relative');
    else {
      st.push('position:absolute');
      st.push('left:' + (n.x != null ? n.x : n._x || 0) + 'px');
      st.push('top:' + (n.y != null ? n.y : n._y || 0) + 'px');
    }
    st.push('width:' + n.w + 'px', 'height:' + n.h + 'px');
    if (n.fill) { st.push('background:' + colOf(n.fill)); if (!n.fill.token) lit.push('fill'); }
    if (n.image) st.push('background:repeating-linear-gradient(45deg,#e9ecef 0 8px,#dee2e6 8px 16px)');
    if (n.stroke) {
      const w = n.strokeW && n.strokeW.v ? n.strokeW.v : 1;
      st.push('box-shadow:inset 0 0 0 ' + w + 'px ' + colOf(n.stroke));
      if (!n.stroke.token) lit.push('stroke');
    }
    if (n.radius) { st.push('border-radius:' + numOf(n.radius)); if (!n.radius.token && !n.radius.v4) lit.push('radius'); }
    if (n.opacity != null) st.push('opacity:' + n.opacity);
    if (n.clip) st.push('overflow:hidden');

    if (n.t === 'svg') {
      return '<div class="sn" style="' + st.join(';') + '">' + n.svg + '</div>';
    }
    if (n.t === 'text') {
      const T = n.text || {};
      if (T.fill) { st.push('color:' + colOf(T.fill)); if (!T.fill.token) lit.push('text-fill'); }
      if (T.size) { st.push('font-size:' + T.size + 'px'); lit.push('type'); }
      if (T.lh) st.push('line-height:' + T.lh + 'px');
      if (T.align !== 'LEFT') st.push('text-align:' + (T.align === 'CENTER' ? 'center' : 'right'));
      st.push('display:flex', 'align-items:center', 'white-space:pre-wrap');
      if (T.align === 'CENTER') st.push('justify-content:center');
      if (T.align === 'RIGHT') st.push('justify-content:flex-end');
      return '<div class="sn st' + (T.style ? '" data-style="' + esc(T.style) : '')
        + '"' + (lit.length ? ' data-lit="' + lit.join(' ') + '"' : '')
        + ' style="' + st.join(';') + '">' + esc(T.chars) + '</div>';
    }
    const inner = (n.kids || []).map((k) => draw(k, false)).join('');
    return '<div class="sn"' + (lit.length ? ' data-lit="' + lit.join(' ') + '"' : '')
      + ' data-name="' + esc(n.name) + '" style="' + st.join(';') + '">' + inner + '</div>';
  }

  const body = tree ? draw(tree, true) : '<p>빈 화면</p>';
  const vars = [...used].map((t) => '  ' + tokenCssName(t) + ':' + (o.resolve ? o.resolve(t) : '#f0f') + ';').join('\n');
  return { html: body, cssVars: vars, tokens: [...used] };
}

module.exports = { loadCore, newReport, restToTree, treeToHtml, verifyLayout, tokenCssName, paintHex, firstSolid };
