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
const collections = [
  { name: 'Scale',    modes: ['Value'], defaultMode: 'Value',   note: '원시값. 아무 것도 별칭하지 않는다.' },
  { name: 'Brand',    modes: ['Value'], defaultMode: 'Value',   note: '★ 교체 지점. 여기만 갈면 전체가 따라온다.' },
  { name: 'Semantic', modes: ['Light'], defaultMode: 'Light',   note: 'Dark 모드는 아직 없다 — 추가되면 modes에 붙는다.' },
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
  if (hit > 0 && hit < Object.keys(brandColors).length) W('브랜드 색 ' + hit + '/12만 채워졌습니다 — 나머지는 플레이스홀더.');
}
for (const [name, hex] of Object.entries(brandColors)) {
  V({ collection: 'Brand', name, type: 'COLOR', values: { Value: val(hex) } });
}
// 3b) Brand — 서체 (CSS 스택에서 첫 패밀리만 뽑는다. Figma는 스택을 모른다.)
const firstFamily = stack => String(stack).split(',')[0].trim().replace(/^["']|["']$/g, '');
for (const [k, v] of Object.entries(T.brand.font || {})) {
  V({ collection: 'Brand', name: 'font/' + k, type: 'STRING', scopes: ['FONT_FAMILY'],
      values: { Value: val(firstFamily(v)) }, codeSyntax: { WEB: css('brand/font/' + k) },
      note: 'CSS 원본: ' + v });
}

// 4) Semantic — 색
// 별칭 대상이 Brand인지 Scale인지는 tokens.json의 brand 플래그가 알려준다.
for (const [name, d] of Object.entries(T.semantic.color)) {
  const target = d.brand ? 'Brand' : 'Scale';
  const pool = d.brand ? brandColors : T.scale.color;
  if (!(d.alias in pool)) W('semantic.color ' + name + ' → ' + target + '/' + d.alias + ' 대상 없음');
  V({ collection: 'Semantic', name, type: 'COLOR', scopes: d.scopes || ['FRAME_FILL'],
      values: { Light: alias(target, d.alias) } });
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
    V({ collection: 'Semantic', name, type: 'FLOAT', scopes,
        values: { Light: alias(inScale ? 'Scale' : 'Semantic', d.alias) } });
  } else {
    // a11y/contrast/* 같은 원시 상수 — 별칭이 없고 값만 있다
    V({ collection: 'Semantic', name, type: 'FLOAT', scopes,
        values: { Light: val(d.value) }, note: d.note || null });
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
const displayFamily = firstFamily((T.brand.font || {}).display || 'Pretendard Variable');
const textFamily    = firstFamily((T.brand.font || {}).text    || 'Pretendard Variable');
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
const effectStyles = [];
for (const [name, cssStr] of Object.entries(T.effect.elevation)) {
  const e = parseShadow(cssStr);
  if (!e) { W('effect ' + name + ' 의 그림자 문자열을 해석하지 못했습니다: ' + cssStr); continue; }
  effectStyles.push({ name, effects: [e], source: cssStr });
}

// ---------- 컴포넌트 ----------
// 스키마의 variantAxes/tokenBindings 가 그대로 컴포넌트셋 구조다.
// 페이로드는 구조만 옮기고, 실제 노드 생성 규칙은 플러그인이 해석한다.
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
for (const k of ['2xs','s','m','l','2xl']) R('Radius', 'radius/' + k, 'radius/' + SZ[k]);

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
    brand: { connected: brandConnected, source: brandSource },
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
  styles: { fontsToLoad, text: textStyles, effect: effectStyles },
  components
};

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
  + ' · 폰트 조합 ' + fontsToLoad.length + ' · 컴포넌트 ' + components.length);
if (warn.length) { console.log('\n경고 ' + warn.length + '건'); warn.forEach(w => console.log('  · ' + w)); }
else console.log('\n경고 없음');
