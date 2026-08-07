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

/* 그림자 — 어두운 바닥에서는 같은 알파로는 안 보인다.
   색 자체는 이제 토큰이다(comp/shadow/{default,subtle}, Light 10%·5% → Dark 50%·40%).
   그런데 데모의 그림자는 두 겹이고 겹마다 알파가 다른 반면 effect/elevation 토큰은 한 겹이라,
   두 값을 그대로 잇지 못한다. ★ 남은 정리: 토큰의 elevation 을 두 겹으로 넓히거나
   데모를 한 겹으로 줄여 한쪽에 맞춰야 한다. 그때까지는 이 표가 데모 쪽 정본이다. */
const SHADOW = {
  light: [
    ['--elev-1', '0 1px 2px rgba(14,15,16,.04),0 1px 3px rgba(14,15,16,.06)', '카드 rest'],
    ['--elev-2', '0 4px 10px rgba(14,15,16,.06),0 2px 5px rgba(14,15,16,.05)', '카드 hover'],
    ['--elev-3', '0 8px 24px rgba(14,15,16,.10),0 3px 8px rgba(14,15,16,.06)', '드롭다운·팝오버'],
    ['--elev-4', '0 20px 48px rgba(14,15,16,.16),0 8px 18px rgba(14,15,16,.08)', '모달·다이얼로그'],
    ['--elev-up', '0 -8px 24px rgba(14,15,16,.08)', '바텀시트·스티키']
  ],
  dark: [
    ['--elev-1', '0 1px 2px rgba(0,0,0,.30),0 1px 3px rgba(0,0,0,.40)', '카드 rest'],
    ['--elev-2', '0 4px 10px rgba(0,0,0,.40),0 2px 5px rgba(0,0,0,.34)', '카드 hover'],
    ['--elev-3', '0 8px 24px rgba(0,0,0,.52),0 3px 8px rgba(0,0,0,.40)', '드롭다운·팝오버'],
    ['--elev-4', '0 20px 48px rgba(0,0,0,.64),0 8px 18px rgba(0,0,0,.48)', '모달·다이얼로그'],
    ['--elev-up', '0 -8px 24px rgba(0,0,0,.44)', '바텀시트·스티키']
  ]
};

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
  L.push('  --elev-0:none;');
  for (const [n, v, why] of SHADOW[mode]) L.push('  ' + n + ':' + v + ';  /* ' + why + ' */');
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
