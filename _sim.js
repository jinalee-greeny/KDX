#!/usr/bin/env node
/* 컴포넌트 생성 단계 헛돌리기 — Figma 없이 code.js 의 applyComponents 를 태운다.
   가짜 노드가 실제 Figma 처럼 굴지는 않지만, '어떤 속성을 어떤 노드에 걸려 했는가'는
   그대로 드러난다. 플러그인을 Figma 에 올리기 전에 예외·오타·빠진 분기를 잡는 용도다.

   사용: node _sim.js <payload.json> <code.js>
*/
'use strict';
const fs = require('fs');
const vm = require('vm');

const PAYLOAD = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const CODE = fs.readFileSync(process.argv[3], 'utf8');

const calls = { bindNum: [], bindPaint: [], textStyle: [], effectStyle: [], svg: [], effectBind: [] };
const errors = [];

const PROPS = {
  FRAME:     ['layoutMode', 'layoutWrap', 'primaryAxisSizingMode', 'counterAxisSizingMode', 'counterAxisSpacing', 'maxWidth', 'minHeight', 'maxHeight', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'dashPattern', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'minWidth', 'effects', 'layoutPositioning', 'constraints', 'layoutSizingHorizontal', 'layoutSizingVertical', 'clipsContent'],
  COMPONENT: null, // FRAME 과 같다
  RECTANGLE: ['fills', 'strokes', 'strokeWeight', 'strokeAlign', 'dashPattern', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'effects', 'layoutPositioning', 'constraints', 'layoutSizingHorizontal', 'layoutSizingVertical'],
  ELLIPSE:   ['fills', 'strokes', 'strokeWeight', 'dashPattern', 'arcData', 'effects', 'layoutPositioning', 'constraints', 'layoutSizingHorizontal', 'layoutSizingVertical'],
  TEXT:      ['fills', 'strokes', 'strokeWeight', 'characters', 'textAutoResize', 'textDecoration', 'textStyleId', 'effects', 'layoutPositioning', 'constraints', 'layoutSizingHorizontal', 'layoutSizingVertical']
};
PROPS.COMPONENT = PROPS.FRAME;
PROPS.COMPONENT_SET = PROPS.FRAME;
PROPS.INSTANCE = PROPS.FRAME;

/* Figma 가 실제로 거절하는 값들 — 가짜 노드가 다 받아주면 헛돌리기가 의미 없다 */
const ENUM = {
  layoutMode: ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'],
  layoutWrap: ['NO_WRAP', 'WRAP'],
  primaryAxisSizingMode: ['FIXED', 'AUTO'],
  counterAxisSizingMode: ['FIXED', 'AUTO'],
  primaryAxisAlignItems: ['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN'],
  counterAxisAlignItems: ['MIN', 'MAX', 'CENTER', 'BASELINE'],
  layoutSizingHorizontal: ['FIXED', 'HUG', 'FILL'],
  layoutSizingVertical: ['FIXED', 'HUG', 'FILL'],
  layoutPositioning: ['AUTO', 'ABSOLUTE'],
  strokeAlign: ['CENTER', 'INSIDE', 'OUTSIDE'],
  textAutoResize: ['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE'],
  textDecoration: ['NONE', 'UNDERLINE', 'STRIKETHROUGH']
};
const CONSTRAINT = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE'];
/* 이 속성이 바뀌면 오토레이아웃을 다시 돌린다 */
const RELAYOUT = new Set(['layoutMode', 'layoutWrap', 'itemSpacing', 'counterAxisSpacing',
  'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'visible', 'characters',
  'textAutoResize', 'fontSize', 'layoutSizingHorizontal', 'layoutSizingVertical',
  'primaryAxisSizingMode', 'counterAxisSizingMode', 'layoutPositioning']);
const FREE = new Set(['id', 'type', 'name', 'x', 'y', 'width', 'height', 'visible', 'removed',
  'parent', 'children', 'relativeTransform', 'textStyleId', 'effectStyleId', 'description',
  'characters', 'fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'expanded',
  'appendChild', 'remove', 'resize', 'resizeWithoutConstraints', 'findAll', 'setPluginData', 'getPluginData',
  'setBoundVariable', 'setTextStyleIdAsync', 'setEffectStyleIdAsync', '_pd', '_bound', '_rt',
  'loadAsync', '_loaded', '_hugW', '_hugH', '_isSet', '__proxy',
  'createInstance', 'variantProperties', 'findOne', 'mainComponent', 'clipsContent',
  'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight',
  'cornerRadius', 'opacity', 'textAlignHorizontal', 'textAlignVertical']);

/* 실제 Figma 는 '불러오지 않은 폰트'를 가진 노드의 글자를 못 쓰게 한다.
   하네스가 이걸 흉내 내지 않아, 기본 폰트(Inter)를 안 불러온 결함을 통째로 놓쳤다. */
const loadedFonts = new Set();
/* 폰트가 안 불러와졌을 때 실제 Figma 가 거절하는 텍스트 속성들 */
const TEXT_WRITE = new Set(['characters', 'fontName', 'fontSize', 'textAutoResize', 'lineHeight',
  'letterSpacing', 'textCase', 'textDecoration', 'paragraphSpacing', 'paragraphIndent',
  'textAlignHorizontal', 'textAlignVertical', 'textStyleId']);
const fontKey = (f) => (f && f.family ? f.family + '|' + f.style : '?');
const DEFAULT_FONT = { family: 'Inter', style: 'Regular' };
const textStyleFont = new Map();   // 텍스트 스타일 id → 그 스타일이 쓰는 폰트

/* 오토레이아웃을 흉내 낸다. 이게 없으면 모든 노드가 100×100 으로 남아
   격자 계산·HUG 성장·겹침 판정이 전부 헛돌고, 실제 파일에서만 겹친다.
   실제로 그렇게 한 번 놓쳤다 — 하네스는 초록인데 Figma 에서는 겹쳤다. */
const NUM = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
function reflowSelf(n) {
  if (!n || n.removed) return;
  if (n.type === 'TEXT') {
    const t = String(n.characters || '');
    const fs = NUM(n.fontSize) || 14;
    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') { n.width = Math.max(1, t.length * fs * 0.62 + 2); n.height = Math.max(1, fs * 1.45); }
    else if (n.textAutoResize === 'HEIGHT') { n.height = Math.max(1, fs * 1.45 * Math.max(1, Math.ceil((t.length * fs * 0.62) / Math.max(n.width, 1)))); }
    return;
  }
  const mode = n.layoutMode;
  if (!mode || mode === 'NONE') {
    // 컴포넌트 세트는 오토레이아웃이 아니어도 자식 경계에 맞춰 스스로 커진다
    if (n._isSet && n.children.length) {
      let w = 0, h = 0;
      for (const c of n.children) { w = Math.max(w, c.x + c.width); h = Math.max(h, c.y + c.height); }
      n.width = Math.max(w, 1); n.height = Math.max(h, 1);
    }
    return;
  }
  const horiz = mode === 'HORIZONTAL';
  const pl = NUM(n.paddingLeft), pr = NUM(n.paddingRight), pt = NUM(n.paddingTop), pb = NUM(n.paddingBottom);
  const gap = NUM(n.itemSpacing);
  const cgap = n.counterAxisSpacing === undefined || n.counterAxisSpacing === null ? gap : NUM(n.counterAxisSpacing);
  const kids = n.children.filter((c) => c.visible !== false && c.layoutPositioning !== 'ABSOLUTE');
  if (horiz && n.layoutWrap === 'WRAP') {
    const avail = Math.max(n.width - pl - pr, 1);
    const rows = [];
    let row = [], used = 0;
    for (const c of kids) {
      const need = row.length ? used + gap + c.width : c.width;
      if (row.length && need > avail) { rows.push(row); row = [c]; used = c.width; }
      else { row.push(c); used = need; }
    }
    if (row.length) rows.push(row);
    let y = pt, maxRow = 0;
    for (const r of rows) {
      let x = pl, hh = 0;
      for (const c of r) { c.x = x; c.y = y; x += c.width + gap; hh = Math.max(hh, c.height); }
      maxRow = Math.max(maxRow, x - gap - pl);
      y += hh + cgap;
    }
    const totalH = (rows.length ? y - cgap : pt) + pb;
    if (n._hugW) n.width = Math.max(maxRow + pl + pr, 1);
    if (n._hugH) n.height = Math.max(totalH, 1);
    return;
  }
  let main = horiz ? pl : pt, cross = 0;
  for (const c of kids) {
    if (horiz) { c.x = main; c.y = pt; main += c.width + gap; cross = Math.max(cross, c.height); }
    else { c.y = main; c.x = pl; main += c.height + gap; cross = Math.max(cross, c.width); }
  }
  if (kids.length) main -= gap;
  /* 교차축 정렬 — 흉내 내지 않으면 CENTER 로 세운 화면이 전부 왼쪽에 붙는다.
     컴포넌트는 전부 MIN 이라 여태 드러나지 않았지만, 화면은 가운데 정렬을 실제로 쓴다. */
  const ca = n.counterAxisAlignItems;
  if (ca === 'CENTER' || ca === 'MAX') {
    const room = horiz ? Math.max(n.height - pt - pb, 0) : Math.max(n.width - pl - pr, 0);
    for (const c of kids) {
      const size = horiz ? c.height : c.width;
      const off = ca === 'CENTER' ? (room - size) / 2 : (room - size);
      if (horiz) c.y = pt + off; else c.x = pl + off;
    }
  }
  const mainTotal = main + (horiz ? pr : pb);
  const crossTotal = cross + (horiz ? pt + pb : pl + pr);
  if (horiz) { if (n._hugW) n.width = Math.max(mainTotal, 1); if (n._hugH) n.height = Math.max(crossTotal, 1); }
  else { if (n._hugH) n.height = Math.max(mainTotal, 1); if (n._hugW) n.width = Math.max(crossTotal, 1); }
}
function touch(n) {
  let cur = n, guard = 0;
  while (cur && guard++ < 40) { reflowSelf(cur); cur = cur.parent; }
}

let seq = 0;
function Node(type, name) {
  const self = {
    id: type + ':' + (++seq), type, name: name || type,
    x: 0, y: 0, width: 100, height: 100, visible: true, removed: false,
    parent: null, children: [],
    _pd: {}, _bound: {}, _hugW: false, _hugH: false, _isSet: type === 'COMPONENT_SET'
  };
  for (const p of (PROPS[type] || [])) {
    if (p === 'fills' || p === 'strokes' || p === 'effects') self[p] = [];
    else if (p === 'strokeWeight') self[p] = 0;
    else if (p === 'layoutMode') self[p] = 'NONE';
    else if (p.endsWith('Radius') || p.startsWith('padding') || p === 'itemSpacing' || p === 'minWidth') self[p] = 0;
    else self[p] = undefined;
  }
  const me = () => self.__proxy || self;
  self.appendChild = (n) => { if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n); n.parent = me(); self.children.push(n); touch(me()); };
  self.remove = () => { self.removed = true; if (self.parent) self.parent.children = self.parent.children.filter((c) => c !== me()); };
  if (type === 'TEXT') self.fontName = Object.assign({}, DEFAULT_FONT);
  /* resize() 는 두 축의 sizing 모드를 FIXED 로 되돌린다 — 이 되돌림이 없으면
     'HUG 를 먼저 걸면 반대 축 숫자 지정이 지운다' 는 결함이 하네스에서 안 보인다. */
  self.resize = (w, h) => {
    if (!(w > 0) || !(h > 0)) throw new Error('resize 인자가 0 이하 — ' + w + '×' + h);
    if (self.type === 'TEXT' && !loadedFonts.has(fontKey(self.fontName)))
      throw new Error('in resize: Cannot write to node with unloaded font "' + fontKey(self.fontName).replace('|', ' ') + '"');
    /* 제약이 SCALE 인 자식은 부모가 줄면 같이 준다 — createNodeFromSvg 로 받은
       아이콘을 작게 만들 때 실제 Figma 가 하는 일이다. 이걸 흉내 내지 않으면
       '아이콘이 프레임 밖으로 삐져나오는' 결함이 하네스에서 영원히 빨갛거나 영원히 초록이다. */
    const ow = self.width, oh = self.height;
    if ((!self.layoutMode || self.layoutMode === 'NONE') && ow > 0 && oh > 0 && (ow !== w || oh !== h)) {
      const sx = w / ow, sy = h / oh;
      for (const c of self.children) {
        const cn = c.constraints;
        if (!cn || cn.horizontal !== 'SCALE' || cn.vertical !== 'SCALE') continue;
        c.x = c.x * sx; c.y = c.y * sy;
        if (c.width > 0 && c.height > 0) c.resizeWithoutConstraints(c.width * sx, c.height * sy);
      }
    }
    self.width = w; self.height = h;
    self._hugW = false; self._hugH = false;
    if (self.layoutSizingHorizontal === 'HUG' || self.layoutSizingHorizontal === 'FILL') self.layoutSizingHorizontal = 'FIXED';
    if (self.layoutSizingVertical === 'HUG' || self.layoutSizingVertical === 'FILL') self.layoutSizingVertical = 'FIXED';
    touch(me());
  };
  self.resizeWithoutConstraints = (w, h) => { if (!(w > 0) || !(h > 0)) throw new Error('resizeWithoutConstraints 인자가 0 이하'); self.width = w; self.height = h; };
  self.findAll = (fn) => { const out = []; const w = (n) => n.children.forEach((c) => { if (fn(c)) out.push(c); w(c); }); w(self); return out; };
  self.findOne = (fn) => { const r = self.findAll(fn); return r.length ? r[0] : null; };
  /* 컴포넌트에서 인스턴스를 뜬다. 실제 Figma 는 깊은 사본을 주므로 여기서도 자식까지 베낀다 —
     얕게 주면 '인스턴스 안의 텍스트를 못 찾는' 결함이 하네스에서 통과해 버린다. */
  if (type === 'COMPONENT') {
    self.createInstance = () => {
      const clone = (src) => {
        const c = Node(src.type === 'COMPONENT' ? 'FRAME' : src.type, src.name);
        c.width = src.width; c.height = src.height;
        c.characters = src.characters; c.fontName = src.fontName;
        c.textStyleId = src.textStyleId;
        /* 실제 인스턴스는 원본의 오토레이아웃을 그대로 물려받는다. 여기서 안 베끼면
           인스턴스를 줄일 때 자식이 따라 줄지 않아 '밖으로 나갔다'는 가짜 빨강이 뜬다. */
        for (const k of ['layoutMode', 'layoutWrap', 'primaryAxisSizingMode', 'counterAxisSizingMode',
          'primaryAxisAlignItems', 'counterAxisAlignItems', 'itemSpacing',
          'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
          'layoutSizingHorizontal', 'layoutSizingVertical', 'constraints']) {
          if (src[k] !== undefined) { try { c[k] = src[k]; } catch (e) { /* 무시 */ } }
        }
        for (const k of src.children) c.appendChild(clone(k));
        return c;
      };
      const inst = clone(self);
      inst.type = 'INSTANCE';
      inst.mainComponent = me();
      return inst;
    };
  }
  self.setPluginData = (k, v) => { self._pd[k] = v; };
  self.getPluginData = (k) => self._pd[k] || '';
  self.setBoundVariable = (field, v) => {
    if (!v || !v.id) throw new Error('setBoundVariable 대상 없음');
    self._bound[field] = v.name; calls.bindNum.push(self.name + '.' + field + ' ← ' + v.name);
  };
  self.setTextStyleIdAsync = async (id) => {
    const f = textStyleFont.get(id);
    // 스타일을 걸면 노드의 폰트가 그 스타일의 폰트로 바뀐다 — 그것도 안 불러왔으면 던진다
    if (f && !loadedFonts.has(fontKey(f))) throw new Error('Cannot set text style with unloaded font "' + f.family + ' ' + f.style + '"');
    if (f) self.fontName = f;
    self.textStyleId = id; calls.textStyle.push(self.name + ' ← ' + id);
  };
  self.setEffectStyleIdAsync = async (id) => { self.effectStyleId = id; calls.effectStyle.push(self.name + ' ← ' + id); };
  Object.defineProperty(self, 'relativeTransform', { get: () => self._rt, set: (v) => { self._rt = v; }, enumerable: true, configurable: true });

  /* 실제 Figma 는 없는 속성·틀린 열거값·조건 안 맞는 FILL/HUG 에서 던진다.
     같은 자리에서 던져야 플러그인의 try/catch 가 진짜로 도는지 보인다. */
  /* manifest 가 documentAccess:"dynamic-page" 라, 안 연 페이지의 children 을 만지면 던진다.
     이 규칙이 없으면 하네스는 통과시키고 실제 Figma 만 터진다 — 실제로 그렇게 한 번 놓쳤다. */
  if (type === 'PAGE') {
    self._loaded = false;
    self.loadAsync = async () => { self._loaded = true; };
  }

  const own = new Set(PROPS[type] || []);
  const P = new Proxy(self, {
    get(t, k) {
      if (t.type === 'PAGE' && k === 'children' && !t._loaded)
        throw new Error('Cannot access children of a page that is not loaded. Please use "await page.loadAsync()".');
      return t[k];
    },
    set(t, k, v) {
      if (typeof k === 'string' && !FREE.has(k) && !own.has(k) && !(k in t))
        throw new Error('in set_' + k + ': no such property on ' + type);
      if (ENUM[k] && !ENUM[k].includes(v))
        throw new Error('in set_' + k + ': 잘못된 값 ' + JSON.stringify(v));
      if (k === 'constraints' && v && (!CONSTRAINT.includes(v.horizontal) || !CONSTRAINT.includes(v.vertical)))
        throw new Error('in set_constraints: 잘못된 값 ' + JSON.stringify(v));
      if (k === 'arcData' && v && !(typeof v.startingAngle === 'number' && typeof v.endingAngle === 'number'
        && typeof v.innerRadius === 'number' && v.innerRadius >= 0 && v.innerRadius <= 1))
        throw new Error('in set_arcData: 잘못된 값 ' + JSON.stringify(v));
      /* 폰트를 안 불러온 텍스트 노드는 글자뿐 아니라 '글자 모양에 영향을 주는 속성 전부'를 거절한다.
         characters 만 막아 뒀다가 실제 파일에서 set_textAutoResize 로 23 세트가 다 죽었다. */
      if (t.type === 'TEXT' && TEXT_WRITE.has(k) && !loadedFonts.has(fontKey(t.fontName)))
        throw new Error('in set_' + k + ': Cannot write to node with unloaded font "'
          + fontKey(t.fontName).replace('|', ' ') + '"');
      // minWidth 는 오토레이아웃 프레임과 그 직계 자식에만 통한다
      if (k === 'minWidth' || k === 'minHeight' || k === 'maxWidth' || k === 'maxHeight') {
        const parentAuto = t.parent && t.parent.layoutMode && t.parent.layoutMode !== 'NONE';
        const selfAuto = t.layoutMode && t.layoutMode !== 'NONE';
        if (v !== null && !selfAuto && !parentAuto)
          throw new Error('in set_' + k + ': node must be an auto-layout frame or a child of an auto-layout frame');
      }
      if (k === 'layoutSizingHorizontal' || k === 'layoutSizingVertical') {
        const parentAuto = t.parent && t.parent.layoutMode && t.parent.layoutMode !== 'NONE';
        const selfAuto = t.layoutMode && t.layoutMode !== 'NONE';
        if (!selfAuto && !parentAuto)
          throw new Error('in set_' + k + ': node must be an auto-layout frame or a child of an auto-layout frame');
        if (v === 'FILL' && (!parentAuto || t.layoutPositioning === 'ABSOLUTE'))
          throw new Error('in set_' + k + ': FILL can only be set on children of auto-layout frames');
        if (v === 'HUG' && !selfAuto && t.type !== 'TEXT')
          throw new Error('in set_' + k + ': HUG is only valid on auto-layout frames and text');
      }
      // WRAP 은 가로 오토레이아웃에서만 통한다
      if (k === 'layoutWrap' && v === 'WRAP' && t.layoutMode !== 'HORIZONTAL')
        throw new Error('in set_layoutWrap: WRAP is only valid on horizontal auto-layout frames');
      if ((k === 'primaryAxisSizingMode' || k === 'counterAxisSizingMode') && (!t.layoutMode || t.layoutMode === 'NONE'))
        throw new Error('in set_' + k + ': node must be an auto-layout frame');
      t[k] = v;
      // 크기 규칙을 내부 플래그로 옮긴다 — 이게 있어야 HUG 성장이 실제로 일어난다
      if (k === 'layoutSizingHorizontal') t._hugW = v === 'HUG';
      if (k === 'layoutSizingVertical') t._hugH = v === 'HUG';
      if (k === 'primaryAxisSizingMode') { if (t.layoutMode === 'VERTICAL') t._hugH = v === 'AUTO'; else t._hugW = v === 'AUTO'; }
      if (k === 'counterAxisSizingMode') { if (t.layoutMode === 'VERTICAL') t._hugW = v === 'AUTO'; else t._hugH = v === 'AUTO'; }
      if (RELAYOUT.has(k)) touch(t.__proxy || t);
      return true;
    }
  });
  self.__proxy = P;
  return P;
}

/* 페이로드의 변수 목록을 그대로 '이 파일에 이미 있는 변수'로 삼는다 —
   개명·분할 단계는 여기서 검사 대상이 아니고, 컴포넌트가 토큰을 찾는지만 본다. */
const colObjs = (PAYLOAD.collections || []).map((c, i) => ({
  id: 'col:' + i, name: c.name,
  modes: c.modes.map((m, j) => ({ modeId: 'mode:' + i + ':' + j, name: m }))
}));
const colIdByName = new Map(colObjs.map((c) => [c.name, c.id]));
const varObjs = (PAYLOAD.variables || []).map((v, i) => ({
  id: 'var:' + i, name: v.name, resolvedType: v.type,
  variableCollectionId: colIdByName.get(v.collection),
  scopes: [], valuesByMode: {}
}));

const textStyles = (PAYLOAD.styles.text || []).map((s, i) => ({ id: 'ts:' + i, name: s.name }));
(PAYLOAD.styles.text || []).forEach((s, i) => textStyleFont.set('ts:' + i, { family: s.fontFamily, style: s.fontStyle }));
const effectStyles = (PAYLOAD.styles.effect || []).map((s, i) => ({ id: 'es:' + i, name: s.name }));

/* 구 파일을 흉내 낸다 — 전용 페이지 밖에 같은 이름의 세트가 이미 있는 상황.
   손대지 않고 'elsewhere' 로만 보고해야 한다. */
const oldPage = Node('PAGE', '🧩 Components · Button');
oldPage.appendChild(Node('COMPONENT_SET', 'Button'));   // appendChild 는 내부 배열을 직접 만져 로드와 무관하다
const pages = [Node('PAGE', 'Page 1'), oldPage];
const figma = {
  showUI() {},
  closePlugin() {},
  root: { children: pages },
  currentPage: pages[0],
  createPage() { const p = Node('PAGE', 'Page'); p._loaded = true; pages.push(p); return p; },
  async setCurrentPageAsync(p) { figma.currentPage = p; },
  createFrame: () => Node('FRAME', 'Frame'),
  createComponent: () => Node('COMPONENT', 'Component'),
  createText: () => Node('TEXT', 'Text'),
  createRectangle: () => Node('RECTANGLE', 'Rectangle'),
  createEllipse: () => Node('ELLIPSE', 'Ellipse'),
  createNodeFromSvg(svg) {
    calls.svg.push(svg.length);
    const f = Node('FRAME', 'svg');
    /* 실제 Figma 는 viewBox 크기의 프레임을 주고 그 안에 그만한 벡터를 넣는다.
       하네스가 100×100 을 주면 '아이콘이 프레임 밖으로 삐져나오는' 결함이 안 보인다. */
    const vb = /viewBox="([\d.\-\s]+)"/.exec(svg);
    const p = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 24, 24];
    const w = p[2] || 24, h = p[3] || 24;
    f.width = w; f.height = h; f._hugW = false; f._hugH = false;
    const n = (svg.match(/<path|<circle|<rect|<line|<polyline/g) || []).length;
    for (let i = 0; i < n; i++) {
      const v = Node('RECTANGLE', 'Vector');
      v.width = w; v.height = h; v.x = 0; v.y = 0;
      f.appendChild(v);
    }
    return f;
  },
  combineAsVariants(nodes, parent) {
    if (!nodes.length) throw new Error('combineAsVariants 에 빈 배열');
    const names = nodes.map((n) => n.name);
    if (new Set(names).size !== names.length) throw new Error('변형 이름 중복');
    const set = Node('COMPONENT_SET', 'Set');
    /* 실제 Figma 는 변형의 상대 위치를 그대로 물려받는다 — 미리 격자로 펴 두지 않으면
       (0,0) 에 만들어 둔 변형이 세트 안에서도 그대로 겹친다. */
    for (const n of nodes) {
      /* 실제 Figma 는 'axis=Value, axis2=Value2' 이름에서 variantProperties 를 만든다.
         이게 없으면 화면 단계가 어떤 변형을 골랐는지 확인할 수 없다. */
      const vp = {};
      String(n.name).split(',').forEach((seg) => {
        const i = seg.indexOf('=');
        if (i > 0) vp[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
      });
      n.variantProperties = vp;
      set.appendChild(n);
    }
    parent.appendChild(set);
    return set;
  },
  async loadFontAsync(f) {
    if (!f || typeof f.family !== 'string') throw new Error('loadFontAsync 인자가 폰트가 아님');
    loadedFonts.add(fontKey(f));
  },
  async getLocalTextStylesAsync() { return textStyles; },
  async getLocalEffectStylesAsync() { return effectStyles; },
  variables: {
    async getLocalVariableCollectionsAsync() { return colObjs; },
    async getLocalVariablesAsync() { return varObjs; },
    setBoundVariableForPaint(paint, field, v) {
      if (!v || !v.id) throw new Error('setBoundVariableForPaint 대상 없음');
      calls.bindPaint.push(v.name);
      return Object.assign({}, paint, { boundVariables: { color: { type: 'VARIABLE_ALIAS', id: v.id, __label: v.name } } });
    },
    createVariableAlias: (v) => ({ type: 'VARIABLE_ALIAS', id: v.id }),
    /* 이펙트 색 바인딩 — 스타일은 모드를 모르지만 그 안의 색은 변수에 걸 수 있다.
       흉내 내지 않으면 이 경로가 하네스에서 통과하고 실제 Figma 에서만 터진다. */
    setBoundVariableForEffect(effect, field, v) {
      if (!effect || typeof effect !== 'object') throw new Error('setBoundVariableForEffect 인자가 이펙트가 아님');
      if (['color', 'radius', 'spread', 'offsetX', 'offsetY'].indexOf(field) < 0)
        throw new Error('setBoundVariableForEffect: 걸 수 없는 필드 ' + field);
      if (!v || !v.id) throw new Error('setBoundVariableForEffect 대상 없음');
      calls.effectBind.push(v.name + ' → ' + field);
      return Object.assign({}, effect, {
        boundVariables: Object.assign({}, effect.boundVariables,
          (function () { const o = {}; o[field] = { type: 'VARIABLE_ALIAS', id: v.id, __label: v.name }; return o; })())
      });
    }
  },
  ui: { postMessage() {}, set onmessage(_) {} }
};

const ctx = vm.createContext({ figma, __html__: '', console, Math, JSON, Object, Array, Set, Map, String, Number, isFinite, parseFloat, parseInt, Promise, Error });
vm.runInContext(CODE + '\n;globalThis.__applyComponents = applyComponents; globalThis.__dryRunComponents = dryRunComponents;'
  + ' globalThis.__applyScreens = applyScreens; globalThis.__dryRunScreens = dryRunScreens;'
  + ' globalThis.__applyStyles = applyStyles;', ctx, { filename: 'code.js' });

(async () => {
  const problems = [];
  const log = [];
  const plan = await ctx.__dryRunComponents(PAYLOAD);
  console.log('[dry-run] 세트 ' + plan.create.length + ' · 변형 ' + plan.totalVariants
    + ' · 없는 토큰 ' + plan.missingTokens.length + ' · 없는 스타일 ' + plan.missingStyles.length
    + ' · 다른 페이지 중복 ' + plan.elsewhere.length);
  if (plan.missingTokens.length) console.log('  없는 토큰: ' + plan.missingTokens.join(', '));
  if (plan.missingStyles.length) console.log('  없는 스타일: ' + plan.missingStyles.join(', '));

  /* 스타일 단계 — 컴포넌트가 텍스트·이펙트 스타일을 이름으로 찾으므로 먼저 돈다.
     이펙트 색 바인딩이 여기서만 일어나서, 안 태우면 그 경로가 통째로 안 검사된다. */
  const srep = await ctx.__applyStyles(PAYLOAD, (t, m) => log.push(t + ' | ' + m), problems);
  console.log('[styles] 텍스트 ' + srep.text + ' · 이펙트 ' + srep.effect + ' · 페인트 ' + srep.paint
    + ' · 개명 ' + srep.renamed + ' · 이펙트 색 바인딩 ' + calls.effectBind.length);
  {
    /* 겹 단위로 센다 — 스타일 단위로 세면 두 겹 중 한 겹만 걸려도 초록이 뜬다. */
    const want = (PAYLOAD.styles && PAYLOAD.styles.effect || [])
      .reduce((a, e) => a + (e.effects || []).filter((x) => x.colorToken).length, 0);
    if (want && calls.effectBind.length < want)
      console.log('이펙트 색을 변수에 못 건 겹 ' + (want - calls.effectBind.length) + '개 ← 문제');
    else if (want) console.log('이펙트 색 ' + want + '겹 전부 변수에 걸렸습니다');
    /* 겹이 통째로 사라지지 않았는지도 본다 — 두 겹짜리가 한 겹으로 나가면 그림자가 납작해진다. */
    const flat = (PAYLOAD.styles && PAYLOAD.styles.effect || []).filter((e) => (e.effects || []).length < 1);
    if (flat.length) console.log('겹이 없는 이펙트 ' + flat.length + '건 ← 문제');
  }

  const rep = await ctx.__applyComponents(PAYLOAD, (t, m) => log.push(t + ' | ' + m), problems);
  console.log('\n[apply] 세트 ' + rep.sets + ' · 변형 ' + rep.variants + ' · 실패 ' + rep.skipped);
  console.log('변수 바인딩 ' + calls.bindNum.length + ' · 색 바인딩 ' + calls.bindPaint.length
    + ' · 텍스트 스타일 ' + calls.textStyle.length + ' · 이펙트 스타일 ' + calls.effectStyle.length
    + ' · 아이콘 ' + calls.svg.length);
  /* 만들어진 것의 모양을 눈으로 확인한다 — 개수만 맞고 속은 비었을 수 있다 */
  const page = pages.find((p) => p.name === '[Freesm] Components');
  if (page) {
    /* 세트는 이제 페이지에 직접 놓이지 않고 세로 오토레이아웃 담는 프레임 안에 들어간다.
       여기를 안 고치면 검사가 빈 목록을 돌면서 전부 초록으로 나온다 — 예전에 그렇게 놓쳤다. */
    const holder = page.children.find((c) => c.type === 'FRAME' && c.name === '[Freesm] 컴포넌트 세트');
    if (!holder) console.log('\n담는 프레임 [Freesm] 컴포넌트 세트 가 없습니다 ← 문제');
    /* 프레임 안이든 페이지 바로 위든 가리지 않고 전부 모은다.
       담는 프레임만 들여다보면 세트가 엉뚱한 데 놓였을 때 검사가 빈 목록을 돌며 초록이 된다. */
    const inHolder = holder ? holder.children.filter((c) => c.type === 'COMPONENT_SET') : [];
    const onPage = page.children.filter((c) => c.type === 'COMPONENT_SET');
    const setList = inHolder.concat(onPage);
    console.log('\n담는 프레임 ' + (holder ? '있음 ' + Math.round(holder.width) + '×' + Math.round(holder.height)
      + ' [' + holder.layoutMode + ']' : '없음') + ' · 세트 ' + setList.length + '개'
      + (onPage.length ? ' (프레임 밖 ' + onPage.length + '개 ← 문제)' : ''));
    if (!setList.length) console.log('세트가 하나도 없습니다 ← 문제');
    const empty = [], odd = [];
    console.log('\n[세트]');
    for (const set of setList) {
      const vs = set.children;
      const nodes = vs.reduce((a, v) => a + 1 + v.findAll(() => true).length, 0);
      const depth = (n, d) => n.children.reduce((a, c) => Math.max(a, depth(c, d + 1)), d);
      console.log('  ' + set.name.padEnd(28) + ' 변형 ' + String(vs.length).padStart(3)
        + ' · 노드 ' + String(nodes).padStart(4) + ' · 깊이 ' + depth(set, 0));
      const wantsSlots = (PAYLOAD.componentBuilds.find((b) => b.name === set.name) || {}).slots;
      for (const v of vs) {
        if (!v.children.length && wantsSlots && wantsSlots.length) empty.push(set.name + ' / ' + v.name);
        if (!(v.width > 0) || !(v.height > 0)) odd.push(set.name + ' / ' + v.name + ' ' + v.width + '×' + v.height);
      }
    }
    if (empty.length) console.log('\n속이 빈 변형 ' + empty.length + '건\n  · ' + empty.slice(0, 12).join('\n  · '));
    if (odd.length) console.log('\n크기가 이상한 변형 ' + odd.length + '건\n  · ' + odd.slice(0, 12).join('\n  · '));
    if (!empty.length && !odd.length) console.log('\n빈 변형 없음 · 크기 이상 없음');

    /* combineAsVariants 는 변형을 (0,0) 에 겹쳐 둔다 — 격자로 폈는지 여기서 본다 */
    const piled = [], hits = [];
    for (const set of setList) {
      const vs = set.children;
      if (vs.length > 1 && vs.every((v) => v.x === 0 && v.y === 0)) { piled.push(set.name); continue; }
      for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i], b = vs[j];
        if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
          hits.push(set.name + ' / ' + a.name + ' ↔ ' + b.name);
      }
    }
    if (piled.length) console.log('\n변형이 겹쳐 쌓인 세트 ' + piled.length + '건\n  · ' + piled.join('\n  · '));
    if (hits.length) console.log('\n변형끼리 겹칩니다 ' + hits.length + '건\n  · ' + hits.slice(0, 8).join('\n  · '));
    if (!piled.length && !hits.length) console.log('변형 겹침 없음');

    /* 세트끼리 세로로 겹치지 않는지 — cursorY 계산이 맞는지 본다 */
    const sets = setList.slice().sort((a, b) => a.y - b.y);
    const overlapSets = [];
    for (let i = 1; i < sets.length; i++)
      if (sets[i].y < sets[i - 1].y + sets[i - 1].height
        && sets[i].x < sets[i - 1].x + sets[i - 1].width && sets[i - 1].x < sets[i].x + sets[i].width)
        overlapSets.push(sets[i - 1].name + ' ↔ ' + sets[i].name);
    if (overlapSets.length) console.log('\n세트끼리 겹칩니다 ' + overlapSets.length + '건\n  · ' + overlapSets.slice(0, 8).join('\n  · '));
    else console.log('세트 간격 이상 없음');

    const want = process.argv[4];
    if (want) {
      const set = setList.find((s) => s.name === want);
      if (!set) console.log('\n' + want + ' 세트가 없습니다');
      else {
        console.log('\n[' + want + '] 설명\n' + (set.description || '(없음)').split('\n').map((l) => '  ' + l).join('\n'));
        const v = set.children[0];
        const dump = (n, d) => {
          console.log('  '.repeat(d + 1) + n.type + ' ' + n.name + ' ' + Math.round(n.width) + '×' + Math.round(n.height)
            + (n.layoutMode && n.layoutMode !== 'NONE' ? ' [' + n.layoutMode + ']' : '')
            + (Object.keys(n._bound).length ? ' {' + Object.entries(n._bound).map(([k, val]) => k + '=' + val).join(' ') + '}' : '')
            + ((n.fills || []).some((f) => f.boundVariables) ? ' fill=' + n.fills.find((f) => f.boundVariables).boundVariables.color.__label : '')
            + (n.textStyleId ? ' ts=' + (textStyles.find((s) => s.id === n.textStyleId) || {}).name : '')
            + (n.effectStyleId ? ' es=' + (effectStyles.find((s) => s.id === n.effectStyleId) || {}).name : '')
            + (n.visible === false ? ' [숨김]' : '') + (n.characters ? ' “' + n.characters + '”' : ''));
          n.children.forEach((c) => dump(c, d + 1));
        };
        console.log('\n[' + want + '] 첫 변형 ' + v.name);
        dump(v, 0);
      }
    }
  } else console.log('\n[Freesm] Components 페이지가 안 만들어졌습니다 ← 문제');

  /* ───── 화면 단계 ─────
     컴포넌트 다음에 돌린다 — 화면 안의 인스턴스가 방금 만든 세트를 가리켜야 하기 때문이다.
     페이로드에 화면표가 없으면(= '토큰만') 조용히 건너뛴다. */
  if ((PAYLOAD.screenBuilds || []).length) {
    const sp = await ctx.__dryRunScreens(PAYLOAD);
    console.log('\n[dry-run 화면] 프레임 ' + sp.frames + ' · 노드 ' + sp.nodes
      + ' · 이미 있는 이름 ' + sp.prev.length + ' · 다른 페이지 중복 ' + sp.elsewhere.length);
    const srep = await ctx.__applyScreens(PAYLOAD, (t, m) => log.push(t + ' | ' + m), problems);
    console.log('[apply 화면] 프레임 ' + srep.frames + ' · 노드 ' + srep.nodes + ' · 글자 ' + srep.texts
      + ' · 아이콘 ' + srep.icons + ' · 인스턴스 ' + srep.instances
      + ' · 컴포넌트 못 찾음 ' + srep.instanceMiss
      + ' · 바인딩 ' + srep.bound + '/미바인딩 ' + srep.unbound + ' · 실패 ' + srep.failed);

    const spage = pages.find((p) => p.name === '[Freesm] Screens');
    if (!spage) console.log('[Freesm] Screens 페이지가 안 만들어졌습니다 ← 문제');
    else {
      const hold = spage.children.find((c) => c.name === '[Freesm] 화면');
      if (!hold) console.log('화면 담는 프레임이 없습니다 ← 문제');
      else {
        /* 페이지 위에 담는 프레임 밖으로 샌 화면이 있으면 겹침 방지가 깨진 것이다 */
        const loose = spage.children.filter((c) => c !== hold);
        if (loose.length) console.log('담는 프레임 밖 노드 ' + loose.length + '개 ← 문제');
        console.log('담는 프레임 ' + Math.round(hold.width) + '×' + Math.round(hold.height)
          + ' [' + hold.layoutMode + '] · 화면 ' + hold.children.length + '개');

        /* ① 만든 것이 페이로드가 말한 크기와 같은가 — 여기가 어긋나면 Figma 에서 화면이 찌그러진다 */
        const geo = [];
        for (const b of (PAYLOAD.screenBuilds || [])) {
          const nm = b.root && b.root.name ? b.root.name : (b.screen + ' · ' + b.mode);
          const f = hold.children.find((c) => c.name === nm);
          if (!f) { geo.push(nm + ' — 프레임이 없습니다'); continue; }
          if (Math.abs(f.width - b.root.w) > 1.5 || Math.abs(f.height - b.root.h) > 1.5)
            geo.push(nm + ' — 잰 값 ' + Math.round(b.root.w) + '×' + Math.round(b.root.h)
              + ' 인데 만들어진 것은 ' + Math.round(f.width) + '×' + Math.round(f.height));
        }
        if (geo.length) console.log('\n화면 크기가 어긋납니다 ' + geo.length + '건\n  · ' + geo.slice(0, 8).join('\n  · '));
        else console.log('화면 크기 이상 없음');

        /* ② 절대배치 자식이 부모 밖으로 나갔는가 */
        /* ★ 핵심 검사 — 오토레이아웃이 다시 깐 자리가 브라우저에서 잰 자리(_x·_y)와 같은가.
           데모는 '검산을 통과한 자리에만 오토레이아웃을 건다'고 약속했다. 그 약속이
           지켜졌는지 확인하는 유일한 방법은 만들어진 노드의 좌표를 되재 보는 것이다. */
        const drift = [];
        const cmp = (spec, node, path) => {
          if (!spec || !node) return;
          if (spec._x != null && (Math.abs(node.x - spec._x) > 1.5 || Math.abs(node.y - spec._y) > 1.5))
            drift.push(path + ' — 잰 자리 (' + Math.round(spec._x) + ',' + Math.round(spec._y)
              + ') vs 만든 자리 (' + Math.round(node.x) + ',' + Math.round(node.y) + ')');
          const ks = spec.kids || [];
          for (let i = 0; i < ks.length && i < node.children.length; i++)
            cmp(ks[i], node.children[i], path + '/' + (ks[i].name || '?'));
        };
        for (const b of (PAYLOAD.screenBuilds || [])) {
          const nm = b.root && b.root.name ? b.root.name : (b.screen + ' · ' + b.mode);
          const f = hold.children.find((c) => c.name === nm);
          if (f) cmp(b.root, f, nm);
        }
        if (drift.length) console.log('\n오토레이아웃이 자리를 옮겼습니다 ' + drift.length + '건 ← 문제\n  · '
          + drift.slice(0, 8).join('\n  · '));
        else console.log('오토레이아웃 자리 어긋남 없음');

        const oob = [], spill = [];
        const scan = (n, d) => {
          if (n.layoutMode === 'NONE' || !n.layoutMode) {
            for (const c of n.children) {
              if (!(c.x < -1.5 || c.y < -1.5 || c.x + c.width > n.width + 1.5 || c.y + c.height > n.height + 1.5)) continue;
              /* 자르는 부모(clipsContent)에서 넘치면 잘려 보이므로 결함이다.
                 안 자르는 부모는 CSS 의 overflow:visible 자리라 원래 넘친다 — 참고로만 센다. */
              (n.clipsContent ? oob : spill).push(n.name + ' / ' + c.name);
            }
          }
          if (d < 30) n.children.forEach((c) => scan(c, d + 1));
        };
        hold.children.forEach((c) => scan(c, 0));
        /* 이건 내보내기의 결함이 아니라 데모의 결함이다 — 브라우저에서도 이미 잘려 보인다.
           Figma 로 옮기면 그 잘림이 그대로 따라가므로 여기서 이름을 붙여 둔다. */
        if (oob.length) console.log('브라우저에서도 잘려 보이는 자리 ' + oob.length + '건 ← 데모 CSS 결함\n  · '
          + [...new Set(oob)].slice(0, 8).join('\n  · '));
        else console.log('잘려 보일 노드 없음' + (spill.length ? ' (안 자르는 부모를 넘친 자리 ' + spill.length + '건 — CSS overflow:visible 자리)' : ''));

        /* ③a 화면 바닥 — 루트 프레임에 채우기가 없으면 Figma 에서 화면이 통째로 투명해진다.
           브라우저에서는 .page 바깥 상자(.frame)가 흰 바닥을 내주지만 Figma 에는 그 상자가 없다. */
        const noFill = [];
        for (const c of hold.children) {
          const f = c.fills;
          if (!f || !f.length || !f.some((x) => x.visible !== false)) noFill.push(c.name);
        }
        if (noFill.length) console.log('바닥색 없는 화면 ' + noFill.length + '건 ← 문제\n  · '
          + noFill.slice(0, 6).join('\n  · '));
        else console.log('화면 바닥색 이상 없음');

        /* ③b 아이콘 — createNodeFromSvg 로 받은 프레임을 줄일 때 안의 벡터가 같이 줄었는가.
           제약을 SCALE 로 바꾸지 않으면 16px 프레임이 24px 그림을 물고 있게 된다. */
        const badIcon = [];
        const iconScan = (n) => {
          if (/^icon[-/]/.test(n.name) || n.name === 'svg') {
            for (const c of n.children)
              if (c.width > n.width + 0.5 || c.height > n.height + 0.5)
                badIcon.push(n.name + ' ' + Math.round(n.width) + '×' + Math.round(n.height)
                  + ' 안에 ' + Math.round(c.width) + '×' + Math.round(c.height));
          }
          n.children.forEach(iconScan);
        };
        hold.children.forEach(iconScan);
        if (badIcon.length) console.log('그림이 프레임보다 큰 아이콘 ' + badIcon.length + '건 ← 문제\n  · '
          + [...new Set(badIcon)].slice(0, 6).join('\n  · '));
        else console.log('아이콘 크기 이상 없음');

        /* ③ 빈 화면 — 노드가 한 줌뿐이면 훑기가 실패한 것이다 */
        const thin = hold.children.filter((c) => c.findAll(() => true).length < 20);
        if (thin.length) console.log('내용이 거의 없는 화면 ' + thin.length + '건\n  · '
          + thin.map((c) => c.name + ' (' + c.findAll(() => true).length + '노드)').join('\n  · '));
        else console.log('빈 화면 없음');

        /* ④ 인스턴스가 실제로 컴포넌트를 가리키는가 */
        const inst = [];
        hold.children.forEach((c) => c.findAll((n) => n.type === 'INSTANCE').forEach((n) => inst.push(n)));
        const orphanInst = inst.filter((n) => !n.mainComponent);
        console.log('인스턴스 ' + inst.length + '개' + (orphanInst.length ? ' · 원본 없는 인스턴스 ' + orphanInst.length + ' ← 문제' : ' · 전부 원본 있음'));
        const ph = [];
        hold.children.forEach((c) => c.findAll((n) => /컴포넌트 없음\)$/.test(n.name)).forEach((n) => ph.push(n.name)));
        if (ph.length) console.log('컴포넌트를 못 찾아 빈 프레임으로 대체한 자리 ' + ph.length + '건 ← 문제');
      }
    }
  } else console.log('\n화면표 없음 — 화면 단계는 건너뜁니다 (토큰만 페이로드)');

  if (problems.length) {
    const uniq = [...new Set(problems)];
    console.log('\n문제 ' + problems.length + '건 (중복 제거 ' + uniq.length + ')');
    uniq.slice(0, 40).forEach((p) => console.log('  · ' + p));
  } else console.log('\n문제 없음');
  const err = log.filter((l) => l.startsWith('err'));
  if (err.length) { console.log('\n실패 로그'); [...new Set(err)].slice(0, 20).forEach((l) => console.log('  · ' + l)); }
})().catch((e) => { console.error('\n헛돌리기 자체가 터졌습니다:\n' + e.stack); process.exit(1); });
