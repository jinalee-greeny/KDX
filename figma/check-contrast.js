/* 전경/배경 대비 검사 — build-payload.json 하나만 읽는다.
   왜 필요한가: 토큰 이름이 맞고 별칭이 다 풀려도, 실제로 겹쳐 놓으면 안 보이는 조합이 있다.
   Icon Button 의 Secondary 가 그랬다 — comp/fill/accent/secondary(#205CE9) 위에
   fg/accent/primary(#1245BA) 를 얹어 대비 1.46:1. 그때까지 검사는 전부 초록이었다.
   사용: node figma/check-contrast.js [build-payload.json] */
const path = require('path');
const P = require(process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'build-payload.json'));

const idx = new Map();
for (const v of P.variables) idx.set(v.collection + '::' + v.name, v);
const byName = new Map();
for (const v of P.variables) { if (byName.has(v.name)) byName.set(v.name, null); else byName.set(v.name, v); }

/* #rrggbb · #rrggbbaa → {r,g,b,a} 0..1 */
function hex(s) {
  const t = String(s).replace('#', '');
  const n = (i) => parseInt(t.substr(i, 2), 16) / 255;
  if (t.length === 6) return { r: n(0), g: n(2), b: n(4), a: 1 };
  if (t.length === 8) return { r: n(0), g: n(2), b: n(4), a: n(6) };
  return null;
}
/* 토큰 이름 하나를 최종 색까지 따라간다. 못 풀면 null. */
function resolve(name, seen) {
  seen = seen || [];
  if (seen.includes(name)) return null;
  const v = byName.get(name) || null;
  if (!v || v.type !== 'COLOR') return null;
  const e = v.values[Object.keys(v.values)[0]];
  if (e.kind === 'value') return hex(e.value);
  const t = idx.get(e.collection + '::' + e.name);
  return t ? resolve(t.name, seen.concat(name)) : null;
}
function over(top, bottom) {
  if (!top) return bottom;
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}
function lum(c) {
  const f = (u) => (u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/* ---- 변형 펼치기 (code.js 의 allCombos·effectiveProps 와 같은 규칙) ---- */
function mergeDelta(base, d) {
  const out = Object.assign({}, base);
  if (!d) return out;
  for (const k of Object.keys(d)) {
    if (k === 'slots') {
      out.slots = Object.assign({}, out.slots);
      for (const s of Object.keys(d.slots)) out.slots[s] = Object.assign({}, out.slots[s], d.slots[s]);
    } else out[k] = d[k];
  }
  return out;
}
const axesOf = (b) => b.order || Object.keys(b.axes || {});
function allCombos(b) {
  let rows = [{}];
  for (const ax of axesOf(b)) {
    const next = [];
    for (const r of rows) for (const val of b.axes[ax]) next.push(Object.assign({}, r, { [ax]: val }));
    rows = next;
  }
  return rows;
}
function effective(b, combo) {
  let p = mergeDelta({ slots: {} }, b.base);
  for (const ax of axesOf(b)) p = mergeDelta(p, b.per && b.per[ax] && b.per[ax][combo[ax]]);
  const key = axesOf(b).map((ax) => ax + '=' + combo[ax]).join(',');
  if (b.combos && b.combos[key]) p = mergeDelta(p, b.combos[key]);
  return p;
}

/* 슬롯 나무를 펴서 이름 → {kind, 부모 이름, 스펙의 기본 fill} 로 만든다.
   Mark 처럼 다른 슬롯 안에 든 아이콘은 컴포넌트 배경이 아니라 '자기 부모' 위에 놓인다. */
function flatten(slots, parent, out) {
  for (const s of slots || []) {
    out.set(s.name, { kind: s.kind, parent: parent, fill: s.fill });
    if (s.children) flatten(s.children, s.name, out);
  }
  return out;
}

const PAGE = resolve('bg/default') || { r: 1, g: 1, b: 1, a: 1 };   // 배경이 비면 페이지 색이 밑에 깔린다
const tok = (v) => (v && typeof v === 'object' && typeof v.t === 'string' ? v.t : null);

const found = new Map();   // "배경 + 전경" → {bg, fg, r, where[]}

for (const b of P.componentBuilds || []) {
  const tree = flatten(b.slots, null, new Map());
  for (const combo of allCombos(b)) {
    const p = effective(b, combo);
    const slotProps = (n) => Object.assign({}, tree.get(n) || {}, (p.slots || {})[n] || {});

    /* 슬롯 하나가 실제로 어떤 색 위에 놓이는지 — 부모를 타고 올라가며 첫 배경을 찾는다 */
    const backdrop = (name) => {
      let cur = tree.get(name) ? tree.get(name).parent : null, stack = [];
      while (cur) { stack.push(cur); cur = tree.get(cur) ? tree.get(cur).parent : null; }
      stack.push(null);                                     // 마지막은 컴포넌트 자신
      let color = PAGE, tokenName = null;
      for (const anc of stack.reverse()) {
        const t = anc === null ? tok(p.fill) : tok(slotProps(anc).fill);
        if (t) { const c = resolve(t); if (c) { color = over(c, color); tokenName = t; } }
      }
      return { color: color, token: tokenName };
    };

    for (const name of tree.keys()) {
      const sp = slotProps(name);
      if (sp.kind !== 'text' && sp.kind !== 'icon') continue;   // 도형 슬롯은 전경이 아니다
      if (sp.visible === false) continue;
      const fgTok = tok(sp.fill);
      if (!fgTok) continue;
      const raw = resolve(fgTok);
      if (!raw) continue;
      const bd = backdrop(name);
      const key = (bd.token || '(페이지 배경)') + '  +  ' + fgTok;
      const r = ratio(over(raw, bd.color), bd.color);
      const where = b.name + ' · ' + axesOf(b).map((k) => k + '=' + combo[k]).join(', ') + ' · ' + name;
      if (!found.has(key)) found.set(key, { r: r, where: [], comps: new Set(), disabled: /disabled/i.test(fgTok) || Object.values(combo).some((v) => /disabled/i.test(String(v))) });
      const rec = found.get(key);
      rec.where.push(where); rec.comps.add(b.name);
    }
  }
}

const bad = [], warn = [], soft = [];
for (const [key, rec] of found) {
  const line = key + ' = ' + rec.r.toFixed(2) + ':1\n      ' + Array.from(rec.comps).join(' · ')
    + ' (' + rec.where.length + '개 변형)';
  if (rec.disabled) soft.push(line);            // 비활성은 일부러 흐리게 만든 것이라 기준에서 뺀다
  else if (rec.r < 3) bad.push(line);
  else if (rec.r < 4.5) warn.push(line);
}

console.log('검사한 전경/배경 쌍 ' + found.size + '개');
if (bad.length) console.log('\n판독 불가 (3:1 미만) ' + bad.length + '건\n  · ' + bad.join('\n  · '));
if (warn.length) console.log('\n본문 글자에는 모자람 (3–4.5:1) ' + warn.length + '건\n  · ' + warn.join('\n  · '));
if (soft.length) console.log('\n비활성 — 기준에서 뺌 ' + soft.length + '건\n  · ' + soft.join('\n  · '));
console.log(bad.length ? '' : '\n판독 불가 조합 없음');
process.exitCode = bad.length ? 1 : 0;
