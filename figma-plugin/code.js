/* Freesm 토큰 빌더 — Figma 플러그인 (본체)
 *
 * figma/build-payload.json 을 받아 이 파일의 변수·스타일을 페이로드에 맞춘다.
 *
 * 원칙 (payload.$meta.policy 와 같다)
 *   · 삭제 없음        — 페이로드에 없는 것은 '고아'로 보고만 한다.
 *   · 개명은 제자리    — variable.name 을 고쳐 기존 바인딩을 살린다.
 *   · dry-run 필수     — 적용 전에 신규·개명·값변경을 사람이 확인한다.
 *   · 컴포넌트는 격리   — payload.componentBuilds 를 읽어 만들되, 전용 페이지
 *                        '[Freesm] Components' 안에서만 만들고 고친다.
 *                        같은 이름이 그 페이지에 있으면 '— 이전' 으로 개명해 남긴다.
 *
 * 실행 순서: 컬렉션/모드 → 개명 → 분할 → 변수 생성 → 값 주입 → 스타일 → 컴포넌트
 */

figma.showUI(__html__, { width: 560, height: 720, themeColors: true });

/* ───────────────────────── 유틸 ───────────────────────── */

const KEY = (col, name) => col + '\u0000' + name;

function hexToRgba(hex) {
  const h = String(hex).trim().replace(/^#/, '');
  const p = (i) => parseInt(h.substr(i, 2), 16) / 255;
  if (h.length === 3) {
    const d = (i) => parseInt(h[i] + h[i], 16) / 255;
    return { r: d(0), g: d(1), b: d(2), a: 1 };
  }
  if (h.length === 6) return { r: p(0), g: p(2), b: p(4), a: 1 };
  if (h.length === 8) return { r: p(0), g: p(2), b: p(4), a: p(6) };
  throw new Error('색 형식을 알 수 없습니다: ' + hex);
}

function rgbaToHex(c) {
  const q = (n) => ('0' + Math.round(n * 255).toString(16)).slice(-2);
  const a = c.a === undefined ? 1 : c.a;
  return '#' + q(c.r) + q(c.g) + q(c.b) + (a >= 0.999 ? '' : q(a));
}

function sameColor(a, b) {
  if (!a || !b) return false;
  const e = 1 / 400; // 8비트 반올림 오차 허용
  const aa = a.a === undefined ? 1 : a.a;
  const ba = b.a === undefined ? 1 : b.a;
  return Math.abs(a.r - b.r) < e && Math.abs(a.g - b.g) < e &&
         Math.abs(a.b - b.b) < e && Math.abs(aa - ba) < e;
}

/** 페이로드 값 → Figma 값 */
function toFigmaValue(type, raw) {
  if (type === 'COLOR') return hexToRgba(raw);
  if (type === 'FLOAT') return typeof raw === 'number' ? raw : parseFloat(raw);
  return String(raw);
}

/** 사람이 읽는 표기 */
function show(type, v) {
  if (v === undefined || v === null) return '—';
  if (v && v.type === 'VARIABLE_ALIAS') return '→ ' + (v.__label || v.id);
  if (type === 'COLOR' && typeof v === 'object') return rgbaToHex(v);
  return String(v);
}

/* ───────────────────────── 현재 파일 상태 읽기 ───────────────────────── */

async function readState() {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const vars = await figma.variables.getLocalVariablesAsync();

  const colByName = new Map();       // 컬렉션 이름 → collection
  for (const c of cols) colByName.set(c.name, c);

  const colById = new Map();
  for (const c of cols) colById.set(c.id, c);

  const varById = new Map();
  for (const v of vars) varById.set(v.id, v);

  const varByKey = new Map();        // "컬렉션\0변수이름" → variable
  for (const v of vars) {
    const c = colById.get(v.variableCollectionId);
    if (c) varByKey.set(KEY(c.name, v.name), v);
  }

  return { cols, vars, colByName, colById, varById, varByKey };
}

/** modeId ← 모드 이름 */
function modeIdOf(collection, modeName) {
  const m = collection.modes.find((x) => x.name === modeName);
  return m ? m.modeId : null;
}

/** 별칭을 "컬렉션/이름"으로 풀어 쓴다 */
function aliasLabel(st, id) {
  const v = st.varById.get(id);
  if (!v) return '(이 파일에 없는 변수 ' + id + ')';
  const c = st.colById.get(v.variableCollectionId);
  return (c ? c.name + '/' : '') + v.name;
}

/* ───────────────────────── 이관표 해석 ───────────────────────── */
/* 실제 개명을 하기 전에, "이 옛 이름은 이 새 이름이 될 것"이라는 가상 지도를 만든다.
   dry-run 과 apply 가 같은 지도를 쓰므로 두 결과가 어긋나지 않는다. */

function planMigrations(payload, st) {
  const mig = payload.migrations || {};
  const renames = [];   // 실제 수행할 개명
  const splits = [];
  const conflicts = [];
  const notes = [];
  const virtual = new Map(); // KEY(col, 새이름) → 개명으로 확보될 예정

  const has = (col, name) =>
    st.varByKey.has(KEY(col, name)) || virtual.has(KEY(col, name));

  /* 이관표가 잘못돼 있어도 살아 있는 변수를 망가뜨리지 않는다.
     생성기에도 같은 검사가 있지만, 플러그인은 남이 만든 페이로드도 받으므로 여기서 한 번 더 막는다. */
  const canonical = new Set((payload.variables || []).map((v) => KEY(v.collection, v.name)));
  const unsafe = (col, from, to) => {
    if (!to || String(to).split('/').pop() === 'undefined' || !String(to).trim())
      return '새 이름이 비어 있습니다 — 이관표가 잘못됐습니다. 이 항목은 건너뜁니다.';
    if (canonical.has(KEY(col, from)))
      return '옛 이름이 페이로드에도 정규 이름으로 있습니다 — 개명하면 현행 변수가 사라집니다. 건너뜁니다.';
    return null;
  };

  for (const r of (mig.variableRenames || [])) {
    const danger = unsafe(r.collection, r.from, r.to);
    if (danger) { renames.push({ ...r, status: 'unsafe', why: danger }); continue; }
    const src = st.varByKey.get(KEY(r.collection, r.from));
    if (!src) {
      renames.push({ ...r, status: 'source-missing', why: '옛 이름이 파일에 없습니다 — 이미 개명됐거나 신규입니다.' });
      continue;
    }
    if (has(r.collection, r.to)) {
      renames.push({ ...r, status: 'target-exists', why: '새 이름이 이미 있습니다 — 기존 것을 살리고 개명은 건너뜁니다.' });
      continue;
    }
    renames.push({ ...r, status: 'rename', id: src.id });
    virtual.set(KEY(r.collection, r.to), src.id);
  }

  for (const s of (mig.variableSplits || [])) {
    const keepName = (s.into || [])[0];
    const newName = (s.into || [])[1];
    const danger = unsafe(s.collection, s.from, keepName) ||
      (!newName ? '분할 결과 이름이 하나뿐입니다 — 이관표가 잘못됐습니다. 건너뜁니다.' : null);
    if (danger) { splits.push({ ...s, status: 'unsafe', why: danger }); continue; }
    const src = st.varByKey.get(KEY(s.collection, s.from));
    if (!src) {
      splits.push({ ...s, status: 'source-missing', why: '옛 이름이 파일에 없습니다 — 두 이름 모두 신규 생성으로 처리합니다.' });
      continue;
    }
    if (has(s.collection, keepName)) {
      splits.push({ ...s, status: 'target-exists', why: keepName + ' 이(가) 이미 있습니다 — 개명 없이 ' + newName + ' 만 확인합니다.' });
      continue;
    }
    splits.push({ ...s, status: 'split', id: src.id, keepName, newName });
    virtual.set(KEY(s.collection, keepName), src.id);
  }

  for (const c of (mig.conflicts || [])) {
    const dup = st.varByKey.get(KEY(c.collection, c.duplicate));
    conflicts.push({
      ...c,
      present: !!dup,
      why: dup
        ? '중복 이름이 파일에 있습니다 — 삭제하지 않고 고아로 보고합니다. 참조가 남아 있는지 직접 확인해 주세요.'
        : '중복 이름이 없습니다 — 조치할 것이 없습니다.'
    });
  }

  if ((mig.crossCollection || []).length) {
    notes.push('컬렉션 이동 ' + mig.crossCollection.length + '건은 Figma API 로 옮길 수 없습니다. 아래 목록을 보고 손으로 처리해 주세요.');
  }

  return { renames, splits, conflicts, crossCollection: mig.crossCollection || [], notes };
}

/** 개명·분할이 끝났다고 가정한 이름 조회 */
function makeLookup(st, mg) {
  const extra = new Map();
  for (const r of mg.renames) if (r.status === 'rename') extra.set(KEY(r.collection, r.to), r.id);
  for (const s of mg.splits) if (s.status === 'split') extra.set(KEY(s.collection, s.keepName), s.id);

  const moved = new Set();
  for (const r of mg.renames) if (r.status === 'rename') moved.add(KEY(r.collection, r.from));
  for (const s of mg.splits) if (s.status === 'split') moved.add(KEY(s.collection, s.from));

  return (col, name) => {
    const k = KEY(col, name);
    if (extra.has(k)) return st.varById.get(extra.get(k));
    if (moved.has(k)) return null; // 이 이름은 곧 사라진다
    return st.varByKey.get(k) || null;
  };
}

/* ───────────────────────── dry-run ───────────────────────── */

async function dryRun(payload) {
  const st = await readState();
  const mg = planMigrations(payload, st);
  const lookup = makeLookup(st, mg);

  /* 1) 컬렉션·모드 */
  const collections = { create: [], addModes: [], defaultModeManual: [], ok: [] };
  for (const c of (payload.collections || [])) {
    const live = st.colByName.get(c.name);
    if (!live) {
      collections.create.push({ name: c.name, modes: c.modes, note: c.note });
      if (c.modes[0] !== c.defaultMode) {
        collections.defaultModeManual.push({ collection: c.name, want: c.defaultMode });
      }
      continue;
    }
    const missing = c.modes.filter((m) => !modeIdOf(live, m));
    if (missing.length) collections.addModes.push({ collection: c.name, modes: missing });
    else collections.ok.push(c.name);
    const dm = live.modes.find((m) => m.modeId === live.defaultModeId);
    if (dm && dm.name !== c.defaultMode) {
      collections.defaultModeManual.push({ collection: c.name, now: dm.name, want: c.defaultMode });
    }
  }

  /* 2) 변수 */
  const variables = { create: [], update: [], typeMismatch: [], missingAliasTarget: [], same: 0 };
  const payloadKeys = new Set();

  for (const pv of (payload.variables || [])) {
    payloadKeys.add(KEY(pv.collection, pv.name));
    const live = lookup(pv.collection, pv.name);

    if (!live) {
      variables.create.push({ collection: pv.collection, name: pv.name, type: pv.type });
      // 별칭 대상이 파일에도 페이로드에도 없으면 미리 잡아 둔다
      for (const mv of Object.values(pv.values)) {
        if (mv.kind === 'alias' && !lookup(mv.collection, mv.name) &&
            !(payload.variables || []).some((x) => x.collection === mv.collection && x.name === mv.name)) {
          variables.missingAliasTarget.push({ from: pv.collection + '/' + pv.name, to: mv.collection + '/' + mv.name });
        }
      }
      continue;
    }

    if (live.resolvedType !== pv.type) {
      variables.typeMismatch.push({
        collection: pv.collection, name: pv.name, now: live.resolvedType, want: pv.type,
        why: 'Figma 는 변수 타입을 바꿀 수 없습니다 — 이 변수는 건너뜁니다.'
      });
      continue;
    }

    const col = st.colById.get(live.variableCollectionId);
    for (const [modeName, mv] of Object.entries(pv.values)) {
      const modeId = col ? modeIdOf(col, modeName) : null;
      const cur = modeId ? live.valuesByMode[modeId] : undefined;

      if (mv.kind === 'alias') {
        const target = lookup(mv.collection, mv.name);
        const want = mv.collection + '/' + mv.name;
        const nowLabel = cur && cur.type === 'VARIABLE_ALIAS' ? aliasLabel(st, cur.id) : show(pv.type, cur);
        if (cur && cur.type === 'VARIABLE_ALIAS' && target && cur.id === target.id) { variables.same++; continue; }
        variables.update.push({
          collection: pv.collection, name: pv.name, mode: modeName,
          from: nowLabel, to: '→ ' + want,
          newMode: !modeId || undefined
        });
      } else {
        const want = toFigmaValue(pv.type, mv.value);
        let equal = false;
        if (cur !== undefined && !(cur && cur.type === 'VARIABLE_ALIAS')) {
          equal = pv.type === 'COLOR' ? sameColor(cur, want) : cur === want;
        }
        if (equal) { variables.same++; continue; }
        variables.update.push({
          collection: pv.collection, name: pv.name, mode: modeName,
          from: cur && cur.type === 'VARIABLE_ALIAS' ? aliasLabel(st, cur.id) : show(pv.type, cur),
          to: show(pv.type, want),
          newMode: !modeId || undefined
        });
      }
    }
  }

  /* 3) 고아 — 페이로드에 없는 파일 변수 (삭제하지 않는다) */
  const consumed = new Set();
  for (const r of mg.renames) if (r.status === 'rename') consumed.add(KEY(r.collection, r.from));
  for (const s of mg.splits) if (s.status === 'split') consumed.add(KEY(s.collection, s.from));

  const orphans = [];
  for (const [k, v] of st.varByKey) {
    if (payloadKeys.has(k) || consumed.has(k)) continue;
    const nk = mg.renames.find((r) => r.status === 'rename' && KEY(r.collection, r.to) === k);
    if (nk) continue;
    const col = st.colById.get(v.variableCollectionId);
    orphans.push({ collection: col ? col.name : '?', name: v.name, type: v.resolvedType });
  }
  // 개명 후 이름이 페이로드에 있는 것은 고아가 아니다
  const orphanFiltered = orphans.filter((o) => !payloadKeys.has(KEY(o.collection, o.name)));

  /* 4) 스타일 */
  const styles = await dryRunStyles(payload);

  /* 5) 컴포넌트 */
  const componentPlan = await dryRunComponents(payload);

  return {
    meta: payload.$meta || {},
    migrations: mg,
    collections,
    variables,
    orphans: orphanFiltered,
    styles,
    components: (payload.components || []).map((c) => ({
      name: c.name, status: c.status, variantCount: c.variantCount
    })),
    componentPlan,
    counts: {
      create: variables.create.length,
      update: variables.update.length,
      same: variables.same,
      renames: mg.renames.filter((r) => r.status === 'rename').length,
      splits: mg.splits.filter((s) => s.status === 'split').length,
      unsafe: mg.renames.filter((r) => r.status === 'unsafe').length
            + mg.splits.filter((s) => s.status === 'unsafe').length,
      orphans: orphanFiltered.length,
      componentSets: componentPlan.create.length,
      componentVariants: componentPlan.totalVariants
    }
  };
}

async function dryRunStyles(payload) {
  const S = payload.styles || {};
  const out = {
    text: { rename: [], create: [], update: [], same: 0 },
    effect: { rename: [], create: [], update: [], same: 0 },
    fontsToLoad: S.fontsToLoad || []
  };
  const ren = (payload.migrations && payload.migrations.styleRenames) || {};

  const texts = await figma.getLocalTextStylesAsync();
  const effects = await figma.getLocalEffectStylesAsync();
  const tByName = new Map(texts.map((s) => [s.name, s]));
  const eByName = new Map(effects.map((s) => [s.name, s]));

  for (const r of (ren.text || [])) {
    if (tByName.has(r.from) && !tByName.has(r.to)) out.text.rename.push(r);
  }
  for (const r of (ren.effect || [])) {
    if (eByName.has(r.from) && !eByName.has(r.to)) out.effect.rename.push(r);
  }
  const willBeText = new Set(out.text.rename.map((r) => r.to));
  const willBeEffect = new Set(out.effect.rename.map((r) => r.to));

  for (const t of (S.text || [])) {
    const live = tByName.get(t.name);
    if (!live && !willBeText.has(t.name)) { out.text.create.push(t.name); continue; }
    const cur = live || tByName.get((ren.text || []).find((r) => r.to === t.name).from);
    const diff = [];
    if (cur.fontName.family !== t.fontFamily || cur.fontName.style !== t.fontStyle) {
      diff.push(cur.fontName.family + ' ' + cur.fontName.style + ' → ' + t.fontFamily + ' ' + t.fontStyle);
    }
    if (cur.fontSize !== t.fontSize) diff.push('크기 ' + cur.fontSize + ' → ' + t.fontSize);
    if (cur.lineHeight.unit !== t.lineHeight.unit || cur.lineHeight.value !== t.lineHeight.value) {
      diff.push('행간 ' + cur.lineHeight.value + cur.lineHeight.unit + ' → ' + t.lineHeight.value + t.lineHeight.unit);
    }
    if (cur.letterSpacing.unit !== t.letterSpacing.unit || cur.letterSpacing.value !== t.letterSpacing.value) {
      diff.push('자간 ' + cur.letterSpacing.value + cur.letterSpacing.unit + ' → ' + t.letterSpacing.value + t.letterSpacing.unit);
    }
    if (diff.length) out.text.update.push({ name: t.name, diff });
    else out.text.same++;
  }

  for (const e of (S.effect || [])) {
    const live = eByName.get(e.name);
    if (!live && !willBeEffect.has(e.name)) { out.effect.create.push(e.name); continue; }
    const cur = live || eByName.get((ren.effect || []).find((r) => r.to === e.name).from);
    if (JSON.stringify(cur.effects) === JSON.stringify(e.effects)) out.effect.same++;
    else out.effect.update.push({ name: e.name, source: e.source });
  }

  return out;
}

/* ───────────────────────── 적용 ───────────────────────── */

async function apply(payload, opts) {
  const doStyles = !opts || opts.styles !== false;
  const doComponents = !opts || opts.components !== false;
  const log = [];
  const problems = [];
  const push = (t, m) => { log.push({ t, m }); figma.ui.postMessage({ type: 'progress', line: { t, m } }); };

  /* 1) 컬렉션·모드 */
  let st = await readState();
  for (const c of (payload.collections || [])) {
    let live = st.colByName.get(c.name);
    if (!live) {
      live = figma.variables.createVariableCollection(c.name);
      live.renameMode(live.modes[0].modeId, c.modes[0]);
      for (let i = 1; i < c.modes.length; i++) live.addMode(c.modes[i]);
      push('ok', '컬렉션 신규 — ' + c.name + ' (모드 ' + c.modes.join(', ') + ')');
    } else {
      for (const m of c.modes) {
        if (!modeIdOf(live, m)) { live.addMode(m); push('ok', '모드 추가 — ' + c.name + ' / ' + m); }
      }
    }
  }

  /* 2) 개명 · 3) 분할 */
  st = await readState();
  const mg = planMigrations(payload, st);
  for (const r of mg.renames) {
    if (r.status === 'unsafe') {
      push('err', '개명 거부 — ' + r.collection + '/' + r.from + ' → ' + r.to + ' · ' + r.why);
      problems.push('이관표 개명이 위험합니다 — ' + r.collection + '/' + r.from + ' → ' + r.to + ' · ' + r.why);
      continue;
    }
    if (r.status !== 'rename') { push('skip', '개명 건너뜀 — ' + r.from + ' → ' + r.to + ' · ' + r.why); continue; }
    const v = st.varById.get(r.id);
    v.name = r.to;
    push('ok', '개명 — ' + r.collection + '/' + r.from + ' → ' + r.to);
  }
  for (const s of mg.splits) {
    if (s.status === 'unsafe') {
      push('err', '분할 거부 — ' + s.collection + '/' + s.from + ' · ' + s.why);
      problems.push('이관표 분할이 위험합니다 — ' + s.collection + '/' + s.from + ' · ' + s.why);
      continue;
    }
    if (s.status !== 'split') { push('skip', '분할 건너뜀 — ' + s.from + ' · ' + s.why); continue; }
    const v = st.varById.get(s.id);
    v.name = s.keepName;
    push('ok', '분할 — ' + s.collection + '/' + s.from + ' → ' + s.keepName + ' (유지) + ' + s.newName + ' (신설)');
  }
  for (const c of mg.conflicts) {
    if (c.present) push('warn', '이름충돌 — ' + c.collection + '/' + c.duplicate + ' 는 삭제하지 않고 남겨 둡니다. ' + c.note);
  }
  for (const x of mg.crossCollection) {
    push('manual', '컬렉션 이동(수동) — ' + x.from + ' → ' + x.now);
  }

  /* 4) 변수 생성 — 값은 아직 넣지 않는다 (별칭 대상이 다 생겨야 하므로) */
  st = await readState();
  const lookup0 = makeLookup(st, { renames: [], splits: [] });
  let created = 0;
  for (const pv of (payload.variables || [])) {
    if (lookup0(pv.collection, pv.name)) continue;
    const col = st.colByName.get(pv.collection);
    if (!col) { push('err', '컬렉션 없음 — ' + pv.collection + ' · ' + pv.name + ' 건너뜀'); continue; }
    figma.variables.createVariable(pv.name, col, pv.type);
    created++;
  }
  if (created) push('ok', '변수 신규 생성 ' + created + '개');

  /* 5) 값 · 스코프 · 코드신택스 주입 */
  st = await readState();
  const lookup = makeLookup(st, { renames: [], splits: [] });
  let setCount = 0, skipCount = 0;

  for (const pv of (payload.variables || [])) {
    const v = lookup(pv.collection, pv.name);
    if (!v) { problems.push(pv.collection + '/' + pv.name + ' — 생성되지 않았습니다'); continue; }
    if (v.resolvedType !== pv.type) {
      problems.push(pv.collection + '/' + pv.name + ' — 타입 불일치(' + v.resolvedType + '≠' + pv.type + '), 건너뜀');
      skipCount++;
      continue;
    }
    const col = st.colById.get(v.variableCollectionId);

    for (const [modeName, mv] of Object.entries(pv.values)) {
      const modeId = modeIdOf(col, modeName);
      if (!modeId) { problems.push(pv.collection + '/' + pv.name + ' — 모드 ' + modeName + ' 없음'); continue; }
      try {
        if (mv.kind === 'alias') {
          const target = lookup(mv.collection, mv.name);
          if (!target) { problems.push(pv.name + ' → ' + mv.collection + '/' + mv.name + ' 대상 변수 없음'); continue; }
          v.setValueForMode(modeId, figma.variables.createVariableAlias(target));
        } else {
          v.setValueForMode(modeId, toFigmaValue(pv.type, mv.value));
        }
        setCount++;
      } catch (e) {
        problems.push(pv.collection + '/' + pv.name + ' [' + modeName + '] — ' + e.message);
      }
    }

    try {
      v.scopes = (pv.scopes && pv.scopes.length) ? pv.scopes : ['ALL_SCOPES'];
    } catch (e) { problems.push(pv.name + ' 스코프 — ' + e.message); }

    if (pv.codeSyntax && pv.codeSyntax.WEB) {
      try { v.setVariableCodeSyntax('WEB', pv.codeSyntax.WEB); } catch (e) { /* 무시 */ }
    }
  }
  push('ok', '값 주입 ' + setCount + '건' + (skipCount ? ' · 건너뜀 ' + skipCount + '건' : ''));

  /* 6) 스타일 */
  let styleReport = { text: 0, effect: 0, renamed: 0 };
  if (doStyles) styleReport = await applyStyles(payload, push, problems);
  else push('skip', '스타일 단계는 껐습니다.');

  /* 7) 컴포넌트 — 스타일 다음이어야 한다. 텍스트·이펙트 스타일을 이름으로 찾아 건다. */
  let componentReport = { sets: 0, variants: 0, renamedPrev: 0, skipped: 0 };
  if (doComponents) componentReport = await applyComponents(payload, push, problems);
  else push('skip', '컴포넌트 단계는 껐습니다.');

  for (const p of problems) push('err', p);

  return {
    log,
    problems,
    summary: {
      created,
      valuesSet: setCount,
      renamed: mg.renames.filter((r) => r.status === 'rename').length,
      split: mg.splits.filter((s) => s.status === 'split').length,
      styles: styleReport,
      components: componentReport,
      crossCollection: mg.crossCollection.length
    }
  };
}

async function applyStyles(payload, push, problems) {
  const S = payload.styles || {};
  const ren = (payload.migrations && payload.migrations.styleRenames) || {};
  const rep = { text: 0, effect: 0, renamed: 0 };

  for (const f of (S.fontsToLoad || [])) {
    try { await figma.loadFontAsync(f); }
    catch (e) { problems.push('폰트 없음 — ' + f.family + ' ' + f.style + ' · 이 폰트를 쓰는 텍스트 스타일은 건너뜁니다.'); }
  }

  let texts = await figma.getLocalTextStylesAsync();
  let tByName = new Map(texts.map((s) => [s.name, s]));
  for (const r of (ren.text || [])) {
    const s = tByName.get(r.from);
    if (s && !tByName.has(r.to)) { s.name = r.to; rep.renamed++; }
  }
  texts = await figma.getLocalTextStylesAsync();
  tByName = new Map(texts.map((s) => [s.name, s]));

  for (const t of (S.text || [])) {
    try {
      let s = tByName.get(t.name);
      if (!s) { s = figma.createTextStyle(); s.name = t.name; tByName.set(t.name, s); }
      await figma.loadFontAsync({ family: t.fontFamily, style: t.fontStyle });
      s.fontName = { family: t.fontFamily, style: t.fontStyle };
      s.fontSize = t.fontSize;
      s.lineHeight = t.lineHeight;
      s.letterSpacing = t.letterSpacing;
      rep.text++;
    } catch (e) {
      problems.push('텍스트 스타일 ' + t.name + ' — ' + e.message);
    }
  }
  push('ok', '텍스트 스타일 ' + rep.text + '개 반영' + (rep.renamed ? ' · 개명 ' + rep.renamed + '건' : ''));

  let effects = await figma.getLocalEffectStylesAsync();
  let eByName = new Map(effects.map((s) => [s.name, s]));
  for (const r of (ren.effect || [])) {
    const s = eByName.get(r.from);
    if (s && !eByName.has(r.to)) { s.name = r.to; rep.renamed++; }
  }
  effects = await figma.getLocalEffectStylesAsync();
  eByName = new Map(effects.map((s) => [s.name, s]));

  for (const e of (S.effect || [])) {
    try {
      let s = eByName.get(e.name);
      if (!s) { s = figma.createEffectStyle(); s.name = e.name; eByName.set(e.name, s); }
      s.effects = e.effects;
      if (e.source) s.description = e.source;
      rep.effect++;
    } catch (err) {
      problems.push('이펙트 스타일 ' + e.name + ' — ' + err.message);
    }
  }
  push('ok', '이펙트 스타일 ' + rep.effect + '개 반영');

  return rep;
}

/* ───────────────────────── 컴포넌트 생성 ─────────────────────────
 *
 * 읽는 것은 payload.componentBuilds — figma/component-build.js 가 낸 기계용 표다.
 * payload.components 는 사람이 읽는 스펙 서술이라 여기서 쓰지 않는다.
 *
 * 안전 규칙
 *   · 만든 것은 전용 페이지 '[Freesm] Components' 에만 둔다. 사용자의 다른 페이지는
 *     읽지도 고치지도 않는다.
 *   · 전용 페이지에 같은 이름이 이미 있으면 지우지 않고 '— 이전' 으로 개명해 옆에 둔다.
 *     기존 인스턴스는 그 옛 컴포넌트를 계속 가리키므로 아무것도 깨지지 않는다.
 *   · 다른 페이지에 같은 이름이 있으면 손대지 않고 보고만 한다.
 */

const BUILD_PAGE = '[Freesm] Components';
/* 세트를 담는 세로 오토레이아웃 프레임. 자리 계산을 Figma 에 맡겨야 겹치지 않는다 —
   set.height 를 읽어 다음 y 를 더하는 방식은 세트가 자기 크기를 다시 맞추는 순간 어긋난다. */
const COMP_HOLDER = '[Freesm] 컴포넌트 세트';

/* 값 해석 — 페이로드 안에서 별칭을 따라가 숫자를 얻는다.
   노드는 먼저 크기를 가져야 하므로, 변수를 걸기 전에 쓸 초깃값이 필요하다. */
function makeNumResolver(payload) {
  const byKey = new Map();
  const nameToCol = new Map();
  const ambiguous = [];
  const PREF = ['Semantic', 'Radius', 'Scale', 'Brand', 'Web'];
  for (const v of (payload.variables || [])) {
    byKey.set(KEY(v.collection, v.name), v);
    const cur = nameToCol.get(v.name);
    if (cur === undefined) nameToCol.set(v.name, v.collection);
    else if (cur !== v.collection) {
      const win = PREF.indexOf(v.collection) < PREF.indexOf(cur) ? v.collection : cur;
      nameToCol.set(v.name, win);
      ambiguous.push(v.name + ' (' + cur + ' · ' + v.collection + ' → ' + win + ')');
    }
  }
  const defMode = new Map();
  for (const c of (payload.collections || [])) defMode.set(c.name, c.defaultMode || c.modes[0]);

  function resolve(name, depth) {
    const col = nameToCol.get(name);
    if (!col) return null;
    const pv = byKey.get(KEY(col, name));
    if (!pv || depth > 8) return null;
    const mv = pv.values[defMode.get(col)] || pv.values[Object.keys(pv.values)[0]];
    if (!mv) return null;
    if (mv.kind === 'alias') return resolve(mv.name, depth + 1);
    return typeof mv.value === 'number' ? mv.value : parseFloat(mv.value);
  }
  return {
    collectionOf: (name) => nameToCol.get(name) || null,
    num: (name) => { const n = resolve(name, 0); return typeof n === 'number' && isFinite(n) ? n : null; },
    ambiguous: [...new Set(ambiguous)]
  };
}

/* 아이콘 자리. 이 디자인 시스템에는 아직 아이콘 라이브러리가 없다.
   빈 프레임을 두면 변형이 망가져 보이므로, 24 그리드 위의 단순 선 도형을 직접 그린다.
   나중에 진짜 아이콘 컴포넌트로 바꿔 끼우라고 컴포넌트 설명에 적어 둔다. */
const GLYPHS = {
  'check':        ['M5 13l4 4L19 7'],
  'minus':        ['M6 12h12'],
  'x':            ['M6 6l12 12', 'M18 6L6 18'],
  'search':       ['M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z', 'M20 20l-4.2-4.2'],
  'chevron-down': ['M6 9l6 6 6-6'],
  'info':         ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 11.5v4.5', 'M12 8h.01'],
  'image':        ['M3 5h18v14H3z', 'M3 16l5-5 4 4 3-3 6 6', 'M8.5 9.5h.01'],
  'upload':       ['M12 16V4', 'M7 9l5-5 5 5', 'M4 17v3h16v-3']
};

function makeIcon(glyph, size) {
  const paths = GLYPHS[glyph] || GLYPHS['x'];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" '
    + 'fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + paths.map((d) => '<path d="' + d + '"/>').join('') + '</svg>';
  const node = figma.createNodeFromSvg(svg);
  node.name = 'icon/' + glyph;
  node.resize(size || 24, size || 24);
  return node;
}

/* 아이콘 색은 프레임이 아니라 그 안의 선에 걸린다 */
function paintIcon(node, paint) {
  const targets = node.findAll ? node.findAll((n) => 'strokes' in n) : [];
  for (const n of targets) { try { n.strokes = [paint]; } catch (e) { /* 무시 */ } }
}

/* 회전한 노드를 '보이는 중심' 기준으로 놓는다.
   x·y 는 회전 전 좌상단의 위치라, 45° 돌린 화살표는 그냥 놓으면 어긋난다. */
function placeRotated(node, cx, cy, deg) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const w = node.width / 2, h = node.height / 2;
  node.relativeTransform = [[c, s, cx - (c * w + s * h)], [-s, c, cy - (-s * w + c * h)]];
}

/* 페이로드가 쓰는 값 한 개를 푼다 — {t:토큰} · {s:스타일} · 숫자 · 열거값 */
function valueKind(v) {
  if (v === null || v === undefined) return { kind: 'none' };
  if (typeof v === 'object' && typeof v.t === 'string') return { kind: 'token', name: v.t };
  if (typeof v === 'object' && typeof v.s === 'string') return { kind: 'style', name: v.s };
  if (typeof v === 'number') return { kind: 'num', value: v };
  return { kind: 'raw', value: v };
}

/* base + per(축별) + combos 를 한 덩어리로 합친다.
   축 순서대로 덮어쓰고, combos 가 마지막이다. slots 는 슬롯 이름별로 따로 합친다. */
function mergeDelta(target, delta) {
  if (!delta) return target;
  for (const k in delta) {
    if (k === 'slots') {
      target.slots = target.slots || {};
      for (const n in delta.slots) target.slots[n] = mergeDelta(target.slots[n] || {}, delta.slots[n]);
    } else target[k] = delta[k];
  }
  return target;
}

function effectiveProps(build, combo) {
  const out = mergeDelta({}, build.base);
  for (const ax of build.order) mergeDelta(out, (build.per[ax] || {})[combo[ax]]);
  const key = build.order.map((ax) => ax + '=' + combo[ax]).join(',');
  mergeDelta(out, (build.combos || {})[key]);
  return out;
}

function allCombos(build) {
  let rows = [{}];
  for (const ax of build.order) {
    const next = [];
    for (const r of rows) for (const v of build.axes[ax]) next.push(Object.assign({}, r, { [ax]: v }));
    rows = next;
  }
  return rows;
}

/* combineAsVariants 는 자식 위치를 잡아 주지 않는다 — 만들어 둔 변형이 전부 (0,0) 이라
   세트 안에서 그대로 겹쳐 쌓인다. 그래서 두 겹으로 막는다.
   1) 합치기 전에 절대좌표 격자로 편다 (세트가 처음부터 올바른 크기로 태어난다)
   2) 합친 뒤 세트 자체에 줄바꿈 오토레이아웃을 건다 — 배치를 Figma 가 맡으면
      변형끼리 겹치는 일 자체가 불가능해진다. 막히면 1) 의 격자가 그대로 남는다. */
function gridVariants(kids, build, gap, pad) {
  const G = gap === undefined ? 40 : gap, P = pad === undefined ? 32 : pad;
  if (!kids.length) return { w: 1, h: 1, cols: 1, maxW: 1 };
  const last = build.order[build.order.length - 1];
  const cols = Math.max(1, Math.min(((build.axes || {})[last] || []).length || kids.length, kids.length));
  const rows = Math.ceil(kids.length / cols);
  const colW = new Array(cols).fill(0), rowH = new Array(rows).fill(0);
  let maxW = 0;
  kids.forEach((k, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c], k.width);
    rowH[r] = Math.max(rowH[r], k.height);
    maxW = Math.max(maxW, k.width);
  });
  const xs = [], ys = [];
  let acc = P;
  for (let c = 0; c < cols; c++) { xs.push(acc); acc += colW[c] + G; }
  const totalW = acc - G + P;
  acc = P;
  for (let r = 0; r < rows; r++) { ys.push(acc); acc += rowH[r] + G; }
  const totalH = acc - G + P;
  kids.forEach((k, i) => {
    try { k.x = xs[i % cols]; k.y = ys[Math.floor(i / cols)]; } catch (e) { /* 무시 */ }
  });
  return { w: Math.max(totalW, 1), h: Math.max(totalH, 1), cols: cols, maxW: Math.max(maxW, 1), gap: G, pad: P };
}

/* 세트를 Figma 가 관리하는 줄바꿈 오토레이아웃으로 바꾼다. 성공하면 true. */
function wrapSet(set, box) {
  try {
    set.layoutMode = 'HORIZONTAL';
    set.layoutWrap = 'WRAP';
    set.itemSpacing = box.gap;
    set.counterAxisSpacing = box.gap;
    set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = box.pad;
    set.counterAxisAlignItems = 'MIN';
    set.primaryAxisSizingMode = 'FIXED';
    // 가장 넓은 변형 기준으로 한 줄 폭을 잡는다 — 좁은 변형은 한 줄에 더 들어가도 무방하다
    const rowW = box.pad * 2 + box.cols * box.maxW + (box.cols - 1) * box.gap;
    set.resize(Math.max(rowW, 1), Math.max(set.height, 1));
    set.counterAxisSizingMode = 'AUTO';
    return true;
  } catch (e) {
    try { set.layoutMode = 'NONE'; } catch (e2) { /* 무시 */ }
    try { set.resizeWithoutConstraints(box.w, box.h); }
    catch (e2) { try { set.resize(box.w, box.h); } catch (e3) { /* 무시 */ } }
    return false;
  }
}

/* ---------- dry-run ---------- */

async function dryRunComponents(payload) {
  const builds = payload.componentBuilds || [];
  const meta = payload.$componentBuilds || {};
  const out = {
    page: BUILD_PAGE,
    pageExists: !!figma.root.children.find((p) => p.name === BUILD_PAGE),
    create: [], renamePrev: [], elsewhere: [], unread: [],
    missingStyles: [], missingTokens: [],
    provisional: meta.provisional || [],
    totalVariants: 0
  };
  if (!builds.length) return out;

  const st = await readState();
  const R = makeNumResolver(payload);
  const texts = await figma.getLocalTextStylesAsync();
  const effects = await figma.getLocalEffectStylesAsync();
  const styleNames = new Set(texts.map((s) => s.name).concat(effects.map((s) => s.name)));

  for (const n of (meta.usesStyles || [])) if (!styleNames.has(n)) out.missingStyles.push(n);
  for (const n of (meta.usesTokens || [])) {
    const col = R.collectionOf(n);
    if (!col || !st.varByKey.get(KEY(col, n))) out.missingTokens.push(n);
  }

  // manifest 가 documentAccess:"dynamic-page" 라 페이지 내용은 열어야 보인다.
  // 안 열고 .children 을 만지면 그 자리에서 던진다 — dry-run 이 통째로 죽는다.
  const page = figma.root.children.find((p) => p.name === BUILD_PAGE);
  const onPage = new Map();
  if (page) {
    await page.loadAsync();
    for (const c of page.children) {
      onPage.set(c.name, c);
      // 지난 실행의 세트는 담는 프레임 안에 들어 있다 — 그 안까지 본다
      if (c.type === 'FRAME' && c.name === COMP_HOLDER)
        for (const g of c.children) onPage.set(g.name, g);
    }
  }

  for (const b of builds) {
    out.totalVariants += b.variantCount;
    if (onPage.has(b.name)) out.renamePrev.push(b.name);
    out.create.push({ name: b.name, variantCount: b.variantCount, axes: Object.keys(b.axes).join(' · ') });
  }

  // 다른 페이지의 같은 이름 — 손대지 않고 알리기만 한다
  const names = new Set(builds.map((b) => b.name));
  for (const p of figma.root.children) {
    if (p.name === BUILD_PAGE) continue;
    try { await p.loadAsync(); } catch (e) { out.unread.push(p.name); continue; }
    for (const c of p.children) {
      if ((c.type === 'COMPONENT_SET' || c.type === 'COMPONENT') && names.has(c.name))
        out.elsewhere.push({ page: p.name, name: c.name, type: c.type });
    }
  }
  return out;
}

/* ---------- 적용 ---------- */

async function applyComponents(payload, push, problems) {
  const builds = payload.componentBuilds || [];
  const meta = payload.$componentBuilds || {};
  const rep = { sets: 0, variants: 0, renamedPrev: 0, skipped: 0, lostVariants: 0 };
  if (!builds.length) { push('skip', '빌드표가 없어 컴포넌트 단계를 건너뜁니다.'); return rep; }

  const st = await readState();
  const mg = planMigrations(payload, st);
  const lookup = makeLookup(st, mg);
  const R = makeNumResolver(payload);
  for (const a of R.ambiguous) problems.push('토큰 이름이 두 컬렉션에 있습니다 — ' + a);

  /* 폰트 — 새로 만든 텍스트 노드는 '파일 기본 폰트'(보통 Inter Regular)로 시작한다.
     그 폰트를 안 불러온 채 characters 를 건드리면 그 자리에서 던지고,
     예외가 세트 단위 catch 까지 올라가 세트 하나가 통째로 날아간다. */
  const loadedFonts = new Set();
  const ensureFont = async (fn) => {
    if (!fn || fn === figma.mixed || typeof fn.family !== 'string') return false;
    const k = fn.family + '|' + fn.style;
    if (loadedFonts.has(k)) return true;
    try { await figma.loadFontAsync(fn); loadedFonts.add(k); return true; }
    catch (e) { problems.push('폰트를 불러오지 못했습니다 — ' + fn.family + ' ' + fn.style); return false; }
  };
  for (const f of (payload.styles && payload.styles.fontsToLoad) || []) await ensureFont(f);

  const texts = await figma.getLocalTextStylesAsync();
  const effects = await figma.getLocalEffectStylesAsync();
  const tByName = new Map(texts.map((s) => [s.name, s]));
  const eByName = new Map(effects.map((s) => [s.name, s]));

  const varOf = (name) => {
    const col = R.collectionOf(name);
    return col ? lookup(col, name) : null;
  };
  const solid = (tokenName) => {
    let paint = { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1 };
    const v = varOf(tokenName);
    if (!v) { problems.push('컴포넌트 — 없는 토큰 ' + tokenName); return paint; }
    try { paint = figma.variables.setBoundVariableForPaint(paint, 'color', v); }
    catch (e) { problems.push('컴포넌트 색 바인딩 실패 ' + tokenName + ' — ' + e.message); }
    return paint;
  };
  const bindNum = (node, field, tokenName) => {
    const v = varOf(tokenName);
    if (!v) { problems.push('컴포넌트 — 없는 토큰 ' + tokenName); return; }
    try { node.setBoundVariable(field, v); }
    catch (e) { problems.push('컴포넌트 ' + field + ' 바인딩 실패 ' + tokenName + ' — ' + e.message); }
  };

  /* 페이지 확보 */
  let page = figma.root.children.find((p) => p.name === BUILD_PAGE);
  if (!page) { page = figma.createPage(); page.name = BUILD_PAGE; push('ok', '페이지 신규 — ' + BUILD_PAGE); }
  else await page.loadAsync();   // dynamic-page — 열지 않으면 children 접근이 던진다
  await figma.setCurrentPageAsync(page);

  /* 세트를 담을 세로 오토레이아웃 프레임을 확보한다.
     세트를 페이지에 직접 놓고 y 를 더해 가면, 세트가 자기 크기를 다시 맞추는 순간
     계산이 어긋나 아래 세트를 덮어쓴다. 프레임 안에 넣으면 간격을 Figma 가 지킨다. */
  let holder = page.children.find((c) => c.type === 'FRAME' && c.name === COMP_HOLDER) || null;
  const holderIsNew = !holder;
  if (!holder) {
    holder = figma.createFrame();
    holder.name = COMP_HOLDER;
    page.appendChild(holder);
  }
  try {
    holder.layoutMode = 'VERTICAL';
    holder.layoutWrap = 'NO_WRAP';
    holder.primaryAxisSizingMode = 'AUTO';
    holder.counterAxisSizingMode = 'AUTO';
    holder.counterAxisAlignItems = 'MIN';
    holder.itemSpacing = 120;
    holder.paddingLeft = holder.paddingRight = holder.paddingTop = holder.paddingBottom = 64;
    holder.fills = [];
    holder.clipsContent = false;
  } catch (e) { problems.push('컴포넌트 담을 프레임 설정 실패 — ' + e.message); }
  if (holderIsNew) {
    // 기존 내용 오른쪽에서 시작한다
    let ox = 0;
    for (const c of page.children) if (c !== holder) ox = Math.max(ox, c.x + c.width + 160);
    try { holder.x = ox; holder.y = 0; } catch (e) { /* 무시 */ }
  }

  /* 같은 이름이 이미 있으면 지우지 않고 이름만 밀어 둔다.
     기존 인스턴스는 옛 컴포넌트를 계속 가리키므로 깨지지 않는다.
     지난 실행의 세트는 담는 프레임 안에 있으므로 그 안까지 본다. */
  {
    const want = new Set(builds.map((b) => b.name));
    const scan = page.children.concat(holder.children);
    const taken = new Set(scan.map((x) => x.name));
    for (const c of scan) {
      if ((c.type !== 'COMPONENT_SET' && c.type !== 'COMPONENT') || !want.has(c.name)) continue;
      let n = c.name + ' — 이전', i = 2;
      while (taken.has(n)) { n = c.name + ' — 이전 ' + i; i++; }
      c.name = n;
      taken.add(n);
      rep.renamedPrev++;
      push('ok', '기존 컴포넌트 개명 — ' + n + ' (지우지 않았습니다)');
    }
  }

  /* 같은 토큰이 136개 변형에서 반복해 실패한다 — 한 번만 알린다 */
  const said = new Set();
  const sayOnce = (m) => { if (said.has(m)) return; said.add(m); problems.push(m); };

  /* ---- 한 노드에 속성 한 벌 적용 ---- */
  const applyProps = async (node, p, parentAuto, parentBox) => {
    // 토큰을 못 풀면 예전에는 조용히 24 를 넣었다 — 선 두께·간격에서는 재앙이다.
    // 이제는 null 을 돌려주고(=그 속성은 건드리지 않는다) 반드시 보고한다.
    const num = (v) => {
      const k = valueKind(v);
      if (k.kind === 'num') return k.value;
      if (k.kind === 'token') {
        const n = R.num(k.name);
        if (n === null) sayOnce('컴포넌트 — 토큰 값을 못 읽었습니다 ' + k.name + ' (해당 속성은 그대로 둡니다)');
        return n;
      }
      return null;
    };

    /* 한 속성이 던져도 변형 하나가 통째로 날아가지 않게 감싼다.
       Figma 는 노드 종류·부모 상태에 따라 같은 속성을 받기도 하고 거절하기도 한다. */
    const T = (what, fn) => {
      try { return fn(); }
      catch (e) { sayOnce(node.name + ' — ' + what + ' 적용 실패: ' + (e && e.message ? e.message : String(e))); return undefined; }
    };

    // 레이아웃 먼저 — 크기 규칙이 여기에 매인다
    if (p.layout !== undefined && 'layoutMode' in node)
      T('레이아웃', () => { node.layoutMode = p.layout === 'NONE' ? 'NONE' : p.layout; });
    const auto = 'layoutMode' in node && node.layoutMode !== 'NONE';
    if (auto) {
      if (p.alignPrimary) T('주축 정렬', () => { node.primaryAxisAlignItems = p.alignPrimary; });
      if (p.alignCounter) T('교차축 정렬', () => { node.counterAxisAlignItems = p.alignCounter; });
      for (const [key, fields] of [['pad', ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']],
                                   ['padX', ['paddingLeft', 'paddingRight']],
                                   ['padY', ['paddingTop', 'paddingBottom']]]) {
        if (p[key] === undefined) continue;
        const k = valueKind(p[key]);
        const n = num(p[key]);
        for (const f of fields) T('여백 ' + f, () => { node[f] = n === null ? 0 : n; if (k.kind === 'token') bindNum(node, f, k.name); });
      }
      if (p.gap !== undefined) T('간격', () => { node.itemSpacing = num(p.gap) || 0; const k = valueKind(p.gap); if (k.kind === 'token') bindNum(node, 'itemSpacing', k.name); });
    }

    // 크기 — 숫자를 먼저, HUG 를 나중에.
    // resize() 는 두 축의 sizing 모드를 모두 FIXED 로 되돌린다. HUG 를 먼저 걸면
    // 반대 축의 숫자 지정이 방금 건 HUG 를 지워 버린다.
    const isHug = (v) => v === 'HUG';
    const sizeNum = (key, dim, field, sizingProp) => {
      if (p[key] === undefined || isHug(p[key])) return;
      const k = valueKind(p[key]);
      const n = num(p[key]);
      if (n === null) return;
      if (parentAuto) { try { node[sizingProp] = 'FIXED'; } catch (e) { /* 무시 */ } }
      try { node.resize(dim === 'w' ? Math.max(n, 0.01) : node.width, dim === 'h' ? Math.max(n, 0.01) : node.height); }
      catch (e) { problems.push(node.name + ' 크기 — ' + e.message); }
      if (k.kind === 'token') bindNum(node, field, k.name);
    };
    const sizeHug = (key, sizingProp) => {
      if (!isHug(p[key])) return;
      if (node.type === 'TEXT') {
        // 오토레이아웃 밖의 텍스트에는 layoutSizing 을 걸 수 없다 — 자동 크기가 같은 결과를 낸다
        if (!parentAuto) {
          try { node.textAutoResize = isHug(p.w) && (p.h === undefined || isHug(p.h)) ? 'WIDTH_AND_HEIGHT' : 'HEIGHT'; }
          catch (e) { /* 무시 */ }
          return;
        }
      } else if (!auto) {
        sayOnce(node.name + ' — 오토레이아웃이 아니라 HUG 을 걸지 못했습니다 (' + node.type + ') · 크기는 그대로 둡니다');
        return;
      }
      try { node[sizingProp] = 'HUG'; }
      catch (e) { sayOnce(node.name + ' — HUG 실패 (' + sizingProp + ') ' + e.message); }
    };
    if (node.type === 'TEXT') {
      const wn = p.w !== undefined && !isHug(p.w), hn = p.h !== undefined && !isHug(p.h);
      if (wn && hn) T('글자 자동크기', () => { node.textAutoResize = 'NONE'; });
      else if (wn) T('글자 자동크기', () => { node.textAutoResize = 'HEIGHT'; });
    }
    sizeNum('w', 'w', 'width', 'layoutSizingHorizontal');
    sizeNum('h', 'h', 'height', 'layoutSizingVertical');
    sizeHug('w', 'layoutSizingHorizontal');
    sizeHug('h', 'layoutSizingVertical');
    // minWidth 는 오토레이아웃 프레임과 그 직계 자식에만 통한다.
    // 아무 데나 대입하면 던지고, 그 예외가 세트 하나를 통째로 날린다.
    if (p.minW !== undefined) {
      const k = valueKind(p.minW);
      const n = num(p.minW);
      if (n !== null && n > 0 && (auto || parentAuto) && 'minWidth' in node) {
        try { node.minWidth = n; if (k.kind === 'token') bindNum(node, 'minWidth', k.name); }
        catch (e) { sayOnce(node.name + ' 최소 폭 — ' + e.message); }
      }
    }

    // 모서리
    const radiusFields = { radius: ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'],
                           radiusTop: ['topLeftRadius', 'topRightRadius'],
                           radiusBottom: ['bottomLeftRadius', 'bottomRightRadius'] };
    for (const key in radiusFields) {
      if (p[key] === undefined || !('topLeftRadius' in node)) continue;
      const k = valueKind(p[key]);
      const n = num(p[key]);
      for (const f of radiusFields[key]) T('모서리 ' + f, () => { node[f] = n === null ? 0 : n; if (k.kind === 'token') bindNum(node, f, k.name); });
    }

    // 칠 · 선
    if (p.fill !== undefined && 'fills' in node) T('칠', () => {
      const k = valueKind(p.fill);
      node.fills = k.kind === 'token' ? [solid(k.name)] : [];
    });
    if (p.border !== undefined && 'strokes' in node) T('선', () => {
      const k = valueKind(p.border);
      if (k.kind === 'token') {
        node.strokes = [solid(k.name)];
        if (node.strokeWeight === 0) node.strokeWeight = 1;
        try { node.strokeAlign = 'INSIDE'; } catch (e) { /* ellipse 등은 무시 */ }
      } else node.strokes = [];
    });
    if (p.strokeWeight !== undefined && 'strokeWeight' in node) T('선 두께', () => {
      const k = valueKind(p.strokeWeight);
      const n = num(p.strokeWeight);
      if (n !== null && n >= 0) node.strokeWeight = n;
      if (k.kind === 'token') bindNum(node, 'strokeWeight', k.name);
    });
    if (p.borderStyle === 'DASHED' && 'dashPattern' in node) T('점선', () => { node.dashPattern = [4, 4]; });

    // 그림자 — 이펙트 스타일로만 건다
    if (p.shadow !== undefined && 'setEffectStyleIdAsync' in node) {
      const k = valueKind(p.shadow);
      if (k.kind === 'style') {
        const s = eByName.get(k.name);
        if (s) { try { await node.setEffectStyleIdAsync(s.id); } catch (e) { problems.push(node.name + ' 그림자 — ' + e.message); } }
        else problems.push('컴포넌트 — 없는 이펙트 스타일 ' + k.name);
      } else node.effects = [];
    }

    // 글자 — 스타일을 먼저 걸어 폰트를 확정하고, 그 폰트를 불러온 뒤에 글자를 쓴다.
    // 순서가 바뀌면 "Cannot write to node with unloaded font" 로 세트가 통째로 날아간다.
    if (node.type === 'TEXT') {
      if (p.textStyle !== undefined) {
        const k = valueKind(p.textStyle);
        const s = k.kind === 'style' ? tByName.get(k.name) : null;
        if (s) { try { await node.setTextStyleIdAsync(s.id); } catch (e) { sayOnce(node.name + ' 텍스트 스타일 — ' + e.message); } }
        else if (k.kind === 'style') sayOnce('컴포넌트 — 없는 텍스트 스타일 ' + k.name);
      }
      if (p.chars !== undefined) {
        if (await ensureFont(node.fontName)) {
          try { node.characters = String(p.chars); } catch (e) { sayOnce(node.name + ' 글자 — ' + e.message); }
        }
      }
      if (p.decoration !== undefined) {
        try { node.textDecoration = p.decoration === 'NONE' ? 'NONE' : p.decoration; }
        catch (e) { sayOnce(node.name + ' 밑줄 — ' + e.message); }
      }
    }

    // 아이콘 색은 프레임이 아니라 안쪽 선에 건다
    if (node.getPluginData && node.getPluginData('freesmIcon') === '1' && p.fill !== undefined) {
      const k = valueKind(p.fill);
      if (k.kind === 'token') paintIcon(node, solid(k.name));
      node.fills = [];
    }

    if (p.visible !== undefined) T('표시', () => { node.visible = !!p.visible; });

    // 원호 — 스피너. 표는 border+strokeWeight 로 적지만, Figma 에서 호를 선으로 그리면
    // 부채꼴 테두리가 되어 두 줄이 보인다. 그래서 도넛 채우기로 옮겨 그린다.
    if (p.arc !== undefined && node.type === 'ELLIPSE') T('원호', () => {
      const sw = typeof node.strokeWeight === 'number' && node.strokeWeight > 0 ? node.strokeWeight : 2;
      const inner = Math.max(0, Math.min(0.95, 1 - (2 * sw) / Math.max(node.width, 1)));
      node.arcData = { startingAngle: -Math.PI / 2, endingAngle: -Math.PI / 2 + Math.PI * 2 * p.arc, innerRadius: inner };
      if (node.strokes.length) { node.fills = node.strokes.slice(); node.strokes = []; }
    });

    // 절대 배치
    if (p.absolute && parentBox) T('절대 배치', () => {
      if (parentAuto) { try { node.layoutPositioning = 'ABSOLUTE'; } catch (e) { /* 무시 */ } }
      const PW = parentBox.w, PH = parentBox.h;
      const ratio = typeof p.ratio === 'number' ? p.ratio : null;
      const a = p.anchor;
      if (a === 'FULL') { node.resize(Math.max(PW, 0.01), Math.max(PH, 0.01)); node.x = 0; node.y = 0; node.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }; }
      else if (a === 'CENTER_H') { node.resize(Math.max(PW, 0.01), Math.max(node.height, 0.01)); node.x = 0; node.y = (PH - node.height) / 2; node.constraints = { horizontal: 'STRETCH', vertical: 'CENTER' }; }
      // 높이를 따로 적지 않은 채움 막대는 부모 높이를 그대로 쓴다.
      // node.height 를 그냥 쓰면 새로 만든 프레임의 기본값 100 이 들어와 트랙 밖으로 삐져나온다.
      else if (a === 'LEFT') { const hh = p.h !== undefined ? node.height : PH; if (ratio !== null) node.resize(Math.max(PW * ratio, 0.01), Math.max(hh, 0.01)); else node.resize(Math.max(node.width, 0.01), Math.max(PH, 0.01)); node.x = 0; node.y = (PH - node.height) / 2; node.constraints = { horizontal: 'MIN', vertical: 'CENTER' }; }
      else if (a === 'RIGHT') { node.x = PW - node.width / 2; node.y = (PH - node.height) / 2; node.constraints = { horizontal: 'MAX', vertical: 'CENTER' }; }
      else if (a === 'TOP') { node.x = (PW - node.width) / 2; node.y = -node.height / 2; node.constraints = { horizontal: 'CENTER', vertical: 'MIN' }; }
      else if (a === 'BOTTOM') { node.x = (PW - node.width) / 2; node.y = PH - node.height / 2; node.constraints = { horizontal: 'CENTER', vertical: 'MAX' }; }
      else if (a === 'RATIO_H') { node.x = PW * (ratio === null ? 0.5 : ratio) - node.width / 2; node.y = (PH - node.height) / 2; node.constraints = { horizontal: 'MIN', vertical: 'CENTER' }; }
      if (p.rotation) {
        const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
        placeRotated(node, cx, cy, p.rotation);
      }
    });
    // 절대 배치가 아닌데 회전만 있는 경우 (절대 배치 안에서는 위에서 이미 돌린다)
    if (!(p.absolute && parentBox) && p.rotation)
      T('회전', () => { placeRotated(node, node.x + node.width / 2, node.y + node.height / 2, p.rotation); });
  };

  /* ---- 슬롯 한 개를 만든다 ---- */
  const makeSlot = async (spec, props, parent, parentBox) => {
    let node;
    if (spec.kind === 'text') node = figma.createText();
    else if (spec.kind === 'rect') node = figma.createRectangle();
    else if (spec.kind === 'ellipse') node = figma.createEllipse();
    else if (spec.kind === 'icon') {
      const glyph = props.glyph || spec.glyph || 'x';
      const k = valueKind(props.w !== undefined ? props.w : spec.w);
      const size = k.kind === 'token' ? (R.num(k.name) || 16) : (k.kind === 'num' ? k.value : 16);
      node = makeIcon(glyph, size);
      node.setPluginData('freesmIcon', '1');
    } else node = figma.createFrame();
    node.name = spec.name;
    if (node.type === 'FRAME' && node.getPluginData('freesmIcon') !== '1') node.fills = [];
    parent.appendChild(node);   // 여기서 던지면 그 변형만 실패한다 (바깥에서 잡는다)

    const parentAuto = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
    if (node.type === 'TEXT') {
      // 새 텍스트 노드는 파일 기본 폰트를 쓴다 — 불러오기 전에는 characters 를 못 쓴다
      node.textAutoResize = 'WIDTH_AND_HEIGHT';
      if (await ensureFont(node.fontName)) { try { node.characters = ' '; } catch (e) { /* 아래에서 다시 알린다 */ } }
    }
    await applyProps(node, props, parentAuto, parentBox);

    if (spec.children && spec.children.length) {
      for (const ch of spec.children) {
        const chProps = mergeDelta(mergeDelta({}, ch), (props.slots || {})[ch.name]);
        // 자식을 붙일 때마다 HUG 부모의 크기가 바뀐다 — 상자를 매번 새로 잰다
        await makeSlot(ch, chProps, node, { w: node.width, h: node.height });
      }
    }
    return node;
  };

  /* ---- 컴포넌트셋 하나 ---- */
  for (const b of builds) {
    let variants = [];
    let madeSet = null;
    let lost = 0;
    try {
      for (const combo of allCombos(b)) {
        const vName = b.order.map((ax) => ax + '=' + combo[ax]).join(', ');
        let root = null;
        // 변형 하나가 터져도 세트 전체를 버리지 않는다 — 그 변형만 빼고 나머지는 살린다
        try {
          const p = effectiveProps(b, combo);
          root = figma.createComponent();
          root.name = vName;
          root.fills = [];
          page.appendChild(root);
          await applyProps(root, p, false, null);
          for (const spec of (b.slots || [])) {
            const sp = mergeDelta(mergeDelta({}, spec), (p.slots || {})[spec.name]);
            // HUG 루트는 슬롯이 붙을 때마다 커진다 — 절대 배치의 기준 상자를 매번 새로 잰다
            await makeSlot(spec, sp, root, { w: root.width, h: root.height });
          }
          variants.push(root);
        } catch (ev) {
          lost++;
          if (root) { try { if (!root.removed) root.remove(); } catch (e2) { /* 무시 */ } }
          problems.push('컴포넌트 ' + b.name + ' · 변형 ' + vName + ' 실패 — ' + (ev && ev.message ? ev.message : String(ev)));
        }
      }
      if (!variants.length) throw new Error('살아남은 변형이 없습니다');

      // 합치기 전에 격자로 펴 둔다 — 세트가 처음부터 올바른 크기로 태어난다
      const box = gridVariants(variants, b);
      const set = figma.combineAsVariants(variants, page);
      madeSet = set;
      set.name = b.name;
      // 세트 자체를 줄바꿈 오토레이아웃으로 — 변형끼리 겹치는 일이 구조적으로 불가능해진다
      wrapSet(set, box);
      // 세로 간격은 담는 프레임의 오토레이아웃이 지킨다 — 좌표를 직접 계산하지 않는다
      holder.appendChild(set);
      try { set.layoutSizingHorizontal = 'FIXED'; } catch (e) { /* 무시 */ }

      const lines = [];
      if (b.notes) lines.push.apply(lines, b.notes);
      const wI = b.base && b.base.wIntent, hI = b.base && b.base.hIntent;
      if (wI === 'FILL') lines.push('폭은 원래 FILL 입니다 — 컴포넌트 루트에는 FILL 을 걸 수 없어 기본 폭을 숫자로 두었습니다. 배치할 때 폭을 채우기로 바꾸세요.');
      if (hI === 'FILL') lines.push('높이는 원래 FILL 입니다 — 배치할 때 높이를 채우기로 바꾸세요.');
      if ((b.slots || []).some((s) => s.kind === 'icon'))
        lines.push('아이콘은 임시 도형입니다 — 아이콘 라이브러리가 생기면 바꿔 끼우세요.');
      lines.push('figma/component-build.js 가 만든 것입니다. 손으로 고치면 다음 실행에서 새 세트가 생기고 이 세트는 "— 이전" 으로 밀립니다.');
      set.description = lines.join('\n');

      rep.sets++;
      rep.variants += variants.length;
      rep.lostVariants += lost;
      push(lost ? 'skip' : 'ok', '컴포넌트 — ' + b.name + ' (' + variants.length + '개 변형'
        + (lost ? ' · 변형 ' + lost + '개 실패' : '') + ')');
    } catch (e) {
      // 실패한 세트의 조각을 페이지에 남기지 않는다.
      // combineAsVariants 뒤에 터지면 변형의 부모가 이미 세트라 낱개 제거로는 안 지워진다 — 세트를 지운다.
      if (madeSet) { try { if (!madeSet.removed) madeSet.remove(); } catch (e2) { /* 무시 */ } }
      else for (const v of variants) { try { if (!v.removed) v.remove(); } catch (e2) { /* 무시 */ } }
      rep.skipped++;
      problems.push('컴포넌트 ' + b.name + ' 생성 실패 — ' + (e && e.message ? e.message : String(e)));
      push('err', '컴포넌트 실패 — ' + b.name);
    }
  }

  push('ok', '컴포넌트 ' + rep.sets + '세트 · 변형 ' + rep.variants + '개'
    + (rep.renamedPrev ? ' · 기존 개명 ' + rep.renamedPrev + '건' : '')
    + (rep.lostVariants ? ' · 변형 실패 ' + rep.lostVariants + '개' : '')
    + (rep.skipped ? ' · 세트 실패 ' + rep.skipped + '건' : ''));
  if ((meta.provisional || []).length)
    push('skip', '잠정 수치 ' + meta.provisional.length + '건 — 전용 토큰이 없어 숫자로 넣었습니다.');
  return rep;
}

/* ───────────────────────── UI 메시지 ───────────────────────── */

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'dryrun') {
      const plan = await dryRun(msg.payload);
      figma.ui.postMessage({ type: 'plan', plan });
    } else if (msg.type === 'apply') {
      const report = await apply(msg.payload, msg.opts);
      figma.ui.postMessage({ type: 'done', report });
    } else if (msg.type === 'close') {
      figma.closePlugin();
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: e && e.message ? e.message : String(e), stack: e && e.stack });
  }
};
