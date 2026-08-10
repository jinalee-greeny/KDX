/* ───────────────── 데모의 :root 색 블록을 tokens.json 에서 생성한다 ─────────────────
 *
 * v0.86 에서 데모의 색을 토큰 값으로 맞추면서 "이 파일은 옮겨 적는 곳" 이라고 적어 두었다.
 * 그런데 옮겨 적는 일을 사람이 하면 언젠가 반드시 어긋난다 — Dark 모드가 붙으면서
 * 옮겨 적을 값이 두 배가 되었으니 더 그렇다. 그래서 옮겨 적는 일 자체를 기계에게 넘긴다.
 *
 * 사용:
 *   node figma/gen-democss.js            → 표준출력으로 두 블록을 낸다
 *   node figma/gen-democss.js --check    → demo/index.html 안의 블록과 대조한다(다르면 exit 1)
 *   node figma/gen-democss.js --write    → demo/index.html 안의 블록을 갈아 끼운다
 *
 * 블록은 demo/index.html 안에서 아래 표식 사이에 산다. 표식은 지우지 말 것.
 *   /* DEMOCSS-COLORS-BEGIN * /   …   /* DEMOCSS-COLORS-END * /
 */
'use strict';
const fs = require('fs');
const path = require('path');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tokens', 'tokens.json'), 'utf8'));
const SC = T.scale.color;
const SEM = T.semantic.color;

/* 브랜드 램프는 데모가 [data-brand] 에서 따로 갈아 끼운다. 여기서는 CSS 변수로 넘긴다. */
const BRANDVAR = { 'color/primary': '--brand-p' };
function refToCss(ref) {
  if (!ref) return null;
  const m = /^color\/primary\/([0-9a-z]+)$/.exec(ref);
  if (m) return 'var(--brand-p' + m[1] + ')';
  const hex = SC[ref];
  return hex ? String(hex) : null;
}
function tokenCss(name, mode) {
  const d = SEM[name];
  if (!d) throw new Error('없는 시맨틱 토큰: ' + name);
  const ref = (mode === 'dark' && d.dark) ? d.dark : d.alias;
  const out = refToCss(ref);
  if (!out) throw new Error('원시값을 못 찾음: ' + name + ' → ' + ref);
  return { css: out, ref: ref };
}

/* 데모의 CSS 변수 ↔ 토큰. 토큰이 없는 자리는 why 에 이유를 적는다 —
   빈칸을 조용히 두면 다음 사람이 "왜 여기만 손으로 썼지" 를 다시 조사한다. */
const MAP = [
  ['--bg',                  'bg/default'],
  ['--bg-sunken',           'bg/sunken'],
  ['--bg-canvas',           null, { light: '#edeef0', dark: '#000000' }, '워크벤치 크롬 — .page 밖이라 토큰 대상이 아니다'],
  ['--fg',                  'fg/default'],
  ['--fg-sub',              'fg/subtle'],
  ['--fg-mut',              'fg/subtler'],
  ['--fg-inverse',          'fg/inverse/default'],
  ['--line',                'comp/bdr/subtlest'],
  ['--line-2',              'comp/bdr/subtler'],
  ['--st-success',          'status/fg/success'],
  ['--st-success-bg',       'status/bg/success'],
  ['--st-warning',          'status/fg/warning'],
  ['--st-warning-bg',       'status/bg/warning'],
  ['--st-critical',         'status/fg/error'],
  ['--st-critical-bg',      'status/bg/error'],
  ['--st-critical-strong',  null, { light: SC['color/red/30'], dark: SC['color/red/80'] }, '더 진한 단계 — 전용 토큰 없음'],
  ['--comp-disabled-fill',  'comp/fill/neutral/disabled'],
  ['--comp-disabled-fg',    'comp/fg/disabled'],
  ['--comp-disabled-bdr',   'comp/bdr/disabled'],
  ['--comp-track',          'comp/fill/track'],
  ['--up',                  'chart/status/fg/up'],
  ['--down',                'chart/status/fg/down'],
  ['--flat',                'chart/status/fg/flat']
];

/* 그림자도 이제 tokens.json 이 정한다. 겹 목록과 기하는 effect.elevation 이,
   색은 겹마다 달린 comp/shadow/* 토큰이 들고 있다.
   여기 남은 일은 CSS 문법으로 옮겨 적는 것뿐 — 손으로 고른 숫자는 하나도 없다. */
function shadowLines(mode) {
  const L = [];
  L.push('  --elev-0:none;');
  for (const [name, def] of Object.entries(T.effect.elevation)) {
    const layers = Array.isArray(def) ? def : [def];
    const parts = [], refs = [];
    for (const layer of layers) {
      const isObj = layer && typeof layer === 'object';
      const geom = isObj ? layer.shadow : String(layer).replace(/\s*rgba?\([^)]*\)\s*/, '');
      const tokenName = isObj ? layer.color : null;
      if (!tokenName) { parts.push(geom); continue; }
      const r = tokenCss(tokenName, mode);
      parts.push(geom + ' ' + r.css);
      refs.push(tokenName.replace('comp/shadow/', '') + '←' + r.ref.replace('color/alpha/black/', 'black ') + '%');
    }
    /* 데모가 쓰는 이름은 --elev-up 이다(토큰은 elevation/upper). 한 글자 차이로 조용히
       안 걸리는 자리를 만들지 않도록 여기서 이름을 맞춘다. */
    const key = name.replace('elevation/', '').replace(/^upper$/, 'up');
    L.push('  --elev-' + key + ':' + parts.join(',') + ';  /* ' + refs.join(' + ') + ' */');
  }
  return L;
}

function block(mode) {
  const sel = mode === 'light' ? ':root' : 'html[data-theme="dark"]';
  const L = [];
  L.push(sel + '{');
  const pad = (s, n) => (s + ' '.repeat(Math.max(0, n - s.length)));
  for (const [name, token, manual, why] of MAP) {
    if (token) {
      const r = tokenCss(token, mode);
      L.push('  ' + pad(name + ':' + r.css + ';', 34) + '/* ' + token + ' ← ' + r.ref + ' */');
    } else {
      L.push('  ' + pad(name + ':' + manual[mode] + ';', 34) + '/* ' + why + ' */');
    }
  }
  for (const l of shadowLines(mode)) L.push(l);
  L.push('  --sh-1:var(--elev-1); --sh-2:var(--elev-2); --sh-frame:var(--elev-4);');
  if (mode === 'dark') {
    L.push('  /* 브랜드 파생 — 라이트는 [data-brand] 가 들고 있고 여기서 다크만 덮어쓴다 */');
    for (const l of brandDarkLines()) L.push(l);
  }
  if (mode === 'light') {
    L.push('  /* 컴포넌트 지오메트리 — 색이 아니라 이 생성기의 대상이 아니다 */');
    L.push('  --pad-btn-x:20px; --pad-btn-y:12px; --pad-fld-x:16px; --pad-fld-y:12px; --pad-card:24px;');
    L.push('  --gap-comp-sm:8px; --gap-comp-md:12px;');
    L.push('  --touch-min:48px; --bw-comp:1px; --ring-w:3px;');
  }
  L.push('}');
  return L.join('\n');
}

/* 브랜드에서 파생되는 시맨틱은 모드에 따라 램프 스톱이 달라진다.
   라이트 값은 데모의 [data-brand] 블록이 이미 들고 있으므로 다크만 덮어쓴다.
   data-brand 와 data-theme 은 둘 다 <html> 에 붙으므로 같은 요소를 가리키고,
   html[data-theme="dark"] 쪽이 명시도가 높아 이긴다. */
const BRANDMAP = [
  ['--accent',           'comp/fill/accent/primary'],
  ['--accent-subtle',    'bg/accent/subtle'],
  ['--accent-line',      'comp/bdr/focused'],
  ['--on-accent-subtle', 'comp/fg/on-accent/secondary'],
  ['--accent-strong',    null, 'var(--brand-p40)', '누르기 전 강조 — 다크에서는 밝은 쪽으로'],
  ['--accent-press',     null, 'var(--brand-p30)', '누른 상태 — 한 단계 더 밝게']
];
function brandDarkLines() {
  const L = [];
  for (const [name, token, manual, why] of BRANDMAP) {
    if (token) { const r = tokenCss(token, 'dark'); L.push('  ' + name + ':' + r.css + ';  /* ' + token + ' ← ' + r.ref + ' */'); }
    else L.push('  ' + name + ':' + manual + ';  /* ' + why + ' */');
  }
  return L;
}

const OUT = [
  '/* DEMOCSS-COLORS-BEGIN — 이 블록은 node figma/gen-democss.js --write 가 만든다. 손으로 고치지 말 것. */',
  '/* 값의 출처는 전부 tokens/tokens.json 이다. 바꿀 일이 있으면 거기를 고치고 다시 생성한다. */',
  block('light'),
  block('dark'),
  '/* DEMOCSS-COLORS-END */'
].join('\n');

const DEMO = path.join(__dirname, '..', 'demo', 'index.html');
const BEGIN = '/* DEMOCSS-COLORS-BEGIN';
const END = '/* DEMOCSS-COLORS-END */';

if (process.argv.includes('--check') || process.argv.includes('--write')) {
  const html = fs.readFileSync(DEMO, 'utf8');
  const i = html.indexOf(BEGIN), j = html.indexOf(END);
  if (i < 0 || j < 0) {
    console.error('데모에서 DEMOCSS-COLORS 표식을 찾지 못했습니다 — 먼저 블록을 심어야 합니다.');
    process.exit(2);
  }
  const cur = html.slice(i, j + END.length);
  if (process.argv.includes('--check')) {
    if (cur === OUT) { console.log('데모의 색 블록이 tokens.json 과 같습니다.'); process.exit(0); }
    console.error('데모의 색 블록이 tokens.json 과 다릅니다 — node figma/gen-democss.js --write 로 다시 만드세요.');
    const a = cur.split('\n'), b = OUT.split('\n');
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      if (a[k] !== b[k]) { console.error('  줄 ' + (k + 1) + '\n    데모: ' + (a[k] || '(없음)') + '\n    생성: ' + (b[k] || '(없음)')); }
    }
    process.exit(1);
  }
  fs.writeFileSync(DEMO, html.slice(0, i) + OUT + html.slice(j + END.length));
  console.log('데모의 색 블록을 다시 만들었습니다 — ' + OUT.split('\n').length + '줄');
} else {
  console.log(OUT);
}
