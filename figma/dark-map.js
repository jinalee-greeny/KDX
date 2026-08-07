/* ─────────────────────────── Semantic Dark 매핑표 ───────────────────────────
 *
 * 라이트의 시맨틱 76개에 다크 짝을 지어 준다. 자동으로 뒤집지 않는다 —
 * 램프 위치를 기계적으로 미러링하면 '반대(inverse)'와 '고정(static)' 이 함께 뒤집혀
 * 뜻이 무너진다. 그래서 여기서는 역할별로 손으로 짝을 짓고, 그 근거를 한 줄씩 적는다.
 *
 * 사용자 결정 (2026-08-07)
 *   · 바닥은 gray/05(#0e0f10), 올라올수록 밝게 — raised=gray/10, 그 위=gray/20.
 *     대신 sunken(가라앉은 면)은 gray/00 순검정밖에 둘 자리가 없다.
 *
 * 규칙 셋
 *   1) 알파는 색을 바꾸는 게 아니라 방향을 바꾼다 — black→white. 다만 어두운 바닥에서
 *      흰 알파는 같은 %면 더 약해 보이므로 대체로 한 단계 올린다.
 *   2) 이름에 inverse 가 든 것은 '반대 표면에 놓이는 색' 이라는 뜻이므로 다크에서는
 *      라이트의 반대편으로 간다. 뒤집는 게 아니라 정의를 따르는 것이다.
 *   3) static/* 은 뜻 자체가 '모드와 무관' 이므로 다크 값을 주지 않는다.
 *
 * 값이 없는 토큰은 다크에서도 라이트 값을 그대로 쓴다.
 */
'use strict';

/* 다크에서 새로 필요한 원시값. 없으면 별칭이 허공을 가리킨다. */
const NEW_SCALE = {
  'color/alpha/orange/20': '#bf5a0e33'   // status/bg/warning 이 다크에서 한 단계 진해진다
};

const DARK = {
  /* ── 배경 ── 바닥 gray/05, 위로 갈수록 밝게 */
  'bg/default':                 ['color/gray/05',   '바닥'],
  'bg/sunken':                  ['color/gray/00',   '바닥보다 아래 — 순검정 말고는 둘 자리가 없다'],
  'bg/ev/raised':               ['color/gray/10',   '한 칸 위'],
  'bg/ev/sticky':               ['color/gray/10',   '한 칸 위'],
  'bg/variant/container':       ['color/gray/10',   '한 칸 위'],
  'bg/variant/overlay-alt':     ['color/gray/10',   '한 칸 위'],
  'bg/alt':                     ['color/gray/94',   '성격이 반대인 면 — 라이트에서 어두웠으니 다크에선 밝다'],
  'bg/variant/inverse':         ['color/gray/94',   'inverse 정의를 따른다'],
  'bg/variant/overlay':         ['color/alpha/black/70', '오버레이는 다크에서도 검정, 대신 더 진하게'],
  'bg/variant/content-dimmer':  ['color/alpha/black/50', '같은 이유'],
  'bg/accent/subtle':           ['color/primary/90', '브랜드 램프는 05가 가장 밝다 — 아주 어두운 틴트로'],

  /* ── 전경 ── */
  'fg/default':                 ['color/gray/100',  '바닥이 뒤집혔으니 글자도'],
  'fg/subtle':                  ['color/alpha/white/70', '흰 알파는 같은 %면 약해 보여 한 단계 위로'],
  'fg/subtler':                 ['color/alpha/white/50', '같음'],
  'fg/subtlest':                ['color/alpha/white/40', '같음'],
  'fg/faint':                   ['color/alpha/white/20', '같음'],
  'fg/inverse/default':         ['color/gray/05',   'inverse 정의를 따른다'],
  'fg/inverse/subtle':          ['color/alpha/black/60', '같음'],
  'fg/inverse/subtler':         ['color/alpha/black/40', '같음'],
  'fg/accent/primary':          ['color/primary/30', '어두운 바닥 위에서 읽히도록 밝은 쪽으로'],
  'fg/link/default':            ['color/primary/30', '같음'],
  'fg/link/visited':            ['color/primary/20', '기본 링크보다 한 단계 더 밝게 — 라이트의 위계를 유지'],

  /* ── 컴포넌트 전경·보더 ── */
  'comp/fg/disabled':           ['color/alpha/white/30', ''],
  'comp/fg/on-accent/primary':  ['color/gray/100',  'autoContrast 가 브랜드마다 다시 잰다'],
  'comp/fg/on-accent/secondary':['color/primary/30', '같음'],
  'comp/bdr/default':           ['color/alpha/white/50', ''],
  'comp/bdr/subtle':            ['color/alpha/white/30', ''],
  'comp/bdr/subtler':           ['color/alpha/white/20', ''],
  'comp/bdr/subtlest':          ['color/alpha/white/10', ''],
  'comp/bdr/strong':            ['color/gray/100',  ''],
  'comp/bdr/inverse/default':   ['color/alpha/black/50', 'inverse 정의를 따른다'],
  'comp/bdr/inverse/subtle':    ['color/alpha/black/30', '같음'],
  'comp/bdr/focused':           ['color/primary/30', '포커스 링은 바닥에서 튀어야 한다'],
  'comp/bdr/disabled':          ['color/alpha/white/10', ''],

  /* ── 컴포넌트 채움 ── */
  'comp/fill/accent/primary':   ['color/primary/50', '강조면은 브랜드 그대로 — 글자는 on-accent 가 맞춘다'],
  'comp/fill/accent/secondary': ['color/primary/90', '연한 틴트의 다크 짝'],
  'comp/fill/neutral/primary':  ['color/gray/100',  '중립 강조는 바닥의 반대'],
  'comp/fill/neutral/secondary':['color/gray/20',   ''],
  'comp/fill/neutral/tertiary': ['color/gray/10',   ''],
  'comp/fill/neutral/disabled': ['color/gray/20',   ''],
  'comp/fill/field/default':    ['color/gray/10',   '입력면은 바닥보다 한 칸 위'],
  'comp/fill/field/disabled':   ['color/alpha/white/10', ''],
  'comp/fill/inverse/default':  ['color/gray/05',   'inverse 정의를 따른다'],
  'comp/state/hover':           ['color/alpha/white/10', '어두운 면 위에서는 밝게 덧칠한다'],
  'comp/state/pressed':         ['color/alpha/white/20', '같음'],

  /* ── 상태 ── 라이트는 스톱 40, 다크는 스톱 70. 이미 v0.85 에서 재 둔 값이다. */
  'status/fg/error':            ['color/red/70',    '어두운 표면 위 7.42:1 (v0.85 실측)'],
  'status/fg/success':          ['color/green/70',  '7.48:1'],
  'status/fg/warning':          ['color/orange/70', '7.43:1'],
  'status/fg/info':             ['color/blue/70',   '8.87:1'],
  'status/fg/inverse/error':    ['color/red/40',    'inverse 정의를 따른다 — 밝은 표면 위'],
  'status/fg/inverse/success':  ['color/green/40',  '같음'],
  'status/fg/inverse/warning':  ['color/orange/40', '같음'],
  'status/fg/inverse/info':     ['color/blue/40',   '같음'],
  'status/bg/error':            ['color/alpha/red/20',    '어두운 바닥에서는 한 단계 진해야 보인다'],
  'status/bg/success':          ['color/alpha/green/20',  '같음'],
  'status/bg/warning':          ['color/alpha/orange/20', '같음 (원시값 신설)'],
  'status/bg/info':             ['color/alpha/blue/30',   '같음'],

  /* ── 차트 ── 면적이 작고 선이 얇아 한두 단계 밝은 쪽을 쓴다 */
  'chart/status/fg/up':            ['color/red/70',   ''],
  'chart/status/fg/down':          ['color/blue/60',  ''],
  'chart/status/fg/flat':          ['color/gray/60',  ''],
  'chart/status/fill/up-default':  ['color/red/60',   ''],
  'chart/status/fill/down-default':['color/blue/60',  ''],
  'chart/status/fill/flat-default':['color/gray/60',  ''],
  'chart/status/fill/up-subtle':   ['color/alpha/red/30',  ''],
  'chart/status/fill/down-subtle': ['color/alpha/blue/30', ''],
  'chart/status/fill/flat-subtle': ['color/alpha/white/10', '회색 알파는 다크에서 안 보인다'],
  'chart/color/1':                 ['color/green/70',  ''],
  'chart/color/2':                 ['color/purple/60', ''],
  'chart/color/3':                 ['color/blue/70',   ''],
  'chart/color/4':                 ['color/orange/70', ''],
  'chart/color/5':                 ['color/gray/60',   '']

  /* static/* 과 comp/fill/neutral/ghost 는 일부러 없다 —
     '모드와 무관' 이 그 토큰의 뜻이고, 투명은 어느 바닥에서도 투명이다. */
};

module.exports = { DARK: DARK, NEW_SCALE: NEW_SCALE };
