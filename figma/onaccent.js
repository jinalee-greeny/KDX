/* 강조 채움 위에 올라가는 글자색을 "측정해서" 고른다.
 *
 * 왜 필요한가: --on-accent 가 #fff 로 못 박혀 있으면, 에메랄드처럼 밝은 브랜드가
 * 들어오는 순간 흰 글자가 4.33:1 로 떨어진다. 브랜드가 바뀔 때 같이 움직여야 하는
 * 것은 채움만이 아니라 그 위의 글자다.
 *
 * 규칙(브라우저와 노드가 글자 하나까지 같아야 한다 — check-brand.js 가 대조한다)
 *   1) 후보를 순서대로 배경에 대고 재서, min 을 처음 넘기는 것이 이긴다.
 *   2) 아무 후보도 못 넘기면 그때만 채움 자체를 한 스톱씩 어둡게 하며 1)을 다시 한다.
 *   3) 그래도 못 넘기면 가장 높은 비율을 쓰고 short=true 로 표시한다(조용히 넘어가지 않는다).
 *
 * 이 파일은 demo/index.html 안에 같은 내용이 복사되어 있다.
 * 표식: ONACCENT-SHARED-BEGIN / ONACCENT-SHARED-END
 */
'use strict';

/* ONACCENT-SHARED-BEGIN */
function oaHex(h) {
  var s = String(h).trim().replace(/^#/, '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length === 6) s += 'ff';
  if (s.length !== 8) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
    a: parseInt(s.slice(6, 8), 16) / 255
  };
}
function oaOver(fg, bg) {
  if (!fg) return null;
  if (fg.a >= 1 || !bg) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  };
}
function oaLum(c) {
  var f = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function oaRatio(a, b) {
  var l1 = oaLum(a), l2 = oaLum(b);
  if (l1 < l2) { var t = l1; l1 = l2; l2 = t; }
  return (l1 + 0.05) / (l2 + 0.05);
}
/* 배경/후보는 모두 hex 문자열. page 는 알파를 깔 바탕(기본 흰색).
 * fillSteps 는 "후보로 안 되면 채움을 이렇게 바꿔본다" 의 hex 목록(없으면 []). */
function pickOnAccent(backdrop, candidates, min, fillSteps, page) {
  var bgPage = oaHex(page || '#ffffff');
  var flat = function (h) { return oaOver(oaHex(h), bgPage); };
  var base = flat(backdrop);
  var cands = candidates.map(flat);
  var i, r;
  for (i = 0; i < cands.length; i++) {
    if (!cands[i] || !base) continue;
    r = oaRatio(cands[i], base);
    if (r >= min) return { fg: i, fill: -1, ratio: r, backdrop: backdrop, short: false };
  }
  var steps = fillSteps || [];
  for (var f = 0; f < steps.length; f++) {
    var b2 = flat(steps[f]);
    for (i = 0; i < cands.length; i++) {
      if (!cands[i] || !b2) continue;
      r = oaRatio(cands[i], b2);
      if (r >= min) return { fg: i, fill: f, ratio: r, backdrop: steps[f], short: false };
    }
  }
  var best = { fg: 0, fill: -1, ratio: -1, backdrop: backdrop, short: true };
  for (i = 0; i < cands.length; i++) {
    if (!cands[i] || !base) continue;
    r = oaRatio(cands[i], base);
    if (r > best.ratio) { best.fg = i; best.ratio = r; }
  }
  return best;
}
/* ONACCENT-SHARED-END */

module.exports = { oaHex: oaHex, oaOver: oaOver, oaLum: oaLum, oaRatio: oaRatio, pickOnAccent: pickOnAccent };
