/* Freesm 토큰 빌더 — Figma 플러그인 (본체)
 *
 * figma/build-payload.json 을 받아 이 파일의 변수·스타일을 페이로드에 맞춘다.
 *
 * 원칙 (payload.$meta.policy 와 같다)
 *   · 삭제 없음        — 페이로드에 없는 것은 '고아'로 보고만 한다.
 *   · 개명은 제자리    — variable.name 을 고쳐 기존 바인딩을 살린다.
 *   · dry-run 필수     — 적용 전에 신규·개명·값변경을 사람이 확인한다.
 *   · 컴포넌트 생성 없음 — payload.components 는 스펙 목록일 뿐, 여기서 만들지 않는다.
 *
 * 실행 순서: 컬렉션/모드 → 개명 → 분할 → 변수 생성 → 값 주입 → 스타일
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
    counts: {
      create: variables.create.length,
      update: variables.update.length,
      same: variables.same,
      renames: mg.renames.filter((r) => r.status === 'rename').length,
      splits: mg.splits.filter((s) => s.status === 'split').length,
      unsafe: mg.renames.filter((r) => r.status === 'unsafe').length
            + mg.splits.filter((s) => s.status === 'unsafe').length,
      orphans: orphanFiltered.length
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
