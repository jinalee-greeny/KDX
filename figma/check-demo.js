/* 데모의 정적 마크업 구조 검사 — demo/index.html 하나만 읽는다.
 *
 * 왜 필요한가: 좌측 패널을 접으면 다시 못 여는 버그가 있었다. 원인은 CSS 도 JS 도 아니고
 * `.lib-body` 를 닫는 `</div>` 하나가 빠진 것이었다. 브라우저가 `</aside>` 에서 알아서
 * 닫아 주는 바람에 '펼치기' 버튼(.lib-expand)이 `.lib-body` 안으로 빨려 들어갔고,
 * 접었을 때 `.library.collapsed .lib-body{display:none}` 이 부모째 숨겨 버튼이 0×0 이 됐다.
 * 화면은 멀쩡해 보였고 콘솔도 조용했다 — 눈으로도 하네스로도 안 잡히던 종류다.
 *
 * 그래서 '닫는 태그가 빠졌다'를 마크업 단계에서 잡는다.
 * 데모는 JS 안에서도 HTML 문자열을 만들기 때문에 전체를 세면 소용이 없다.
 * 여기서는 <body> 부터 첫 <script> 까지의 **손으로 쓴 구간**만 본다.
 *
 * 사용: node figma/check-demo.js [demo/index.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'demo', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

const fail = [];
const F = (m) => fail.push(m);

/* ---- 손으로 쓴 구간만 잘라 낸다 ---- */
const bodyAt = html.indexOf('<body');
const scriptAt = html.indexOf('<script>', bodyAt);
if (bodyAt < 0 || scriptAt < 0) { console.error('<body> 나 <script> 를 찾지 못했습니다.'); process.exit(2); }
const STATIC = html.slice(bodyAt, scriptAt);

/* 주석과 <svg> 정의 블록은 세지 않는다 — 주석 안의 태그는 마크업이 아니고,
   스프라이트는 div 를 쓰지 않는다. */
const clean = STATIC.replace(/<!--[\s\S]*?-->/g, '');

/* ---- 1) div 균형 ---- */
const opens = (clean.match(/<div\b/g) || []).length;
const closes = (clean.match(/<\/div>/g) || []).length;
if (opens !== closes) F('정적 마크업의 <div> 가 안 맞습니다 — 여는 것 ' + opens + ' · 닫는 것 ' + closes
  + ' (차이 ' + (opens - closes) + '). 브라우저는 조용히 대신 닫아 주고, 그 순간 형제였던 요소가 자식이 됩니다.');

/* ---- 2) 블록 하나하나의 균형 ----
   전체 합이 맞아도 한쪽에서 덜 닫고 다른 쪽에서 더 닫으면 상쇄된다. */
const BLOCKS = [
  ['aside.library', /<aside class="library"[^>]*>/, '</aside>'],
  ['aside.inspector', /<aside class="inspector"[^>]*>/, '</aside>'],
  ['header', /<header[^>]*>/, '</header>'],
  ['main.canvas', /<main class="canvas"[^>]*>/, '</main>']
];
for (const [name, openRe, closeTag] of BLOCKS) {
  const m = openRe.exec(clean);
  if (!m) { F(name + ' 블록을 찾지 못했습니다.'); continue; }
  const from = m.index + m[0].length;
  const to = clean.indexOf(closeTag, from);
  if (to < 0) { F(name + ' 의 ' + closeTag + ' 를 찾지 못했습니다.'); continue; }
  const seg = clean.slice(from, to);
  const o = (seg.match(/<div\b/g) || []).length, c = (seg.match(/<\/div>/g) || []).length;
  if (o !== c) F(name + ' 안의 <div> 가 안 맞습니다 — 여는 것 ' + o + ' · 닫는 것 ' + c + ' (차이 ' + (o - c) + ')');
}

/* ---- 3) 접었다 펴는 자리 ----
   '펼치기' 버튼은 접혔을 때 숨는 상자(.lib-body) 밖에 있어야 한다.
   안에 있으면 접는 순간 같이 숨어 되돌릴 길이 사라진다. */
{
  const m = /<aside class="library"[^>]*>/.exec(clean);
  if (m) {
    const seg = clean.slice(m.index, clean.indexOf('</aside>', m.index));
    const bodyAt2 = seg.indexOf('class="lib-body');
    const expandAt = seg.indexOf('class="lib-expand"');
    if (expandAt < 0) F('.lib-expand(펼치기 버튼)이 없습니다 — 접으면 되돌릴 길이 없어집니다.');
    else if (bodyAt2 >= 0) {
      /* .lib-body 가 열린 뒤 .lib-expand 앞까지의 div 균형이 0 이어야 형제다. */
      const between = seg.slice(bodyAt2, expandAt);
      const o = (between.match(/<div\b/g) || []).length, c = (between.match(/<\/div>/g) || []).length;
      if (o !== c) F('.lib-expand 가 .lib-body 안에 들어가 있습니다 (깊이 ' + (o - c) + ') — '
        + '접으면 .library.collapsed .lib-body{display:none} 에 같이 숨어 다시 열 수 없습니다.');
    }
  }
}

/* ---- 4) id 중복 ---- */
{
  const ids = (clean.match(/\sid="([^"]+)"/g) || []).map((s) => s.slice(5, -1));
  const seen = new Set(), dup = new Set();
  for (const i of ids) { if (seen.has(i)) dup.add(i); else seen.add(i); }
  if (dup.size) F('id 가 겹칩니다 — ' + [...dup].join(', ') + ' (getElementById 는 첫 번째만 집습니다)');
}

console.log('정적 마크업 <div> ' + opens + '쌍 · id ' + ((clean.match(/\sid="/g) || []).length) + '개 검사');
if (fail.length) {
  console.log('\n문제 ' + fail.length + '건');
  fail.forEach((f) => console.log('  · ' + f));
  process.exitCode = 1;
} else {
  console.log('구조 이상 없음');
}
