// figma/relayout-payload.js
//
// build-payload.json 의 5컬렉션 배치를 새 Figma 파일용 7컬렉션 배치로 옮긴다.
//
//   Scale            → Primitive
//   Brand            → Brand
//   Semantic(COLOR)  → Semantic/color
//   Semantic(FLOAT)  → Semantic/dimension
//   (신규)           → Semantic/typo      ← tokens.json 의 typography 에서 합성
//   Radius           → Radius
//   Web              → Web
//
// 왜 7개인가. 화면 캡처의 배치는 4개(Semantic/color·typo·dimension·Primitive)였는데
// Figma 컬렉션은 모드축을 하나만 가진다. Radius(sharp/default/rounded)와
// Web(mobile/tablet/desktop)은 성격이 다른 축이라 한 컬렉션에 같이 못 산다 — 그래서 따로 뺀다.
// Brand 는 교체 지점이라 눈에 띄는 자리에 그대로 둔다.
//
// 사용: node figma/relayout-payload.js [--in build-payload.json] [--tokens tokens.json] [--out build-payload.split7.json]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

const IN_PATH     = arg('--in',     path.join(__dirname, 'build-payload.json'));
const TOKENS_PATH = arg('--tokens', path.join(__dirname, 'tokens.json'));
const OUT_PATH    = arg('--out',    path.join(__dirname, 'build-payload.split7.json'));

const P = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
const T = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));

const warnings = [];

// ── 목적지 컬렉션 ─────────────────────────────────────────────────────────
// 이름에 슬래시를 넣으면 Figma 가 "Semantic" 그룹 아래로 묶어 준다 — 캡처의 배치와 같다.
const collections = [
  { name: 'Primitive',          modes: ['Value'], defaultMode: 'Value',
    note: '원시값. 아무 것도 별칭하지 않는다. (구 Scale)' },
  { name: 'Brand',              modes: ['Value'], defaultMode: 'Value',
    note: '★ 교체 지점. 여기만 갈면 전체가 따라온다.' },
  { name: 'Semantic/color',     modes: ['Light'], defaultMode: 'Light',
    note: 'Dark 모드는 아직 없다 — 추가되면 modes 에 붙는다.' },
  { name: 'Semantic/typo',      modes: ['Value'], defaultMode: 'Value',
    note: '굵기를 뺀 27개 역할 × size·lineHeight·letterSpacing. 텍스트 스타일이 참조한다.' },
  { name: 'Semantic/dimension', modes: ['Value'], defaultMode: 'Value',
    note: '간격·크기·접근성 치수. 색이 아니므로 Light 모드가 필요 없다.' },
  { name: 'Radius',             modes: ['sharp', 'default', 'rounded'], defaultMode: 'default',
    note: '곡률 성격 스왑. 직교 모드축이라 따로 산다.' },
  { name: 'Web',                modes: ['mobile', 'tablet', 'desktop'], defaultMode: 'mobile',
    note: '반응형 스텝. 직교 모드축이라 따로 산다.' }
];

// ── 원본 변수 → 목적지 컬렉션 ─────────────────────────────────────────────
function target(v) {
  switch (v.collection) {
    case 'Scale':  return 'Primitive';
    case 'Brand':  return 'Brand';
    case 'Radius': return 'Radius';
    case 'Web':    return 'Web';
    case 'Semantic': return v.type === 'COLOR' ? 'Semantic/color' : 'Semantic/dimension';
    default: throw new Error('알 수 없는 컬렉션: ' + v.collection);
  }
}

// 원본 (컬렉션::이름) → 목적지 컬렉션. 별칭을 다시 가리키려면 이 표가 필요하다.
const moved = new Map();
for (const v of P.variables) moved.set(v.collection + '::' + v.name, target(v));

// 모드 키 재작성. Semantic 의 'Light' 는 색에만 뜻이 있다 — 치수 쪽은 'Value' 로 바꾼다.
const MODE_REMAP = { 'Semantic/dimension': { Light: 'Value' } };

const variables = [];
for (const v of P.variables) {
  const to = target(v);
  const remap = MODE_REMAP[to] || {};
  const values = {};
  for (const m of Object.keys(v.values)) {
    const e = v.values[m];
    let out;
    if (e.kind === 'alias') {
      const key = e.collection + '::' + e.name;
      const dest = moved.get(key);
      if (!dest) { warnings.push('별칭 대상 없음: ' + v.collection + '/' + v.name + ' → ' + key); out = e; }
      else out = { kind: 'alias', collection: dest, name: e.name };
    } else {
      out = e;
    }
    values[remap[m] || m] = out;
  }
  variables.push({
    collection: to,
    name: v.name,
    type: v.type,
    values,
    scopes: v.scopes,
    codeSyntax: v.codeSyntax
  });
}

// ── Semantic/typo 합성 ────────────────────────────────────────────────────
// tokens.json 의 typography 키는 굵기가 마지막 마디에 붙어 있다(body/md/400).
// 굵기를 떼면 27개 역할이 남고, 같은 역할 안에서 size·lineHeight·letterSpacing 이
// 굵기에 따라 달라지는 경우는 하나도 없다 — 그래서 굵기 없는 변수로 접을 수 있다.
// 굵기는 텍스트 스타일 이름에만 남는다(body/md/400).
const GEO = [
  ['size',          'size',          ['FONT_SIZE']],
  ['lineHeight',    'lineHeight',    ['LINE_HEIGHT']],
  ['letterSpacing', 'letterSpacing', ['LETTER_SPACING']]
];

const roles = new Map();   // 역할 → {size, lineHeight, letterSpacing}
for (const key of Object.keys(T.typography)) {
  const seg = key.split('/');
  const last = seg[seg.length - 1];
  const role = /^\d+$/.test(last) ? seg.slice(0, -1).join('/') : key;
  const t = T.typography[key];
  const geo = { size: t.size, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing };
  const prev = roles.get(role);
  if (prev) {
    for (const [, f] of GEO.map(g => [0, g[0]])) {
      if (prev[f] !== geo[f]) warnings.push('타이포 역할 ' + role + ' 의 ' + f + ' 가 굵기마다 다릅니다 — 접을 수 없습니다.');
    }
  } else {
    roles.set(role, geo);
  }
}

const css = n => 'var(--' + n.replace(/\//g, '-') + ')';
let typoN = 0;
for (const [role, geo] of roles) {
  for (const [field, suffix, scopes] of GEO) {
    const value = geo[field];
    if (typeof value !== 'number') { warnings.push('타이포 ' + role + '/' + field + ' 값이 숫자가 아닙니다.'); continue; }
    variables.push({
      collection: 'Semantic/typo',
      name: role + '/' + suffix,
      type: 'FLOAT',
      values: { Value: { kind: 'value', value } },
      scopes,
      codeSyntax: { WEB: css('type/' + role + '/' + suffix) }
    });
    typoN++;
  }
}

// ── 검산 ──────────────────────────────────────────────────────────────────
// 이름이 컬렉션 안에서 겹치면 Figma 에서 하나가 다른 하나를 덮는다. 미리 잡는다.
const seen = new Set();
for (const v of variables) {
  const k = v.collection + '::' + v.name;
  if (seen.has(k)) warnings.push('이름 중복: ' + k);
  seen.add(k);
}

const dist = {};
for (const v of variables) {
  dist[v.collection] = dist[v.collection] || {};
  dist[v.collection][v.type] = (dist[v.collection][v.type] || 0) + 1;
}

const out = {
  $meta: Object.assign({}, P.$meta, {
    generator: 'figma/relayout-payload.js (figma/gen-payload.js 산출물 재배치)',
    layout: '7컬렉션 — Primitive · Brand · Semantic/color · Semantic/typo · Semantic/dimension · Radius · Web',
    source: path.relative(ROOT, IN_PATH),
    typoRoles: roles.size,
    warnings: (P.$meta.warnings || []).concat(warnings)
  }),
  collections,
  variables,
  styles: P.styles,
  components: P.components
};
// 이 페이로드는 빈 파일에 새로 짓는 용도다 — 옮길 기존 변수가 없으니 이관표는 뺀다.
// (기존 파일 갱신에는 build-payload.json 쪽의 migrations 를 쓴다.)

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1), 'utf8');

console.log('원본 ' + P.variables.length + ' + 타이포 합성 ' + typoN + ' = ' + variables.length + '개');
console.log('타이포 역할 ' + roles.size + '개');
for (const c of collections) {
  console.log('  ' + c.name.padEnd(20) + JSON.stringify(dist[c.name] || {}) + '  modes=' + c.modes.join('/'));
}
console.log(warnings.length ? ('경고 ' + warnings.length + '건\n  · ' + warnings.join('\n  · ')) : '경고 없음(재배치)');
console.log('→ ' + path.relative(ROOT, OUT_PATH));
