/* ───────── 페이로드를 '이미 있는 파일'에 붙일 때 무슨 일이 벌어지는지 본다 ─────────
 *
 * 왜 필요한가: _sim.js 는 페이로드로 가짜 파일을 만들어 놓고 그 위에 같은 페이로드를 붙인다.
 * 그래서 컬렉션 이름이 어긋나는 상황이 하네스에서 영원히 초록이다. 실제 파일
 * (zhi2caAgz9FgQWepZoqWSH) 은 7컬렉션(Primitive · Brand · Semantic/color · Semantic/typo ·
 * Semantic/dimension · Radius · Web)이고 페이로드는 5컬렉션(Scale · Brand · Semantic ·
 * Radius · Web)이다. 변수 이름은 하나도 안 어긋나는데 컬렉션 이름만 다르다.
 * 이대로 apply 를 돌리면 Scale 과 Semantic 컬렉션이 새로 생기고 268개가 그대로 복제된다.
 * 이름이 두 컬렉션에 겹치는 순간 이름 예비 경로도 죽어서, 다음 번엔 아무것도 못 찾는다.
 *
 * 그래서 '가짜 파일의 모양'을 페이로드가 아니라 **바깥 fixture** 에서 받는다.
 *
 * 사용:
 *   node figma/check-reconcile.js                                  (기본 fixture = figma/fixtures/file-7col.json)
 *   node figma/check-reconcile.js --shape figma/fixtures/file-7col.json
 *   node figma/check-reconcile.js --shape empty                    (빈 파일 — 처음 붙이는 경우)
 *   node figma/check-reconcile.js --payload figma/build-payload.json
 *
 * 여기서 보는 것은 변수 화해(collection·mode·variable)뿐이다. 스타일·컴포넌트·화면은
 * _sim.js 가 본다.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const PAYLOAD = JSON.parse(fs.readFileSync(path.resolve(ROOT, argOf('--payload', 'figma/build-payload.json')), 'utf8'));
const SHAPEARG = argOf('--shape', 'figma/fixtures/file-7col.json');
const SHAPE = SHAPEARG === 'empty' ? { collections: [] }
  : JSON.parse(fs.readFileSync(path.resolve(ROOT, SHAPEARG), 'utf8'));
const CODE = fs.readFileSync(path.join(ROOT, 'figma-plugin', 'code.js'), 'utf8');

/* ───────────────── 변수 API 흉내 ─────────────────
   실제 Figma 가 거절하는 것을 여기서도 거절해야 한다. 특히:
   · 없는 모드에 setValueForMode → 던진다
   · 같은 컬렉션에 같은 이름 두 번 → 던진다 (Figma 도 거절한다)
   이 두 개가 없으면 결함이 조용히 통과한다. */
function makeFile(shape) {
  let seq = 0;
  const cols = [], vars = [];
  const mkCol = (name, modeNames, defaultMode) => {
    const c = {
      id: 'col:' + (++seq),
      name,
      modes: modeNames.map((m, i) => ({ modeId: 'mode:' + seq + ':' + i, name: m })),
      addMode(n) {
        if (this.modes.some((m) => m.name === n)) throw new Error('이미 있는 모드: ' + n);
        const m = { modeId: 'mode:' + this.id + ':' + this.modes.length, name: n };
        this.modes.push(m);
        return m.modeId;
      },
      renameMode(id, n) {
        const m = this.modes.find((x) => x.modeId === id);
        if (!m) throw new Error('없는 모드 id');
        m.name = n;
      }
    };
    c.defaultModeId = (c.modes.find((m) => m.name === defaultMode) || c.modes[0]).modeId;
    cols.push(c);
    return c;
  };
  const mkVar = (name, col, type) => {
    if (vars.some((v) => v.variableCollectionId === col.id && v.name === name))
      throw new Error('같은 컬렉션에 같은 이름의 변수가 이미 있습니다: ' + col.name + '/' + name);
    const v = {
      id: 'var:' + (++seq), name, resolvedType: type,
      variableCollectionId: col.id, valuesByMode: {}, scopes: ['ALL_SCOPES'],
      setValueForMode(modeId, value) {
        const c = cols.find((x) => x.id === this.variableCollectionId);
        if (!c || !c.modes.some((m) => m.modeId === modeId))
          throw new Error('이 변수의 컬렉션에 없는 모드입니다');
        this.valuesByMode[modeId] = value;
      },
      setVariableCodeSyntax() {}
    };
    vars.push(v);
    return v;
  };

  for (const sc of (shape.collections || [])) {
    const c = mkCol(sc.name, sc.modes, sc.defaultMode);
    for (const s of sc.variables) {
      const i = s.lastIndexOf('|');
      mkVar(s.slice(0, i), c, s.slice(i + 1));
    }
  }

  const page = { type: 'PAGE', name: 'Page 1', children: [], id: 'page:1' };
  const figma = {
    root: { children: [page] },
    currentPage: page,
    async setCurrentPageAsync(p) { figma.currentPage = p; },
    editorType: 'figma',
    ui: { postMessage() {}, set onmessage(_) {} },
    showUI() {}, closePlugin() {},
    async getLocalTextStylesAsync() { return []; },
    async getLocalEffectStylesAsync() { return []; },
    async getLocalPaintStylesAsync() { return []; },
    async loadFontAsync() {},
    variables: {
      async getLocalVariableCollectionsAsync() { return cols.slice(); },
      async getLocalVariablesAsync() { return vars.slice(); },
      createVariableCollection(name) { return mkCol(name, ['Mode 1'], 'Mode 1'); },
      createVariable(name, col, type) { return mkVar(name, col, type); },
      createVariableAlias(v) { return { type: 'VARIABLE_ALIAS', id: v.id }; },
      setBoundVariableForPaint(p) { return p; },
      setBoundVariableForEffect(e) { return e; }
    }
  };
  return { figma, cols, vars };
}

function loadPlugin(figma) {
  const ctx = vm.createContext({
    figma, __html__: '', console, Math, JSON, Object, Array, Set, Map,
    String, Number, isFinite, parseFloat, parseInt, Promise, Error
  });
  vm.runInContext(CODE
    + '\n;globalThis.__dryRun = dryRun; globalThis.__apply = apply;'
    /* 스타일·컴포넌트·화면 단계는 이 하네스의 대상이 아니다 — _sim.js 가 본다.
       dryRun 이 부르는 세 함수만 조용한 것으로 바꿔 끼운다. */
    + '\n;dryRunStyles = async () => ({ text: [], effect: [], paint: [] });'
    + '\n;dryRunComponents = async () => ({ create: [], totalVariants: 0, missingTokens: [], missingStyles: [], elsewhere: [] });'
    + '\n;dryRunScreens = async () => ({ frames: [], instances: 0, missing: [] });',
    ctx, { filename: 'code.js' });
  return ctx;
}

/* ───────────────── 검사 ───────────────── */
const fail = [];
const F = (m) => fail.push(m);

/* 파일에 이미 있는 이름(어느 컬렉션이든) */
const shapeNames = new Set();
for (const c of (SHAPE.collections || [])) for (const s of c.variables) shapeNames.add(s.slice(0, s.lastIndexOf('|')));
const shapeColNames = new Set((SHAPE.collections || []).map((c) => c.name));
const isEmpty = shapeColNames.size === 0;

/* 페이로드 변수 중 파일에 이름조차 없는 것 — 이만큼만 새로 생겨야 한다 */
const expectNew = (PAYLOAD.variables || []).filter((v) => !shapeNames.has(v.name)).map((v) => v.name);

(async () => {
  /* ── 1) dry-run ── */
  const A = makeFile(SHAPE);
  const ctxA = loadPlugin(A.figma);
  let plan;
  try { plan = await ctxA.__dryRun(PAYLOAD); }
  catch (e) { console.error('dry-run 이 던졌습니다 — ' + e.message + '\n' + e.stack); process.exit(2); }

  const created = (plan.collections.create || []).map((c) => c.name);
  if (!isEmpty && created.length)
    F('dry-run 이 컬렉션을 새로 만들겠다고 합니다 — ' + created.join(', ')
      + '. 이 파일에는 같은 변수들이 이미 다른 이름의 컬렉션에 살아 있습니다. 새로 만들면 이름이 겹치고 기존 바인딩은 그대로 옛 변수를 가리킵니다.');
  if (isEmpty && created.length !== (PAYLOAD.collections || []).length)
    F('빈 파일인데 컬렉션 생성 계획이 ' + created.length + '개뿐입니다 (페이로드 ' + (PAYLOAD.collections || []).length + '개).');

  const planNew = (plan.variables.create || []).map((v) => v.name).sort();
  const want = expectNew.slice().sort();
  if (planNew.join(' ') !== want.join(' ')) {
    const extra = planNew.filter((n) => want.indexOf(n) < 0);
    const miss = want.filter((n) => planNew.indexOf(n) < 0);
    F('dry-run 의 "새로 만들 변수" 가 다릅니다 — 계획 ' + planNew.length + '개 · 기대 ' + want.length + '개'
      + (extra.length ? '\n      군더더기 ' + extra.length + '개 (파일에 이미 있는데 또 만들려는 것): ' + extra.slice(0, 8).join(', ') + (extra.length > 8 ? ' …' : '') : '')
      + (miss.length ? '\n      빠진 것 ' + miss.length + '개: ' + miss.slice(0, 8).join(', ') + (miss.length > 8 ? ' …' : '') : ''));
  }

  /* 고아: 페이로드에 대응이 없는 파일 변수. 이 파일에서는 Semantic/typo 81개뿐이어야 한다. */
  const orphanExpect = [];
  const payloadNames = new Set((PAYLOAD.variables || []).map((v) => v.name));
  for (const c of (SHAPE.collections || [])) for (const s of c.variables) {
    const n = s.slice(0, s.lastIndexOf('|'));
    if (!payloadNames.has(n)) orphanExpect.push(c.name + '/' + n);
  }
  const orphanGot = (plan.orphans || []).map((o) => o.collection + '/' + o.name).sort();
  if (orphanGot.join(' ') !== orphanExpect.sort().join(' ')) {
    const extra = orphanGot.filter((n) => orphanExpect.indexOf(n) < 0);
    F('고아 보고가 다릅니다 — 보고 ' + orphanGot.length + '개 · 기대 ' + orphanExpect.length + '개'
      + (extra.length ? '\n      멀쩡한 변수를 고아라고 부릅니다 (' + extra.length + '개): ' + extra.slice(0, 8).join(', ') + (extra.length > 8 ? ' …' : '') : ''));
  }

  /* ── 2) apply ── */
  const B = makeFile(SHAPE);
  const ctxB = loadPlugin(B.figma);
  let res;
  try { res = await ctxB.__apply(PAYLOAD, { styles: false, components: false, screens: false }); }
  catch (e) { console.error('apply 가 던졌습니다 — ' + e.message + '\n' + e.stack); process.exit(2); }

  if (res.problems.length)
    F('apply 가 문제를 ' + res.problems.length + '건 남겼습니다:\n      ' + res.problems.slice(0, 10).join('\n      ')
      + (res.problems.length > 10 ? '\n      … 외 ' + (res.problems.length - 10) + '건' : ''));

  /* 같은 이름이 두 컬렉션에 있으면 이름 예비 경로가 죽는다 — 다음 실행에서 전부 못 찾는다. */
  const nameCols = new Map();
  for (const v of B.vars) {
    const cn = (B.cols.find((c) => c.id === v.variableCollectionId) || {}).name;
    if (!nameCols.has(v.name)) nameCols.set(v.name, new Set());
    nameCols.get(v.name).add(cn);
  }
  const dup = [...nameCols.entries()].filter(([, s]) => s.size > 1);
  if (dup.length)
    F('같은 변수 이름이 두 곳 이상에 생겼습니다 (' + dup.length + '개) — 이름만으로 찾는 예비 경로가 이 순간 죽습니다:\n      '
      + dup.slice(0, 6).map(([n, s]) => n + ' → ' + [...s].join(' + ')).join('\n      '));

  if (!isEmpty) {
    const newCols = B.cols.map((c) => c.name).filter((n) => !shapeColNames.has(n));
    if (newCols.length) F('apply 가 컬렉션을 새로 만들었습니다 — ' + newCols.join(', '));
  }

  /* 페이로드의 모든 변수가 정확히 하나씩 살아 있어야 한다 */
  const notFound = [];
  for (const pv of (PAYLOAD.variables || [])) if (!nameCols.has(pv.name)) notFound.push(pv.name);
  if (notFound.length) F('apply 후에도 없는 페이로드 변수 ' + notFound.length + '개: ' + notFound.slice(0, 8).join(', '));

  /* 값이 실제로 들어갔는가 — 모드 하나도 못 채운 변수는 파일에서 빈칸으로 보인다 */
  const emptyVals = (PAYLOAD.variables || [])
    .filter((pv) => { const v = B.vars.find((x) => x.name === pv.name); return v && Object.keys(v.valuesByMode).length === 0; })
    .map((pv) => pv.name);
  if (emptyVals.length) F('값이 한 모드도 안 들어간 변수 ' + emptyVals.length + '개: ' + emptyVals.slice(0, 8).join(', '));

  /* 모드: 색이 사는 컬렉션에는 Dark 가 생겨야 하고, 수치가 사는 컬렉션에는 생기면 안 된다.
     수치는 라이트/다크가 같은 값이다 — 모드축을 붙이면 파일에 뜻 없는 축이 하나 늘어난다. */
  const semColor = B.cols.find((c) => c.name === 'Semantic/color') || B.cols.find((c) => c.name === 'Semantic');
  const semDim = B.cols.find((c) => c.name === 'Semantic/dimension');
  if (semColor && !semColor.modes.some((m) => m.name === 'Dark'))
    F(semColor.name + ' 에 Dark 모드가 없습니다 — 다크 값이 갈 곳이 없습니다.');
  if (semDim) {
    const before = (SHAPE.collections.find((c) => c.name === 'Semantic/dimension') || {}).modes || [];
    if (semDim.modes.length !== before.length)
      F('Semantic/dimension 의 모드가 ' + before.join(',') + ' → ' + semDim.modes.map((m) => m.name).join(',')
        + ' 로 늘었습니다. 수치는 모드에 따라 달라지지 않습니다 — 뜻 없는 축입니다.');
  }

  /* ── 보고 ── */
  console.log('파일 모양: ' + (isEmpty ? '(빈 파일)' : SHAPEARG));
  console.log('  컬렉션 ' + (SHAPE.collections || []).length + ' → ' + B.cols.length
    + ' · 변수 ' + shapeNames.size + ' → ' + B.vars.length
    + ' · 새로 만든 변수 ' + res.summary.created + ' (기대 ' + expectNew.length + ')'
    + ' · 값 주입 ' + res.summary.valuesSet + '건');
  if (plan.collections.mapping && plan.collections.mapping.length) {
    console.log('  컬렉션 대응:');
    for (const m of plan.collections.mapping) console.log('    ' + m);
  }
  console.log('  고아 ' + (plan.orphans || []).length + '개' + ((plan.orphans || []).length ? ' (' + [...new Set((plan.orphans || []).map((o) => o.collection))].join(', ') + ')' : ''));

  if (fail.length) {
    console.log('\n문제 ' + fail.length + '건');
    fail.forEach((f) => console.log('  · ' + f));
    process.exitCode = 1;
  } else {
    console.log('\n화해 이상 없음');
  }
})();
