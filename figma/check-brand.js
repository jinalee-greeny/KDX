/* 브랜드가 실제로 페이로드까지 내려왔는지 검사한다.
 *
 * 왜 필요한가: 데모에서 브랜드를 초록으로 바꿔도 Figma 로 나가는 값은 계속 파랬다.
 * 계단(Brand → Semantic → 컴포넌트)은 맞게 놓여 있었지만 첫 칸에 아무도 값을 넣지
 * 않았기 때문이다. 눈으로는 데모가 초록이라 아무 검사도 빨개지지 않았다.
 * 이 하네스는 "브랜드 파일 하나"와 "페이로드 하나"를 나란히 놓고, 브랜드가
 * 12스톱 · 서체 · 시맨틱 · 컴포넌트 · 그라디언트까지 전부 도달했는지 본다.
 *
 * 사용
 *   node figma/check-brand.js --brand brand.json [build-payload.json]
 *   node figma/check-brand.js --brand brand.json --allow-placeholder   … 딥블루 자체를 검사할 때
 */
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = k => argv.indexOf(k) >= 0;
const ROOT = path.resolve(__dirname, '..');
const BRAND_PATH = arg('--brand', null);
const TOKENS_PATH = arg('--tokens', path.join(ROOT, 'tokens', 'tokens.json'));
const rest = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--brand', '--tokens'].includes(argv[i - 1])));
const PAYLOAD_PATH = rest[0] ? path.resolve(rest[0]) : path.join(__dirname, 'build-payload.json');

if (!BRAND_PATH) { console.error('--brand <brand.json> 이 필요합니다.'); process.exit(2); }

const P = JSON.parse(fs.readFileSync(PAYLOAD_PATH, 'utf8'));
const B = JSON.parse(fs.readFileSync(BRAND_PATH, 'utf8'));
const T = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));

/* 램프 스톱은 tokens.json 이 정본이다 — 여기에 숫자를 다시 적으면 그 사본이 곧 낡는다. */
const STOPS = Object.keys(T.brand['color/primary']).map(k => k.replace('color/primary/', ''));
const PLACEHOLDER = new Map();               // 플레이스홀더 딥블루 hex → 스톱 이름
for (const [k, v] of Object.entries(T.brand['color/primary'])) PLACEHOLDER.set(v.toLowerCase(), k);

const fail = [], note = [];
const F = m => fail.push(m);
const N = m => note.push(m);

const norm = h => String(h).trim().toLowerCase();
const isHex = h => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(norm(h));

/* ---------- 브랜드 파일 자체 ---------- */
const src = B['color/primary'] || B.colors || {};
const brandRamp = {};
for (const s of STOPS) {
  const v = src['color/primary/' + s] !== undefined ? src['color/primary/' + s] : src[s];
  if (v === undefined) F('브랜드 파일에 스톱 ' + s + ' 이 없습니다 — 램프가 ' + STOPS.length + '스톱으로 완성되지 않았습니다.');
  else if (!isHex(v)) F('브랜드 파일 스톱 ' + s + ' 이 hex 가 아닙니다: ' + v);
  else brandRamp[s] = norm(v);
}
const brandName = B.name || B.source || path.basename(BRAND_PATH);
const brandIsPlaceholder = STOPS.every(s => brandRamp[s] && PLACEHOLDER.get(brandRamp[s]) === 'color/primary/' + s);
if (brandIsPlaceholder && !has('--allow-placeholder'))
  F('브랜드 파일이 플레이스홀더 딥블루와 같습니다 — 이 하네스로는 아무것도 증명되지 않습니다.');

/* ---------- 페이로드 색인 ---------- */
const idx = new Map();                                   // 컬렉션::이름 → 변수
for (const v of P.variables || []) idx.set(v.collection + '::' + v.name, v);
const byName = new Map();
for (const v of P.variables || []) { if (byName.has(v.name)) byName.set(v.name, null); else byName.set(v.name, v); }

/* 별칭을 끝까지 따라가면서 어떤 컬렉션들을 거쳤는지 같이 돌려준다. */
function trace(name, seen) {
  seen = seen || [];
  if (seen.includes(name)) return { hex: null, via: seen };
  const v = byName.get(name);
  if (!v) return { hex: null, via: seen };
  const e = v.values[Object.keys(v.values)[0]];
  const via = seen.concat(v.collection);
  if (e.kind === 'value') return { hex: norm(e.value), via };
  const t = idx.get(e.collection + '::' + e.name);
  if (!t) return { hex: null, via };
  return trace(t.name, via.concat(name));
}

/* ---------- 1. $meta ---------- */
const meta = (P.$meta && P.$meta.brand) || {};
if (meta.connected !== true)
  F('$meta.brand.connected 이 ' + JSON.stringify(meta.connected) + ' 입니다 — 페이로드는 자기가 플레이스홀더라고 말하고 있습니다.');
if (meta.source && brandName && !String(meta.source).includes(String(brandName)))
  N('$meta.brand.source = "' + meta.source + '" · 브랜드 파일 이름 = "' + brandName + '"');

/* ---------- 2. Brand 컬렉션 12스톱 ---------- */
let stopHit = 0;
for (const s of STOPS) {
  const v = idx.get('Brand::color/primary/' + s);
  if (!v) { F('Brand/color/primary/' + s + ' 변수가 페이로드에 없습니다.'); continue; }
  const got = norm(v.values.Value && v.values.Value.value);
  const want = brandRamp[s];
  if (!want) continue;
  if (got !== want) {
    const ph = PLACEHOLDER.get(got);
    F('Brand/color/primary/' + s + ' = ' + got + (ph ? ' (플레이스홀더 딥블루 그대로)' : '') + ' · 브랜드는 ' + want);
  } else stopHit++;
}

/* ---------- 3. 서체 ---------- */
const wantFont = B.font || {};
const firstFamily = stack => String(stack).split(',')[0].trim().replace(/^["']|["']$/g, '');
for (const k of ['display', 'text']) {
  if (!wantFont[k]) continue;
  const v = idx.get('Brand::font/' + k);
  if (!v) { F('Brand/font/' + k + ' 변수가 페이로드에 없습니다.'); continue; }
  const got = String(v.values.Value && v.values.Value.value);
  const want = firstFamily(wantFont[k]);
  if (got !== want) F('Brand/font/' + k + ' = "' + got + '" · 브랜드는 "' + want + '"');
}
/* 텍스트 스타일도 같은 서체를 써야 한다 — 변수만 갈고 스타일이 남으면 화면은 옛 서체로 나온다. */
if (wantFont.display || wantFont.text) {
  const wd = firstFamily(wantFont.display || wantFont.text);
  const wt = firstFamily(wantFont.text || wantFont.display);
  const bad = new Set();
  for (const t of (P.styles && P.styles.text) || []) {
    const want = t.name.startsWith('display/') ? wd : wt;
    if (t.fontFamily !== want) bad.add(t.fontFamily + ' → ' + want);
  }
  if (bad.size) F('텍스트 스타일의 서체가 브랜드와 다릅니다: ' + [...bad].join(' · '));
}

/* ---------- 4. 시맨틱 계단 ---------- */
const brandSem = [];
for (const v of P.variables || []) {
  if (v.collection !== 'Semantic' || v.type !== 'COLOR') continue;
  const e = v.values.Light;
  if (!e || e.kind !== 'alias') continue;
  if (e.collection !== 'Brand') continue;
  brandSem.push(v.name);
  const r = trace(v.name);
  if (!r.hex) { F('시맨틱 ' + v.name + ' 의 별칭이 색까지 풀리지 않습니다.'); continue; }
  const stop = PLACEHOLDER.get(r.hex);
  if (stop && !Object.values(brandRamp).includes(r.hex))
    F('시맨틱 ' + v.name + ' 가 여전히 플레이스홀더 ' + stop + ' (' + r.hex + ') 로 풀립니다.');
}
if (!brandSem.length) F('Brand 컬렉션을 별칭하는 시맨틱이 하나도 없습니다 — 계단이 끊겼습니다.');

/* ---------- 5. 컴포넌트까지 도달했는가 ---------- */
const used = new Set(((P.$componentBuilds || {}).usesTokens) || []);
const reached = [], stuck = [];
for (const name of used) {
  const r = trace(name);
  if (!r.hex || !r.via.includes('Brand')) continue;
  reached.push(name);
  if (PLACEHOLDER.has(r.hex) && !Object.values(brandRamp).includes(r.hex)) stuck.push(name + ' = ' + r.hex);
}
if (!reached.length) F('컴포넌트가 참조하는 토큰 중 Brand 를 거치는 것이 하나도 없습니다 — 브랜드를 갈아도 컴포넌트는 안 바뀝니다.');
for (const s of stuck) F('컴포넌트 토큰 ' + s + ' 가 플레이스홀더 딥블루로 풀립니다.');

/* ---------- 6. 그라디언트 ---------- */
if (B.gradient) {
  const paints = (P.styles && P.styles.paint) || [];
  const g = paints.find(p => /gradient/i.test(p.name));
  if (!g) F('브랜드에 그라디언트가 있는데 페이로드에 페인트 스타일이 없습니다 (styles.paint).');
  else {
    const want = (B.gradient.stops || []).map(norm).filter(isHex);
    const got = (g.stops || []).map(s => norm(s.hex || s));
    for (const w of want) if (!got.includes(w)) F('그라디언트 정지점 ' + w + ' 이 페인트 스타일에 없습니다.');
    if (!want.length) N('브랜드 그라디언트에 hex 정지점이 없습니다 — 대조를 건너뜁니다.');
  }
}

/* ---------- 보고 ---------- */
console.log('브랜드 "' + brandName + '" · 스톱 ' + STOPS.length + ' · 페이로드 ' + path.relative(ROOT, PAYLOAD_PATH));
console.log('  Brand 스톱 일치 ' + stopHit + '/' + STOPS.length
  + ' · Brand 별칭 시맨틱 ' + brandSem.length
  + ' · 브랜드가 닿는 컴포넌트 토큰 ' + reached.length);
for (const n of note) console.log('  참고 · ' + n);
if (fail.length) {
  console.log('\n브랜드가 도달하지 못한 곳 ' + fail.length + '건');
  for (const f of fail) console.log('  · ' + f);
} else {
  console.log('\n브랜드가 12스톱 · 서체 · 시맨틱 · 컴포넌트까지 모두 도달했습니다.');
}
process.exitCode = fail.length ? 1 : 0;
