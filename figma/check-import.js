/* ───────── 가져오기 검사 — Figma 노드가 화면 트리로 옳게 넘어오는가 ─────────
 *
 * 이 하네스가 지키는 것은 하나다: **화면이 그럴듯해 보이는 것으로는 아무것도 증명되지 않는다.**
 * 가져오기가 조용히 틀리는 방식은 정해져 있다 —
 *   · 부모 기준 좌표 계산을 틀려 자식이 통째로 밀린다(눈으로는 "레이아웃이 좀 다르네" 로 보인다)
 *   · 숨긴 노드를 같이 그려 넣는다(작업 중 파킹해 둔 구버전이 화면에 뜬다)
 *   · 모르는 타입을 조용히 버린다(화면 절반이 사라졌는데 오류는 없다)
 *   · Figma 가 "오토레이아웃" 이라고 하면 검산 없이 믿는다(자식 하나가 절대배치면 자리가 어긋난다)
 *   · 못 되짚은 색에 아무 토큰이나 걸어 준다(화면은 예뻐지고 숫자는 거짓말이 된다)
 * 그래서 이 다섯 가지를 각각 단언한다.
 *
 * 사용:
 *   node figma/check-import.js
 *   node figma/check-import.js --rest <응답.json> --payload figma/build-payload.json --html out.html
 *
 * ── 진짜 응답으로 갈아 끼우려면 ──
 * 지금 fixture 는 손으로 지은 것이다. REST 응답의 **모양**까지 증명하지는 못한다.
 * 실제 파일에서 한 번 받아 두면 그때부터는 증명이 된다. 토큰은 본인 터미널에서 직접 넣을 것.
 *
 *   curl -H "X-Figma-Token: <본인 토큰>" \
 *     "https://api.figma.com/v1/files/<파일키>/nodes?ids=<프레임id>&geometry=paths" \
 *     | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const k=Object.keys(j.nodes)[0];process.stdout.write(JSON.stringify(j.nodes[k].document,null,1))})" \
 *     > figma/fixtures/screen-rest-real.json
 *
 *   node figma/check-import.js --rest figma/fixtures/screen-rest-real.json --html /tmp/in.html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SI = require('./screen-import');

const ROOT = path.join(__dirname, '..');
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const REST = JSON.parse(fs.readFileSync(path.resolve(ROOT, argOf('--rest', 'figma/fixtures/screen-rest.json')), 'utf8'));
const PAYLOAD = JSON.parse(fs.readFileSync(path.resolve(ROOT, argOf('--payload', 'figma/build-payload.json')), 'utf8'));
const MODE = argOf('--mode', 'mobile');

const fail = [];
const F = (m) => fail.push(m);

const core = SI.loadCore();
const ix = core.sxMakeIndex(PAYLOAD)[MODE];
const tmatch = core.sxMakeTextMatch(PAYLOAD);
const rep = SI.newReport();
const tree = SI.restToTree(REST, { core: core, ix: ix, tmatch: tmatch, rep: rep });

if (!tree) { console.error('가져오기가 아무것도 내지 못했습니다.'); process.exit(2); }

/* ── fixture 쪽 진실 — 이름 → 절대좌표, 그리고 '나오면 안 되는 것' ── */
const truth = new Map();          // 이름 → {x,y,w,h}
const mustNotAppear = new Set();  // 숨김·0크기 하위 전체
const types = new Map();
(function scan(n, hidden) {
  if (!n) return;
  const h = hidden || n.visible === false;
  const bb = n.absoluteBoundingBox;
  const zero = bb && (!(bb.width > 0.5) || !(bb.height > 0.5));
  if (h || zero) mustNotAppear.add(n.name);
  else if (bb) { truth.set(n.name, bb); types.set(n.name, n.type); }
  (n.children || []).forEach((k) => scan(k, h || zero));
})(REST, false);

/* ── 결과 트리를 절대좌표로 되돌린다 ── */
const got = new Map();
(function abs(n, px, py) {
  const x = px + (n.x != null ? n.x : (n._x || 0));
  const y = py + (n.y != null ? n.y : (n._y || 0));
  got.set(n.name, { x: x, y: y, w: n.w, h: n.h, t: n.t, node: n });
  (n.kids || []).forEach((k) => abs(k, x, y));
})(tree, REST.absoluteBoundingBox.x, REST.absoluteBoundingBox.y);

/* ── 1) 기하: 되돌린 좌표가 원본과 같아야 한다 ── */
{
  const off = [];
  for (const [name, g] of got) {
    const t = truth.get(name);
    if (!t) continue;
    const d = Math.max(Math.abs(g.x - t.x), Math.abs(g.y - t.y),
      Math.abs(g.w - t.width), Math.abs(g.h - t.height));
    if (d > 1) off.push(name + ' — 원본 (' + t.x + ',' + t.y + ' ' + t.width + '×' + t.height
      + ') · 가져온 것 (' + g.x + ',' + g.y + ' ' + g.w + '×' + g.h + ')');
  }
  if (off.length) F('자리가 어긋난 노드 ' + off.length + '개 — 부모 기준 좌표 계산이 틀렸습니다:\n      ' + off.slice(0, 6).join('\n      '));
}

/* ── 2) 숨긴 것·0 크기는 나오면 안 된다 ── */
{
  const leaked = [...mustNotAppear].filter((n) => got.has(n));
  if (leaked.length) F('숨겼거나 크기가 0인 노드가 화면에 들어왔습니다 — ' + leaked.join(', ')
    + '. 작업 중 파킹해 둔 구버전이 그대로 그려집니다.');
  if (!rep.skipped.hidden) F('숨긴 노드를 하나도 세지 않았습니다 — fixture 에는 있습니다.');
  if (!rep.skipped.zeroArea) F('크기 0 노드를 하나도 세지 않았습니다 — fixture 에는 있습니다.');
}

/* ── 3) 모르는 것은 버리지 않고 센다 ── */
{
  const oddTypes = [...types.entries()].filter(([, t]) =>
    ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'RECTANGLE', 'ELLIPSE', 'SECTION',
      'TEXT', 'VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'REGULAR_POLYGON'].indexOf(t) < 0);
  if (oddTypes.length && !rep.unknown.length)
    F('fixture 에 모르는 타입(' + oddTypes.map((x) => x[1]).join(', ') + ')이 있는데 보고가 없습니다 — '
      + '조용히 버리면 화면이 왜 비었는지 아무도 알 수 없습니다.');
  const hasGrad = JSON.stringify(REST).indexOf('GRADIENT') >= 0;
  if (hasGrad && !rep.unsupported.some((s) => /GRADIENT/.test(s)))
    F('그라디언트 채움이 있는데 보고가 없습니다 — 단색만 되짚는다는 사실을 화면이 숨기면 안 됩니다.');
}

/* ── 4) 오토레이아웃은 검산을 통과한 자리에만 ── */
{
  const auto = [], rejected = [];
  for (const [name, g] of got) {
    if (g.node.layout === 'HORIZONTAL' || g.node.layout === 'VERTICAL') auto.push(name);
    else if (g.node.kids && g.node.kids.length && (REST, types.get(name) === 'FRAME')) { /* 후보 */ }
  }
  const declared = [];
  (function s(n) { if (!n) return; if (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL') declared.push(n.name); (n.children || []).forEach(s); })(REST);
  if (!auto.length) F('오토레이아웃으로 잡힌 프레임이 하나도 없습니다 — fixture 에는 검산을 통과하는 것이 있습니다.');
  if (!rep.layout.rejected) F('검산에 실패한 오토레이아웃이 하나도 없습니다 — fixture 에는 자리가 어긋난 것이 있습니다. '
    + 'Figma 가 말해 준 것을 그대로 믿고 있다는 뜻입니다.');
  for (const name of auto) {
    const n = got.get(name).node;
    for (const k of (n.kids || [])) {
      if (k.x != null || k.y != null) F(name + ' 의 자식이 x·y 를 그대로 들고 있습니다 — 오토레이아웃 자식은 _x·_y 로 남겨야 검산이 가능합니다.');
      if (k._x == null || k._y == null) F(name + ' 의 자식에 _x·_y 가 없습니다 — 잰 자리를 버리면 검산할 방법이 사라집니다.');
      break;
    }
  }
  rejected.length = 0;
  const rejNames = declared.filter((d) => { const g = got.get(d); return g && g.node.layout === 'NONE'; });
  if (rejNames.length !== rep.layout.rejected)
    F('검산 실패 수가 안 맞습니다 — 절대배치로 내려간 선언 프레임 ' + rejNames.length + '개 · 보고 ' + rep.layout.rejected + '개');
}

/* ── 5) 되짚기: 값이 같을 때만 토큰, 아니면 리터럴 ── */
{
  const resolve = makeResolve(PAYLOAD, MODE);
  const bad = [];
  (function s(n) {
    if (!n) return;
    for (const [k, use] of [['fill', 'fill'], ['stroke', 'stroke']]) {
      const c = n[k];
      if (c && c.token) {
        const v = resolve(c.token);
        if (!v) bad.push(n.name + '.' + k + ' → ' + c.token + ' (값을 풀 수 없음)');
      }
    }
    const tf = n.text && n.text.fill;
    if (tf && tf.token && !resolve(tf.token)) bad.push(n.name + '.text → ' + tf.token + ' (값을 풀 수 없음)');
    (n.kids || []).forEach(s);
  })(tree);
  if (bad.length) F('풀리지 않는 토큰을 걸었습니다 — ' + bad.slice(0, 5).join(', '));

  /* 토큰으로 건 색은 원본 값과 **같아야** 한다. 다르면 그건 되짚기가 아니라 치환이다. */
  const mism = [];
  (function s(n, src) {
    (n.kids || []).forEach((k) => s(k));
  })(tree);
  /* 원본 값 대조 — fixture 를 다시 훑어 이름→hex 를 만들고 트리와 맞춘다 */
  const srcHex = new Map();
  (function s(n, hidden) {
    if (!n) return;
    const h = hidden || n.visible === false;
    if (!h) {
      const f = (n.fills || []).slice().reverse().find((p) => p && p.visible !== false && p.type === 'SOLID');
      if (f) srcHex.set(n.name, SI.paintHex(f).hex.toUpperCase());
    }
    (n.children || []).forEach((k) => s(k, h));
  })(REST, false);
  for (const [name, g] of got) {
    const c = g.node.fill;
    if (!c || !c.token) continue;
    const want = srcHex.get(name);
    const have = String(resolve(c.token) || '').toUpperCase();
    if (want && have && want !== have) mism.push(name + ' — 원본 ' + want + ' 인데 ' + c.token + '(' + have + ') 을 걸었습니다');
  }
  if (mism.length) F('값이 다른데 토큰을 걸었습니다 (' + mism.length + '개) — 화면은 예뻐지고 숫자는 거짓말이 됩니다:\n      ' + mism.slice(0, 5).join('\n      '));

  if (!rep.bind.color.bound) F('색을 하나도 되짚지 못했습니다 — fixture 에는 토큰과 같은 값(#FFFFFF)이 있습니다.');
  if (!rep.bind.color.literal) F('리터럴로 남은 색이 하나도 없습니다 — fixture 의 고객 브랜드색은 토큰에 없습니다. '
    + '전부 걸렸다면 아무 토큰이나 집고 있다는 뜻입니다.');
}

/* ── 6) 루트 바닥색 ── */
if (!tree.fill && !tree.image) F('루트에 채우기가 없습니다 — 화면이 통째로 투명해집니다(내보내기에서 겪은 그 자리).');

/* ── 보고 ── */
const pct = (a, b) => (a + b) ? Math.round(a / (a + b) * 1000) / 10 : 0;
console.log('가져온 화면: ' + (tree.name || '?') + ' · ' + tree.w + '×' + tree.h + ' · 모드 ' + MODE);
console.log('  노드 ' + rep.nodes + ' (프레임 ' + rep.frames + ' · 사각 ' + rep.rects + ' · 글자 ' + rep.texts
  + ' · 아이콘 ' + rep.icons + ' · 이미지 ' + rep.images + ')');
console.log('  오토레이아웃 ' + rep.layout.auto + ' · 절대배치 ' + rep.layout.abs
  + (rep.layout.rejected ? ' (검산 실패로 내린 것 ' + rep.layout.rejected + ')' : ''));
console.log('  색 되짚기 ' + rep.bind.color.bound + '/' + (rep.bind.color.bound + rep.bind.color.literal)
  + ' = ' + pct(rep.bind.color.bound, rep.bind.color.literal) + '%'
  + ' · 수치 ' + rep.bind.num.bound + '/' + (rep.bind.num.bound + rep.bind.num.literal)
  + ' = ' + pct(rep.bind.num.bound, rep.bind.num.literal) + '%');
console.log('  글자 스타일을 덮어쓴 자리 ' + rep.textOverride + '/' + rep.texts);
if (rep.literals.color.length) console.log('  못 되짚은 색: ' + rep.literals.color.join(' '));
if (Object.keys(rep.drift.type).length) console.log('  스케일 밖 타입: ' + Object.entries(rep.drift.type).map((e) => e[0] + '×' + e[1]).join(' · '));
const sk = rep.skipped;
console.log('  건너뛴 것 — 숨김 ' + sk.hidden + ' · 크기0 ' + sk.zeroArea + ' · 상자없음 ' + sk.noBox + ' · 빈 것 ' + sk.empty + ' · 너무 깊음 ' + sk.depth);
if (rep.unknown.length) console.log('  모르는 타입: ' + rep.unknown.join(' · '));
if (rep.unsupported.length) console.log('  아직 못 그리는 것: ' + rep.unsupported.join(' · '));

/* ── HTML 로 내보내기(눈으로 볼 때) ── */
const OUT = argOf('--html', null);
if (OUT) {
  const resolve = makeResolve(PAYLOAD, MODE);
  const r = SI.treeToHtml(tree, { resolve: resolve });
  fs.writeFileSync(OUT, [
    '<!doctype html><meta charset="utf-8"><title>' + (tree.name || '') + ' — 가져온 화면</title>',
    '<style>',
    ':root{', r.cssVars, '}',
    'body{margin:0;background:#edeef0;font-family:Pretendard,system-ui,sans-serif;display:flex;gap:24px;padding:24px;align-items:flex-start}',
    '.sn{box-sizing:border-box}',
    '.wrap{box-shadow:0 8px 24px rgba(0,0,0,.12)}',
    /* 못 되짚은 자리를 표시한다 — 숫자만으로는 어디가 어긋났는지 짚을 수 없다. */
    'body.mark [data-lit]{outline:1px dashed #dc2626;outline-offset:-1px}',
    '.legend{font-size:12px;line-height:1.7;color:#42464e;max-width:280px}',
    '</style>',
    '<div class="wrap">' + r.html + '</div>',
    '<div class="legend"><b>' + (tree.name || '') + '</b><br>노드 ' + rep.nodes
    + ' · 색 되짚기 ' + pct(rep.bind.color.bound, rep.bind.color.literal) + '%'
    + ' · 수치 ' + pct(rep.bind.num.bound, rep.bind.num.literal) + '%<br>'
    + '못 되짚은 색: ' + (rep.literals.color.join(' ') || '없음') + '<br>'
    + '<label><input type="checkbox" onchange="document.body.classList.toggle(\'mark\',this.checked)"> 못 되짚은 자리 표시</label></div>'
  ].join('\n'));
  console.log('\nHTML 을 썼습니다 — ' + OUT);
}

if (fail.length) {
  console.log('\n문제 ' + fail.length + '건');
  fail.forEach((f) => console.log('  · ' + f));
  process.exitCode = 1;
} else {
  console.log('\n가져오기 이상 없음');
}

/* 토큰 이름 → 실제 값. 데모의 sxMakeIndex 와 같은 규칙으로 별칭을 푼다. */
function makeResolve(payload, mode) {
  const byKey = new Map();
  for (const v of (payload.variables || [])) byKey.set(v.collection + ' ' + v.name, v);
  const defMode = new Map();
  for (const c of (payload.collections || [])) defMode.set(c.name, c.defaultMode || (c.modes || [])[0]);
  const colOf = new Map();
  for (const v of (payload.variables || [])) if (!colOf.has(v.name)) colOf.set(v.name, v.collection);
  function res(col, name, m, d) {
    const v = byKey.get(col + ' ' + name);
    if (!v || d > 8) return null;
    const mv = v.values[m] || v.values[defMode.get(col)] || v.values[Object.keys(v.values)[0]];
    if (!mv) return null;
    if (mv.kind === 'alias') return res(mv.collection, mv.name, defMode.get(mv.collection), d + 1);
    return mv.value;
  }
  return function (name) {
    const col = colOf.get(name);
    if (!col) return null;
    const v = res(col, name, col === 'Web' ? mode : defMode.get(col), 0);
    return typeof v === 'number' ? v + 'px' : v;
  };
}
