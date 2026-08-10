#!/usr/bin/env node
/* Freesm — Figma 빌드 페이로드 생성기 (v1)
 *
 * 입력  tokens/tokens.json (파운데이션 · 별칭 그래프 · scopes · 모드)
 *       demo/index.html 내장 const SCHEMA (컴포넌트 · variantAxes · tokenBindings)
 * 출력  figma/build-payload.json
 *
 * 페이로드는 "무엇을 만들지"만 서술한다. 어떻게 만들지는 플러그인이 정한다.
 * 삭제 지시는 절대 넣지 않는다 — 페이로드에 없는 기존 변수는 플러그인이 고아로 보고만 한다.
 *
 * 사용
 *   node figma/gen-payload.js
 *   node figma/gen-payload.js --brand brand.json   … 데모에서 연결된 브랜드 색으로 Brand 컬렉션을 채움
 *   node figma/gen-payload.js --out /tmp/p.json
 *   node figma/gen-payload.js --schema x.json       … 데모 대신 외부 스키마 JSON 을 씀(임시 실험용)
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- 인자 ----------
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..');
const TOKENS_PATH = arg('--tokens', path.join(ROOT, 'tokens', 'tokens.json'));
const SCHEMA_PATH = arg('--schema', null);
const DEMO_PATH   = arg('--demo', path.join(ROOT, 'demo', 'index.html'));
const BRAND_PATH  = arg('--brand', null);
const OUT_PATH    = arg('--out', path.join(ROOT, 'figma', 'build-payload.json'));

const T = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));

// 스키마의 단일 원천은 demo/index.html 안에 박혀 있는 const SCHEMA 다.
// 저장소에 사본을 두면 그 사본이 곧 낡는다 — 그래서 여기서 직접 뽑아 쓴다.
// --schema 로 외부 JSON 을 주면 그쪽이 이긴다(임시 실험용).
function loadSchema() {
  if (SCHEMA_PATH) {
    return { src: SCHEMA_PATH, obj: JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')) };
  }
  const html = fs.readFileSync(DEMO_PATH, 'utf8');
  const m = html.match(/const SCHEMA=(\{[\s\S]*?\});\n/);
  if (!m) throw new Error('demo 에서 const SCHEMA= 를 찾지 못했습니다 — ' + DEMO_PATH);
  return { src: path.relative(ROOT, DEMO_PATH) + ' 내장 SCHEMA', obj: JSON.parse(m[1]) };
}
const SCHEMA_SRC = loadSchema();
const S = SCHEMA_SRC.obj;

const warn = [];
const W = m => { warn.push(m); };

// ---------- 컬렉션 ----------
// Value/Light 단일 모드는 지금의 Figma 파일과 같은 이름을 쓴다(개명이 아니라 매칭 대상).
//
// targets — "이 파일에는 이 컬렉션이 다른 이름으로 이미 있다" 는 선언.
//   Figma 는 변수를 컬렉션 사이로 옮길 수 없다. 그러니 우리 이름으로 컬렉션을 새로 만들면
//   같은 변수가 두 벌이 되고, 기존 화면·컴포넌트의 바인딩은 그대로 옛 변수를 가리킨 채 남는다.
//   되돌릴 방법도 없다(386개를 다시 만들고 전부 다시 걸어야 한다).
//   그래서 페이로드는 자기 이름을 고집하지 않고, 붙일 자리를 미리 적어 둔다.
//
//   · match   — 파일에 이 이름의 컬렉션이 있으면 거기에 붙인다
//   · types   — 이 대상이 받는 변수 타입 (한 컬렉션이 타입별로 쪼개져 있을 때)
//   · modeMap — 페이로드 모드 이름 → 파일 모드 이름. 표에 없는 모드는 버린다(사유를 적을 것).
//
//   파일에 match 가 하나도 없으면 페이로드 이름 그대로 새로 만든다 — 빈 파일에 처음 붙이는 경우다.
//   대응 결과는 차이확인(dry-run)에 표로 나온다. 사람이 보고 승인한 뒤에만 적용한다.
const collections = [
  { name: 'Scale',    modes: ['Value'], defaultMode: 'Value',   note: '원시값. 아무 것도 별칭하지 않는다.',
    targets: [{ match: 'Primitive', modeMap: { Value: 'Value' }, note: '구 split7 경로가 쓰던 이름.' }] },
  { name: 'Brand',    modes: ['Value'], defaultMode: 'Value',   note: '★ 교체 지점. 여기만 갈면 전체가 따라온다.' },
  { name: 'Semantic', modes: ['Light', 'Dark'], defaultMode: 'Light', note: '모드 축. Dark 는 tokens.json 의 dark 별칭이 정한다(figma/dark-map.js).',
    targets: [
      { match: 'Semantic/color', types: ['COLOR'], modeMap: { Light: 'Light', Dark: 'Dark' },
        note: 'Dark 는 이 컬렉션에 새로 생긴다.' },
      { match: 'Semantic/dimension', types: ['FLOAT', 'STRING'], modeMap: { Light: 'Value' },
        note: '수치는 라이트·다크가 같은 값이다. Dark 를 버리는 이유 — 모드축을 붙여 봐야 두 칸이 늘 같고, 파일에는 뜻 없는 축이 하나 는다.' }
    ] },
  { name: 'Radius',   modes: ['sharp', 'default', 'rounded'], defaultMode: 'default', note: '곡률 성격 스왑. 직교 모드축.' },
  { name: 'Web',      modes: ['mobile', 'tablet', 'desktop'],  defaultMode: 'mobile', note: '반응형 스텝. 직교 모드축.' }
];

// ---------- 변수 ----------
const variables = [];
const css = n => 'var(--' + n.replace(/\//g, '-') + ')';
const V = o => { variables.push(Object.assign({ scopes: [], codeSyntax: { WEB: css(o.name) } }, o)); };
const val   = v => ({ kind: 'value', value: v });
const alias = (collection, name) => ({ kind: 'alias', collection, name });

// 1) Scale — 색
for (const [name, hex] of Object.entries(T.scale.color)) {
  V({ collection: 'Scale', name, type: 'COLOR', values: { Value: val(hex) } });
}
// 2) Scale — 치수 (원시. scopes 없음 = 실수로 바인딩되지 않게)
for (const [name, v] of Object.entries(T.scale.dimension)) {
  V({ collection: 'Scale', name, type: 'FLOAT', values: { Value: val(parseFloat(v)) } });
}

// 3) Brand — 색 (연결된 브랜드가 있으면 그 값으로 덮어씀)
let brandSource = T.$meta.brand_status || 'placeholder';
let brandColors = Object.assign({}, T.brand['color/primary']);
let brandFonts  = Object.assign({}, T.brand.font || {});
let brandGradient = null;
let brandConnected = false;
if (BRAND_PATH) {
  const B = JSON.parse(fs.readFileSync(BRAND_PATH, 'utf8'));
  const src = B['color/primary'] || B.colors || B;
  let hit = 0;
  for (const k of Object.keys(brandColors)) {
    const v = src[k] || src[k.replace('color/primary/', '')];
    if (v) { brandColors[k] = v; hit++; }
  }
  if (hit === 0) W('--brand 파일에서 color/primary/* 를 하나도 찾지 못해 플레이스홀더를 유지합니다.');
  else { brandConnected = true; brandSource = B.name || B.source || path.basename(BRAND_PATH); }
  if (hit > 0 && hit < Object.keys(brandColors).length)
    W('브랜드 색 ' + hit + '/' + Object.keys(brandColors).length + '만 채워졌습니다 — 나머지는 플레이스홀더.');
  // 서체 — 색만 갈고 서체를 두면 화면은 절반만 그 브랜드가 된다.
  // 텍스트 스타일도 아래에서 같은 값을 쓴다(변수만 갈면 스타일이 옛 서체를 붙든다).
  for (const k of ['display', 'text']) if (B.font && B.font[k]) { brandFonts[k] = B.font[k]; brandConnected = true; }
  if (B.gradient && Array.isArray(B.gradient.stops) && B.gradient.stops.length >= 2) brandGradient = B.gradient;
}
for (const [name, hex] of Object.entries(brandColors)) {
  V({ collection: 'Brand', name, type: 'COLOR', values: { Value: val(hex) } });
}
// 3b) Brand — 서체 (CSS 스택에서 첫 패밀리만 뽑는다. Figma는 스택을 모른다.)
const firstFamily = stack => String(stack).split(',')[0].trim().replace(/^["']|["']$/g, '');
for (const [k, v] of Object.entries(brandFonts)) {
  V({ collection: 'Brand', name: 'font/' + k, type: 'STRING', scopes: ['FONT_FAMILY'],
      values: { Value: val(firstFamily(v)) }, codeSyntax: { WEB: css('brand/font/' + k) },
      note: 'CSS 원본: ' + v });
}

// 4) Semantic — 색
// 별칭 대상이 Brand인지 Scale인지는 tokens.json의 brand 플래그가 알려준다.
//
// 4a) 먼저 autoContrast 를 가진 토큰들의 별칭을 "재서" 정한다.
// 브랜드가 밝으면 흰 글자가 무너진다 — 그때 따라 움직여야 하는 것은 글자이지 사람이 아니다.
const { pickOnAccent } = require('./onaccent');
const SEMODES = ['Light', 'Dark'];
/* 모드마다 시맨틱이 가리키는 원시값이 다르다 — Dark 는 tokens.json 의 dark 별칭을 쓰고,
   없으면(static/* 처럼 뜻이 '모드 무관'인 것) Light 와 같은 값을 그대로 쓴다. */
const aliasFor = (d, mode) => (mode === 'Dark' && d.dark) ? d.dark : d.alias;
const hexOfSemantic = (n, mode) => {
  const d = T.semantic.color[n];
  if (!d) return null;
  return (d.brand ? brandColors : T.scale.color)[aliasFor(d, mode)] || null;
};
const hexOfRef = c => (c.brand ? brandColors[c.brand] : T.scale.color[c.scale]) || null;

/* 4a) autoContrast 를 모드마다 따로 잰다.
   같은 브랜드라도 바닥이 흰 종이일 때와 먹지일 때 이기는 후보가 다르다 —
   한 번만 재고 두 모드에 같은 답을 쓰면, 한쪽은 반드시 틀린다. */
const aliasOverride = { Light: {}, Dark: {} };
const onAccentReport = { Light: [], Dark: [] };
for (const mode of SEMODES) {
  const pageHex = hexOfSemantic('bg/default', mode) || (mode === 'Dark' ? '#0e0f10' : '#ffffff');
  for (const [name, d] of Object.entries(T.semantic.color)) {
    const ac = d.autoContrast;
    if (!ac) continue;
    const backdrop = hexOfSemantic(ac.on, mode);
    const candHex = (ac.candidates || []).map(hexOfRef);
    const steps = (ac.fillFallback && ac.fillFallback.steps) || [];
    const stepHex = steps.map(n => brandColors[n] || T.scale.color[n] || null);
    if (!backdrop || candHex.some(h => !h) || stepHex.some(h => !h)) {
      W('autoContrast ' + name + '(' + mode + ') 의 배경/후보 색을 다 찾지 못해 기본 별칭을 그대로 둡니다.');
      continue;
    }
    const r = pickOnAccent(backdrop, candHex, ac.min, stepHex, pageHex);
    const win = ac.candidates[r.fg];
    aliasOverride[mode][name] = win.brand
      ? { collection: 'Brand', name: win.brand }
      : { collection: 'Scale', name: win.scale };
    let stepped = null;
    if (r.fill >= 0) {
      const ft = ac.fillFallback.token;
      const fd = T.semantic.color[ft];
      stepped = steps[r.fill];
      aliasOverride[mode][ft] = { collection: fd && fd.brand ? 'Brand' : 'Scale', name: stepped };
      W('대비를 맞추려고 ' + ft + '(' + mode + ') 를 ' + stepped + ' 로 한 스톱 어둡게 했습니다.');
    }
    if (r.short) W('autoContrast ' + name + '(' + mode + ') 이 ' + ac.min + ':1 을 못 넘겼습니다 — 최선이 ' + r.ratio.toFixed(2) + ':1.');
    onAccentReport[mode].push({
      token: name, on: ac.on, min: ac.min,
      picked: aliasOverride[mode][name].collection + '/' + aliasOverride[mode][name].name,
      ratio: Math.round(r.ratio * 100) / 100,
      fillStepped: stepped, short: r.short
    });
  }
}

// 4b) 그 다음에 전부 내보낸다(재계산 결과가 있으면 그쪽이 이긴다).
for (const [name, d] of Object.entries(T.semantic.color)) {
  const values = {};
  for (const mode of SEMODES) {
    const ov = aliasOverride[mode][name];
    const target = ov ? ov.collection : (d.brand ? 'Brand' : 'Scale');
    const aliasName = ov ? ov.name : aliasFor(d, mode);
    const pool = target === 'Brand' ? brandColors : T.scale.color;
    if (!(aliasName in pool)) W('semantic.color ' + name + '(' + mode + ') → ' + target + '/' + aliasName + ' 대상 없음');
    values[mode] = alias(target, aliasName);
  }
  V({ collection: 'Semantic', name, type: 'COLOR', scopes: d.scopes || ['FRAME_FILL'], values });
}

// 5) Semantic — 수치
// tokens.json에 scopes가 있으면 그것이 정본. 없을 때만 접두사 표로 추론한다.
// (구 04-semantic-numeric.js가 손으로 주던 값과 같은 표다. 여기서 명문화한다.)
const SCOPE_BY_PREFIX = [
  [/^spacing\//,        ['GAP', 'WIDTH_HEIGHT']],
  [/^w\//,              ['WIDTH_HEIGHT']],
  [/^h\//,              ['WIDTH_HEIGHT']],
  [/^border\//,         ['STROKE_FLOAT']],
  [/^comp\/padding\//,  ['GAP']],
  [/^comp\/gap\//,      ['GAP']],
  [/^comp\/track\//,    ['WIDTH_HEIGHT']],
  [/^a11y\/touch-target\//, ['WIDTH_HEIGHT']],
  [/^a11y\/focus-ring\//,   ['STROKE_FLOAT']],
  [/^a11y\/contrast\//, []]   // 치수가 아니다 — 어디에도 바인딩되면 안 된다
];
const inferScopes = name => {
  for (const [re, sc] of SCOPE_BY_PREFIX) if (re.test(name)) return sc;
  W('수치 ' + name + ' 의 scopes를 추론하지 못해 빈 배열로 둡니다.');
  return [];
};
for (const [name, d] of Object.entries(T.semantic.numeric)) {
  const scopes = d.scopes || inferScopes(name);
  if (d.alias) {
    const inScale = d.alias in T.scale.dimension;
    const inSem   = d.alias in T.semantic.numeric;
    if (!inScale && !inSem) { W('semantic.numeric ' + name + ' → ' + d.alias + ' 대상 없음'); }
    /* 수치는 모드에 따라 달라지지 않는다. 그래도 두 모드에 같은 값을 넣어야 한다 —
       Figma 는 모드마다 값을 요구하고, 비워 두면 그 모드에서 변수가 비어 보인다. */
    const a = alias(inScale ? 'Scale' : 'Semantic', d.alias);
    V({ collection: 'Semantic', name, type: 'FLOAT', scopes,
        values: { Light: a, Dark: a } });
  } else {
    // a11y/contrast/* 같은 원시 상수 — 별칭이 없고 값만 있다
    V({ collection: 'Semantic', name, type: 'FLOAT', scopes,
        values: { Light: val(d.value), Dark: val(d.value) }, note: d.note || null });
  }
}

// 6) Radius — 스텝(모드별 원시값) + comp/radius(스텝 별칭)
const RMODES = T.radius.modes;
for (const [name, per] of Object.entries(T.radius.radius)) {
  const values = {};
  for (const m of RMODES) values[m] = val(per[m]);
  V({ collection: 'Radius', name, type: 'FLOAT', scopes: ['CORNER_RADIUS'], values });
}
for (const [name, d] of Object.entries(T.radius['comp/radius'])) {
  if (!(d.alias in T.radius.radius)) W('comp/radius ' + name + ' → ' + d.alias + ' 대상 없음');
  const values = {};
  for (const m of RMODES) values[m] = alias('Radius', d.alias);
  V({ collection: 'Radius', name, type: 'FLOAT', scopes: ['CORNER_RADIUS'], values });
}

// 7) Web — 반응형 스텝
const WMODES = ['mobile', 'tablet', 'desktop'];
const WEB_SCOPES = {
  'breakpoint':    [],                      // 뷰포트 임계값 — 캔버스에 바인딩할 자리가 없다
  'container/max': [],                      // 문자열(100%/720px) — STRING 변수라 치수 scope가 없다
  'container/pad': ['GAP'],
  'grid/columns':  [],                      // 개수. 치수가 아니다
  'grid/gutter':   ['GAP'],
  'space/section': ['GAP', 'WIDTH_HEIGHT'],
  'space/block':   ['GAP', 'WIDTH_HEIGHT']
};
for (const [name, per] of Object.entries(T.web)) {
  const raw = WMODES.map(m => per[m]);
  const isStr = raw.some(v => typeof v === 'string');
  const scopes = name.startsWith('type/') ? ['FONT_SIZE'] : (WEB_SCOPES[name] || []);
  const values = {};
  let filled = null;
  for (let i = 0; i < WMODES.length; i++) {
    let v = raw[i];
    if (v === undefined) {
      // web.breakpoint 에는 mobile 값이 없다 — 모바일 우선이라 하한이 0이기 때문.
      v = isStr ? '' : 0;
      filled = WMODES[i];
    }
    values[WMODES[i]] = val(isStr ? String(v) : parseFloat(v));
  }
  if (filled) W('web ' + name + ' 의 ' + filled + ' 값이 없어 ' + (isStr ? "''" : '0') + '으로 채웠습니다.');
  V({ collection: 'Web', name, type: isStr ? 'STRING' : 'FLOAT', scopes, values,
      note: isStr ? '문자열 값이라 STRING 변수. 치수로 바인딩되지 않는다.' : null });
}

// ---------- 텍스트 스타일 ----------
// 토큰 이름은 굵기가 없지만(body/md) 스타일 이름은 굵기를 마지막 세그먼트로 유지한다(body/md/400).
// tokens.json의 typography 키가 이미 그 형태다.
const WEIGHT_STYLE = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
                       500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const displayFamily = firstFamily(brandFonts.display || 'Pretendard Variable');
const textFamily    = firstFamily(brandFonts.text    || 'Pretendard Variable');
const textStyles = [];
for (const [name, d] of Object.entries(T.typography)) {
  const style = WEIGHT_STYLE[d.weight];
  if (!style) { W('typography ' + name + ' 의 weight ' + d.weight + ' 에 대응하는 Figma 스타일명이 없습니다.'); continue; }
  textStyles.push({
    name,
    fontFamily: name.startsWith('display/') ? displayFamily : textFamily,
    fontStyle: style,
    fontWeight: d.weight,
    fontSize: d.size,
    lineHeight: { unit: 'PIXELS', value: d.lineHeight },
    // 자간은 px 다. tokens.json 은 단위를 적지 않는데, 같은 자리에 있는 size·lineHeight 가
    // 전부 px 이고 CSS letter-spacing 은 %를 아예 받지 않는다. %로 읽으면 -0.4% of 40px
    // = -0.16px 로 사실상 0이 되어 토큰이 무의미해진다. px 이어야 변수 바인딩도 가능하다.
    letterSpacing: { unit: 'PIXELS', value: d.letterSpacing }
  });
}
// 로드해야 할 폰트 조합 — 플러그인이 createTextStyle 전에 loadFontAsync 로 미리 받아야 한다
const fontsToLoad = [];
const seenFont = new Set();
for (const s of textStyles) {
  const k = s.fontFamily + '|' + s.fontStyle;
  if (!seenFont.has(k)) { seenFont.add(k); fontsToLoad.push({ family: s.fontFamily, style: s.fontStyle }); }
}

// ---------- 이펙트 스타일 ----------
// CSS 그림자 문자열 → Figma DROP_SHADOW.
// 'Ox Oy blur rgba(r,g,b,a)' 형태만 다룬다. spread는 쓰지 않는다(현재 6종 모두 없음).
function parseShadow(cssStr) {
  // '0 2px 2px rgba(0,0,0,.10)' — 단위가 붙은 것도 안 붙은 것도, 0.1도 .10도 받는다.
  const s = String(cssStr).trim();
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const nums = s.slice(0, m.index).trim().split(/\s+/).map(t => parseFloat(t));
  if (nums.length < 3 || nums.some(n => Number.isNaN(n))) return null;
  const [x, y, blur] = nums;
  const spread = nums.length > 3 ? nums[3] : 0;
  const p = m[1].split(',').map(t => parseFloat(t.trim()));
  if (p.length < 3 || p.some(n => Number.isNaN(n))) return null;
  return {
    type: 'DROP_SHADOW',
    offset: { x: x, y: y },
    radius: blur,
    spread: spread,
    color: { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p.length > 3 ? p[3] : 1 },
    blendMode: 'NORMAL',
    visible: true
  };
}
/* 그림자는 겹의 목록이다. 한 겹짜리는 싸구려로 보인다 —
   넓게 퍼지는 겹이 깊이를 만들고 바닥에 붙는 겹이 물체를 앉힌다.
   이펙트 스타일 자체는 모드를 모르지만 그 안의 색은 변수에 걸 수 있으므로,
   겹마다 색 토큰을 따로 들려 보낸다.
   옛 형태도 계속 받는다 — 문자열('0 2px 2px rgba(0,0,0,.10)') 하나든, {shadow,color} 하나든. */
const hexToPaintColor = (hex) => ({
  r: parseInt(hex.substr(1, 2), 16) / 255, g: parseInt(hex.substr(3, 2), 16) / 255,
  b: parseInt(hex.substr(5, 2), 16) / 255, a: parseInt(hex.substr(7, 2), 16) / 255
});
const effectStyles = [];
for (const [name, def] of Object.entries(T.effect.elevation)) {
  const layers = Array.isArray(def) ? def : [def];
  const effects = [], srcs = [];
  for (const layer of layers) {
    const isObj = layer && typeof layer === 'object';
    const geom = isObj ? layer.shadow : layer;
    const colorToken = isObj ? layer.color : null;
    const base = colorToken ? (geom + ' rgba(0,0,0,.10)') : geom;   // 색은 곧 변수가 덮는다
    const e = parseShadow(base);
    if (!e) { W('effect ' + name + ' 의 그림자 문자열을 해석하지 못했습니다: ' + geom); continue; }
    if (colorToken) {
      const d = T.semantic.color[colorToken];
      if (!d) W('effect ' + name + ' 이 없는 색 토큰을 가리킵니다: ' + colorToken);
      e.colorToken = colorToken;
      /* 변수가 안 걸릴 때를 대비한 초깃값 — Light 값을 그대로 넣어 둔다.
         걸리면 이 숫자는 안 보이고, 못 걸리면 적어도 라이트에서는 맞다. */
      const lit = d && T.scale.color[d.alias];
      if (lit && /^#[0-9a-fA-F]{8}$/.test(lit)) e.color = hexToPaintColor(lit);
    }
    effects.push(e);
    srcs.push(colorToken ? (geom + ' ' + colorToken) : geom);
  }
  if (!effects.length) continue;
  effectStyles.push({ name, effects, source: srcs.join(', ') });
}

// ---------- 페인트 스타일 (브랜드 그라디언트) ----------
// 그라디언트는 변수로 표현할 수 없다 — Figma 변수는 단색만 담는다.
// 그래서 브랜드 그라디언트는 '스타일'로 나간다. 컴포넌트는 이 스타일을 쓰지 않는다
// (면 한정 브랜드 표현이라 사람이 직접 얹는다). 브랜드가 없으면 스타일도 없다.
const paintStyles = [];
if (brandGradient) {
  const g = brandGradient;
  const stops = g.stops.map(s => (typeof s === 'string' ? { hex: s } : s))
    .map(s => ({ hex: String(s.hex).trim(), position: s.position }))
    .filter(s => /^#[0-9a-fA-F]{6}$/.test(s.hex));
  if (stops.length < 2) W('브랜드 그라디언트의 정지점이 2개 미만이라 페인트 스타일을 만들지 않습니다.');
  else {
    for (let i = 0; i < stops.length; i++)
      if (typeof stops[i].position !== 'number') stops[i].position = i / (stops.length - 1);
    // CSS 각도(0deg=위쪽, 시계 방향) → Figma gradientTransform.
    // t = a·x + b·y + c 가 시작 0, 끝 1 이 되도록 단위 사각형 안에서 정규화한다.
    const deg = parseFloat(String(g.dir || '135deg')) || 135;
    const rad = deg * Math.PI / 180;
    const dx = Math.sin(rad), dy = -Math.cos(rad);
    const k = 1 / (Math.abs(dx) + Math.abs(dy));
    const a = k * dx, b = k * dy;
    const linear = [[a, b, 0.5 - (a + b) / 2], [-b, a, 0.5 - (a - b) / 2]];
    // 방사형은 캔버스 중심의 원으로만 낸다 — 데모가 수집하는 방향값이 CSS 표기라
    // Figma 의 타원 축까지 복원할 근거가 없다. 근사임을 이름과 note 에 적어 둔다.
    const radial = [[0.5, 0, 0.25], [0, 0.5, 0.25]];
    paintStyles.push({
      name: 'brand/gradient',
      paintType: g.type === 'radial' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
      stops,
      gradientTransform: g.type === 'radial' ? radial : linear,
      source: g.css || (g.type || 'linear') + '-gradient(' + (g.dir || '135deg') + ', ' + stops.map(s => s.hex).join(', ') + ')',
      note: g.type === 'radial' ? '방사형은 중심 원으로 근사했습니다 — 필요하면 Figma 에서 손잡이를 옮기세요.' : null
    });
  }
}

// ---------- 컴포넌트 ----------
// 스키마의 variantAxes/tokenBindings 는 사람이 읽는 서술이다. 그대로 옮겨 목록으로
// 싣되, 플러그인이 실제로 노드를 만들 때 보는 것은 figma/component-build.js 의
// 빌드표다(componentBuilds). 두 축이 어긋나면 아래 검증에서 생성이 멈춘다.
const components = [];
const bindable = new Set(variables.map(v => v.name));
const styleNames = new Set(textStyles.map(s => s.name).concat(effectStyles.map(s => s.name)));
// 스키마의 바인딩 값은 사람이 읽는 주석이 섞여 있다:
//   'comp/radius/modal (4방향 모두)'  → 괄호 주석을 떼고
//   'avatar/{sm,md,lg}'              → 중괄호 축약을 펼쳐서 대조한다.
const cleanRef = s => s.replace(/\s*\(.*$/, '').trim();
const expandRef = s => {
  const m = s.match(/^(.*)\{([^}]+)\}(.*)$/);
  return m ? m[2].split(',').map(x => m[1] + x.trim() + m[3]) : [s];
};
const knownRef = r =>
  bindable.has(r) || styleNames.has(r) || (r in T.typography)
  || textStyles.some(s => s.name.startsWith(r + '/'));
function scanTokens(o, out) {
  if (o == null) return;
  if (typeof o === 'string') {
    const base = cleanRef(o);
    if (!/^[a-z0-9]+\/[a-z0-9{]/i.test(base)) return;   // 토큰 경로처럼 생기지 않으면 무시
    for (const r of expandRef(base)) if (!knownRef(r)) out.push(r);
    return;
  }
  if (Array.isArray(o)) return o.forEach(x => scanTokens(x, out));
  if (typeof o === 'object') for (const k in o) { if (k === 'note') continue; scanTokens(o[k], out); }
}
for (const [name, c] of Object.entries(S.components)) {
  if (name.startsWith('_')) continue;
  const axes = c.variantAxes || {};
  const axisNames = Object.keys(axes);
  const declared = c.variantCount;
  const computed = axisNames.length ? axisNames.reduce((a, k) => a * axes[k].length, 1) : 0;
  if (declared != null && declared !== computed) {
    W('컴포넌트 ' + name + ' 의 variantCount ' + declared + ' 가 축 곱 ' + computed + ' 와 다릅니다.');
  }
  // 바인딩이 가리키는 토큰이 실제로 페이로드에 있는지 확인
  const missing = [];
  scanTokens(c.tokenBindings, missing);
  scanTokens(c.layout, missing);
  const uniq = [...new Set(missing)];
  if (uniq.length) W('컴포넌트 ' + name + ' 이(가) 없는 토큰을 참조: ' + uniq.join(', '));
  components.push({
    name, status: c.status || 'unknown', priority: c.priority ?? null,
    visuallyValidated: !!c.visuallyValidated,
    variantAxes: axes, variantCount: computed,
    layout: c.layout || null,
    tokenBindings: c.tokenBindings || null,
    properties: c.properties || [],
    unresolvedTokens: uniq
  });
}

// ---------- 컴포넌트 빌드표 ----------
// 기계가 읽는 표. 값은 {t:토큰} · {s:스타일} · 숫자/열거값뿐이고 문장이 없다.
// 검증은 경고가 아니라 예외다 — 잘못된 컴포넌트는 변수와 달리 '그럴듯하게 잘못된
// 모양'으로 사용자 파일에 남기 때문에, 어긋나면 페이로드를 아예 내지 않는다.
const CB = require('./component-build.js');
let componentBuilds = [];
let componentBuildMeta = null;
{
  const schemaAxes = {};
  for (const [name, c] of Object.entries(S.components)) {
    if (name.startsWith('_')) continue;
    schemaAxes[name] = c.variantAxes || {};
  }
  let used;
  try {
    used = CB.validate(CB.BUILDS, { variableNames: bindable, styleNames, schemaAxes });
  } catch (e) {
    console.error('\n' + e.message);
    process.exit(1);
  }
  // 스키마에 있는데 빌드표에 없는 컴포넌트는 조용히 빠진다 — 경고로 드러낸다.
  const built = new Set(CB.BUILDS.map(b => b.name));
  for (const name of Object.keys(schemaAxes))
    if (!built.has(name)) W('컴포넌트 ' + name + ' 이(가) 빌드표에 없어 생성되지 않습니다.');

  componentBuilds = CB.BUILDS.map(b => Object.assign({}, b, { variantCount: CB.variantCount(b) }));
  componentBuildMeta = {
    note: '플러그인이 실제로 읽는 표. 값은 {t:토큰}·{s:스타일}·숫자/열거값뿐이다.',
    textStyleMap: CB.TEXT,
    provisional: CB.PROVISIONAL,
    usesTokens: used.tokens,
    usesStyles: used.styles,
    totalVariants: componentBuilds.reduce((a, b) => a + b.variantCount, 0)
  };
}

// ---------- 이관표 (v0.4/구 스크립트 → v0.77) ----------
// 지금 Figma 파일의 278개 변수는 옛 이름이고, Button·Input·Card 레이어가 거기 묶여 있다.
// 플러그인은 이 표를 보고 '제자리 개명'을 해야 기존 바인딩이 살아남는다.
// 표에 없는 이름은 신규 생성, 페이로드에 없는 기존 변수는 고아로 보고만 한다(삭제 금지).
// 구 스크립트는 한 글자 약칭(s·m·l)을 썼다. 2xs·2xl 은 그때도 지금도 같은 이름이므로 표에 없다
// — 사이즈 스케일은 xs~xl 을 벗어나면 문자를 겹치지 않고 숫자를 앞에 붙인다(2xl·2xs).
const SZ = { 's': 'sm', 'm': 'md', 'l': 'lg' };
const variableRenames = [];
const variableSplits  = [];
const R = (collection, from, to) => variableRenames.push({ collection, from, to });

// Semantic — size/* 는 정사각 하나가 w/h 둘로 쪼개진다. 개명만으로는 못 하므로 split 으로 따로 낸다.
for (const [grp, keys] of [['icon', ['xs','s','m','l','xl']], ['control', ['s','m','l']], ['avatar', ['s','m','l']]]) {
  for (const k of keys) {
    const nk = SZ[k] || k;
    variableSplits.push({
      collection: 'Semantic', from: 'size/' + grp + '/' + k,
      into: ['w/' + grp + '/' + nk, 'h/' + grp + '/' + nk],
      keep: 'w', // 기존 변수를 w/* 로 개명하고 h/* 를 새로 만든다 — 높이 바인딩만 다시 걸면 된다
      note: '정사각 치수 1개 → 폭·높이 2개'
    });
  }
}
R('Semantic', 'size/touch-target/min', 'a11y/touch-target/min');
R('Semantic', 'fg/disabled', 'comp/fg/disabled');
for (const k of ['default','subtle','subtler','subtlest','strong','inverse/default','inverse/subtle'])
  R('Semantic', 'bdr/' + k, 'comp/bdr/' + k);
R('Semantic', 'comp/bdr/focus-ring', 'comp/bdr/focused');
// 개명 대상 이름이 이미 파일에 있는 경우 — 구 03-semantic-color.js 가 맨몸 bdr/* 와 comp/bdr/* 를
// 둘 다 만들어 뒀다. 네 자리가 겹친다. 개명하면 이름이 충돌하므로 그렇게 하지 않는다.
// 바인딩은 comp/bdr/* 쪽에 걸려 있으니 그쪽을 남기고 값만 v0.77 로 고치고, 맨몸 bdr/* 를 고아로 낸다.
const conflicts = ['default', 'subtle', 'subtler', 'strong'].map(k => ({
  collection: 'Semantic', existing: 'comp/bdr/' + k, duplicate: 'bdr/' + k,
  action: 'keep-existing-update-value',
  note: 'comp/bdr/' + k + ' 를 남기고 값만 갱신 · bdr/' + k + ' 는 고아로 보고(삭제 금지)'
}));
for (const c of conflicts) {
  const i = variableRenames.findIndex(r => r.from === c.duplicate && r.to === c.existing);
  if (i >= 0) variableRenames.splice(i, 1);
}
R('Semantic', 'status/fg/critical', 'status/fg/error');
R('Semantic', 'status/bg/critical', 'status/bg/error');
for (const [f, t] of [['button-x','button/x'],['button-y','button/y'],['card','card'],['field-x','field/x'],['field-y','field/y']])
  R('Semantic', 'comp/pad/' + f, 'comp/padding/' + t);
for (const k of ['s','m','l']) R('Semantic', 'comp/gap/' + k, 'comp/gap/' + SZ[k]);
// Radius — 스텝 이름만 sm/md/lg 표기로
// 2xs·2xl 은 그때도 지금도 같은 이름이다 — 표에 넣으면 radius/undefined 로 개명해 버린다.
for (const k of ['s','m','l']) R('Radius', 'radius/' + k, 'radius/' + SZ[k]);

// 컬렉션을 건너뛰는 것은 개명이 안 된다. Figma 변수는 컬렉션 사이를 이동하지 못한다.
// 구 02-scale-dimension.js 가 Scale 안에 만들어 둔 spacing/*·radius/* 22개가 여기 해당한다.
const crossCollection = [];
for (const k of ['0','25','50','75','100','125','150','200','250','300','400','500','600','800'])
  crossCollection.push({ from: 'Scale/spacing/' + k, now: 'Semantic/spacing/' + k });
for (const k of ['2xs','xs','s','m','l','xl','2xl','full'])
  crossCollection.push({ from: 'Radius 이전의 Scale/radius/' + k, now: 'Radius/radius/' + (SZ[k] || k) });

// 텍스트 스타일 — 크기 세그먼트 표기만 바뀐다. 구 이름을 정규화해 새 이름과 맞춘다.
const oldTextName = n => n.split('/').map(seg => SZ[seg] || seg).join('/');
const styleRenames = { text: [], effect: [] };
{
  const newSet = new Set(textStyles.map(s => s.name));
  const OLD = ['display/2xl/700','display/xl/700','display/l/700','heading/l/400','heading/l/600',
    'heading/m/400','heading/m/600','heading/s/400','heading/s/600','body/2xl/400','body/2xl/600',
    'body/xl/400','body/xl/600','body/l/400','body/l/600','body/m/400','body/m/500','body/m/600',
    'body/s/400','body/s/500','body/s/600','body/xs/400','body/xs/600','link/m/400','link/m/500',
    'link/m/600','link/s/400','link/s/500','link/s/600','link/xs/400','link/xs/500','link/xs/600',
    'number/tight/l/600','number/tight/m/600','number/tight/s/500','number/standard/m/600',
    'number/standard/s/500','utility/standard/m/500','utility/standard/s/500','utility/standard/xs/500',
    'utility/tight/s/500','utility/tight/xs/500'];
  for (const o of OLD) {
    const t = oldTextName(o);
    if (t !== o && newSet.has(t)) styleRenames.text.push({ from: o, to: t });
    else if (!newSet.has(t)) W('구 텍스트 스타일 ' + o + ' 에 대응하는 새 이름이 없습니다.');
  }
  for (const k of ['1','2','3','4']) styleRenames.effect.push({ from: 'shadow/' + k, to: 'elevation/' + k });
  styleRenames.effect.push({ from: 'shadow/upper', to: 'elevation/upper' });
  styleRenames.effect.push({ from: 'shadow/right', to: 'elevation/right' });
}

// ---------- 조립 ----------
const payload = {
  $meta: {
    payloadVersion: 1,
    generator: 'figma/gen-payload.js',
    tokensVersion: T.$meta.version,
    schemaVersion: S.version,
    schemaSource: SCHEMA_SRC.src,
    brand: {
      connected: brandConnected,
      source: brandSource,
      seed: brandColors['color/primary/50'] || null,
      stops: Object.keys(brandColors).length,
      font: { display: brandFonts.display || null, text: brandFonts.text || null },
      gradient: brandGradient ? (paintStyles.length ? 'brand/gradient' : 'dropped') : null,
      onAccent: onAccentReport
    },
    naming: T.$meta.naming,
    policy: {
      deletes: 'never',
      orphans: 'report-only',
      rename: 'in-place — variable.name 을 고쳐 기존 바인딩을 살린다',
      dryRun: 'required — 적용 전 신규/개명/값변경을 사람이 확인한다'
    },
    warnings: warn
  },
  migrations: {
    note: '옛 이름을 제자리 개명해 기존 바인딩을 살린다. 표에 없으면 신규 생성, 페이로드에 없으면 고아 보고.',
    variableRenames, variableSplits, conflicts, crossCollection, styleRenames
  },
  collections,
  variables,
  styles: { fontsToLoad, text: textStyles, effect: effectStyles, paint: paintStyles },
  components,
  componentBuilds,
  $componentBuilds: componentBuildMeta
};

// ---------- 이관표 자기 검사 ----------
// 개명표는 '옛 이름 → 새 이름'이다. 두 가지가 어긋나면 살아 있는 변수를 망가뜨린다.
//  (1) 새 이름이 비었다 — SZ 표에 없는 키를 넣으면 radius/undefined 같은 것이 나온다.
//  (2) 옛 이름이 지금도 정규 이름이다 — 개명하면 현행 변수를 이름 없는 곳으로 밀어낸다.
{
  const live = new Set(variables.map(v => v.collection + '\u0000' + v.name));
  const bad = [];
  for (const r of variableRenames) {
    if (!r.to || /undefined|^\s*$/.test(String(r.to).split('/').pop()))
      bad.push('개명 새 이름이 비었습니다 — ' + r.collection + '/' + r.from + ' → ' + r.to);
    if (live.has(r.collection + '\u0000' + r.from))
      bad.push('개명 옛 이름이 지금도 정규 이름입니다 — ' + r.collection + '/' + r.from + ' (개명하면 현행 변수가 사라집니다)');
    if (!live.has(r.collection + '\u0000' + r.to))
      bad.push('개명 새 이름이 페이로드에 없습니다 — ' + r.collection + '/' + r.to);
  }
  for (const s of variableSplits) {
    if (live.has(s.collection + '\u0000' + s.from))
      bad.push('분할 옛 이름이 지금도 정규 이름입니다 — ' + s.collection + '/' + s.from);
    for (const n of s.into)
      if (!live.has(s.collection + '\u0000' + n))
        bad.push('분할 결과 이름이 페이로드에 없습니다 — ' + s.collection + '/' + n);
  }
  if (bad.length) {
    console.error('\n이관표 자기 검사 실패 ' + bad.length + '건');
    for (const b of bad) console.error('  · ' + b);
    process.exit(1);
  }
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');

// ---------- 보고 ----------
const byColl = {};
for (const v of variables) byColl[v.collection] = (byColl[v.collection] || 0) + 1;
console.log('출력 ' + OUT_PATH);
console.log('컬렉션 ' + collections.length + ' · 변수 ' + variables.length
  + ' (' + Object.entries(byColl).map(([k, n]) => k + ' ' + n).join(' · ') + ')');
console.log('이관표 — 개명 ' + variableRenames.length + ' · 분할 ' + variableSplits.length
  + ' · 이름충돌 ' + conflicts.length + ' · 컬렉션 이동(개명 불가) ' + crossCollection.length
  + ' · 스타일 개명 ' + (styleRenames.text.length + styleRenames.effect.length));
console.log('텍스트 스타일 ' + textStyles.length + ' · 이펙트 스타일 ' + effectStyles.length
  + ' · 페인트 스타일 ' + paintStyles.length
  + ' · 폰트 조합 ' + fontsToLoad.length + ' · 컴포넌트 ' + components.length);
console.log('브랜드 ' + (brandConnected ? '연결됨 — ' + brandSource : '플레이스홀더 — ' + brandSource)
  + ' · 램프 ' + Object.keys(brandColors).length + '스톱 · 서체 ' + firstFamily(brandFonts.display || '?')
  + (brandGradient ? ' · 그라디언트 1' : ''));
console.log('컴포넌트 빌드표 ' + componentBuilds.length + ' 세트 · 변형 '
  + componentBuildMeta.totalVariants + ' · 참조 토큰 ' + componentBuildMeta.usesTokens.length
  + ' · 참조 스타일 ' + componentBuildMeta.usesStyles.length
  + ' · 잠정 수치 ' + componentBuildMeta.provisional.length);
if (warn.length) { console.log('\n경고 ' + warn.length + '건'); warn.forEach(w => console.log('  · ' + w)); }
else console.log('\n경고 없음');
