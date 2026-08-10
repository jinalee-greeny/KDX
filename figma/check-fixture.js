/* fixture 가 실제 파일과 같은지 본다.
 *
 * check-reconcile.js 는 fixture 를 '실제 파일' 이라고 믿고 예측한다. fixture 가 낡으면
 * 그 예측은 초록이지만 아무것도 증명하지 않는다. 그래서 파일에서 뽑은 요약(digest)을
 * 여기에 붙여 넣고 대조한다.
 *
 * 사용:  node figma/check-fixture.js <digest.json> [fixture]
 *
 * digest.json 은 대상 파일에서 아래를 읽어 얻는다(읽기만 한다).
 * 결과 JSON 을 그대로 파일로 저장해 인자로 넘긴다.
 *
 *   const cols = await figma.variables.getLocalVariableCollectionsAsync();
 *   const vars = await figma.variables.getLocalVariablesAsync();
 *   const h = (s) => { let a = 5381; for (let i = 0; i < s.length; i++) a = ((a * 33) ^ s.charCodeAt(i)) >>> 0; return a.toString(16); };
 *   return { digest: cols.map(c => ({
 *     name: c.name,
 *     modes: c.modes.map(m => m.name).join(','),
 *     defaultMode: (c.modes.find(m => m.modeId === c.defaultModeId) || {}).name,
 *     count: vars.filter(v => v.variableCollectionId === c.id).length,
 *     hash: h(vars.filter(v => v.variableCollectionId === c.id).map(v => v.name + '|' + v.resolvedType).sort().join('\n'))
 *   })) };
 *
 * digest 는 저장소에 두지 않는다 — fixture 를 fixture 로 대조하면 아무것도 증명하지 못한다.
 * 붙이기 직전에 파일에서 새로 읽는 것이 요점이다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const D = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const FX = JSON.parse(fs.readFileSync(process.argv[3] || path.join(__dirname, 'fixtures', 'file-7col.json'), 'utf8'));

const h = (s) => { let a = 5381; for (let i = 0; i < s.length; i++) a = ((a * 33) ^ s.charCodeAt(i)) >>> 0; return a.toString(16); };
const live = new Map((D.digest || D).map((c) => [c.name, c]));
const fail = [];

for (const c of FX.collections) {
  const l = live.get(c.name);
  if (!l) { fail.push('fixture 의 ' + c.name + ' 이 파일에 없습니다.'); continue; }
  if (l.modes !== c.modes.join(',')) fail.push(c.name + ' 모드 — 파일 ' + l.modes + ' · fixture ' + c.modes.join(','));
  if (l.defaultMode !== c.defaultMode) fail.push(c.name + ' 기본 모드 — 파일 ' + l.defaultMode + ' · fixture ' + c.defaultMode);
  if (l.count !== c.variables.length) fail.push(c.name + ' 개수 — 파일 ' + l.count + ' · fixture ' + c.variables.length);
  const hx = h(c.variables.slice().sort().join('\n'));
  if (l.hash !== hx) fail.push(c.name + ' 변수 목록이 다릅니다 — 파일 ' + l.hash + ' · fixture ' + hx);
  live.delete(c.name);
}
for (const [n] of live) fail.push('파일에 있는데 fixture 에 없는 컬렉션 — ' + n);

console.log('컬렉션 ' + FX.collections.length + '개 대조');
if (fail.length) { console.log('\n문제 ' + fail.length + '건'); fail.forEach((f) => console.log('  · ' + f)); process.exitCode = 1; }
else console.log('fixture 가 파일과 같습니다 — check-reconcile 의 예측을 이 파일에 그대로 읽어도 됩니다.');
