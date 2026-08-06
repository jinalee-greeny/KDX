/* Freesm — 컴포넌트 빌드표
 *
 * 왜 이 파일이 따로 있는가.
 *   스키마의 components[].layout / tokenBindings 는 사람이 읽으라고 쓴 글이다.
 *     "cornerRadius": "shape variant에 따라 radius/full(Circle) 또는 radius/sm(Square)"
 *     "trackWidth":   "트랙 높이의 약 1.75배(잠정 산출값, 전용 토큰 없음)"
 *   문장이 섞인 값을 플러그인이 정규식으로 풀면, 틀려도 조용히 틀린다. 변수는
 *   이름이 어긋나면 눈에 띄지만 컴포넌트는 '그럴듯하게 잘못된 모양'으로 남는다.
 *   그래서 사람이 읽는 스펙은 그대로 두고, 기계가 읽는 표를 여기에 따로 적는다.
 *
 * 규칙
 *   · 값은 셋 중 하나다 — {t:'토큰/이름'} · {s:'스타일/이름'} · 숫자/열거값/null
 *   · 문장은 값에 넣지 않는다. 설명은 notes 에만 쓴다.
 *   · 토큰으로 못 잡는 잠정 수치는 반드시 notes 에 근거를 남긴다.
 *   · axes 는 여기서도 선언한다. 스키마와 다르면 gen-payload 가 실패한다 —
 *     한쪽만 고치고 넘어가는 일을 막기 위해서다.
 *
 * 폭 FILL 에 대하여
 *   컴포넌트 루트는 부모가 없으므로 layoutSizingHorizontal='FILL' 을 걸 수 없다.
 *   스펙이 FILL 인 것들(Input·Card·Divider·Progress Bar·Attachment Input 등)은
 *   기본 폭을 숫자로 두고 intent:'FILL' 을 남긴다. 플러그인이 이 값을 컴포넌트
 *   설명에 적어, 배치하는 사람이 FILL 로 바꾸도록 안내한다.
 */

'use strict';

/* 텍스트 스타일 이름 정규화.
   스펙은 'body/md' 라고만 쓰지만 실제 스타일은 굵기까지 붙은 'body/md/400' 이다.
   굵기가 하나뿐인 계열(utility·number)은 고를 것이 없고, 여러 개인 계열은
   여기서 한 번 정해 둔다 — 런타임 추론에 맡기면 나중에 조용히 바뀐다. */
const TEXT = {
  'body/xs': 'body/xs/400',
  'body/sm': 'body/sm/400',
  'body/md': 'body/md/400',
  'body/lg': 'body/lg/400',
  'link/sm': 'link/sm/500',
  'link/md': 'link/md/500',
  'heading/sm': 'heading/sm/600',
  'utility/standard/xs': 'utility/standard/xs/500',
  'utility/standard/sm': 'utility/standard/sm/500',
  'utility/standard/md': 'utility/standard/md/500',
  'utility/tight/xs': 'utility/tight/xs/500'
};
const S = n => ({ s: TEXT[n] || n });
const t = n => ({ t: n });

/* 잠정 수치 — 전용 토큰이 없어 숫자로 둔 것들. 근거를 반드시 적는다. */
const PROVISIONAL = [];
const px = (n, why) => { PROVISIONAL.push(why); return n; };

const BUILDS = [];
const C = o => { BUILDS.push(o); return o; };

/* ─────────────────────────── 1. Button ─────────────────────────── */
C({
  name: 'Button', form: 'box',
  axes: { style: ['Primary', 'Secondary', 'Neutral', 'Ghost'], size: ['Small', 'Medium', 'Large'], state: ['Default', 'Disabled'] },
  order: ['style', 'size', 'state'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    w: 'HUG', h: 'HUG', minW: t('a11y/touch-target/min'),
    padX: t('comp/padding/button/x'), padY: t('comp/padding/button/y'),
    gap: t('comp/gap/sm'), radius: t('comp/radius/button')
  },
  slots: [{ kind: 'text', name: 'Label', chars: 'Label' }],
  per: {
    style: {
      Primary:   { fill: t('comp/fill/accent/primary'),   border: null, slots: { Label: { fill: t('fg/inverse/default') } } },
      Secondary: { fill: t('comp/fill/accent/secondary'), border: null, slots: { Label: { fill: t('fg/accent/primary') } } },
      Neutral:   { fill: t('comp/fill/neutral/primary'),  border: null, slots: { Label: { fill: t('fg/inverse/default') } } },
      Ghost:     { fill: t('comp/fill/neutral/ghost'),    border: t('comp/bdr/default'), slots: { Label: { fill: t('fg/default') } } }
    },
    size: {
      Small:  { slots: { Label: { textStyle: S('utility/standard/xs') } } },
      Medium: { slots: { Label: { textStyle: S('utility/standard/sm') } } },
      Large:  { slots: { Label: { textStyle: S('utility/standard/md') } } }
    },
    state: {
      Default:  {},
      Disabled: { fill: t('comp/fill/neutral/disabled'), border: null, slots: { Label: { fill: t('comp/fg/disabled') } } }
    }
  },
  notes: ['높이는 텍스트 line-height + paddingY×2 로 자연 결정된다 — 높이 토큰을 직접 걸지 않는다.',
          'state=Disabled 는 style 의 fill·border·text 를 모두 덮는다(스펙의 overrides:[style]).']
});

/* ─────────────────────────── 2. Input ─────────────────────────── */
C({
  name: 'Input', form: 'box',
  axes: { size: ['Small', 'Medium', 'Large'], state: ['Default', 'Focused', 'Error', 'Disabled'] },
  order: ['size', 'state'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'MIN', alignCounter: 'CENTER',
    w: px(280, 'Input 기본 폭 280 — 스펙은 FILL 이지만 컴포넌트 루트에는 FILL 을 걸 수 없다'),
    wIntent: 'FILL', h: 'HUG', minW: t('a11y/touch-target/min'),
    padX: t('comp/padding/field/x'), padY: t('comp/padding/field/y'),
    radius: t('comp/radius/input')
  },
  slots: [{ kind: 'text', name: 'Placeholder', chars: 'Placeholder' }],
  per: {
    size: {
      Small:  { slots: { Placeholder: { textStyle: S('body/sm') } } },
      Medium: { slots: { Placeholder: { textStyle: S('body/md') } } },
      Large:  { slots: { Placeholder: { textStyle: S('body/lg') } } }
    },
    state: {
      Default:  { fill: t('comp/fill/field/default'),  border: t('comp/bdr/default'),  slots: { Placeholder: { fill: t('fg/subtle') } } },
      Focused:  { fill: t('comp/fill/field/default'),  border: t('comp/bdr/focused'),  slots: { Placeholder: { fill: t('fg/subtle') } } },
      Error:    { fill: t('comp/fill/field/default'),  border: t('status/fg/error'),   slots: { Placeholder: { fill: t('fg/subtle') } } },
      Disabled: { fill: t('comp/fill/field/disabled'), border: t('comp/bdr/disabled'), slots: { Placeholder: { fill: t('comp/fg/disabled') } } }
    }
  },
  notes: ['스펙의 align.primary 는 "SPACE_BETWEEN or CENTER" 로 열려 있다. 후행 아이콘이 없는 기본형이므로 MIN(좌측 정렬)로 만든다.',
          '값 텍스트(fg/default)는 placeholder 슬롯을 덮어써서 쓴다 — 슬롯을 둘로 나누면 인스턴스에서 둘 다 보인다.']
});

/* ─────────────────────────── 3. Card ─────────────────────────── */
C({
  name: 'Card', form: 'box',
  axes: { elevation: ['Flat', 'Raised'] },
  order: ['elevation'],
  base: {
    layout: 'VERTICAL', alignPrimary: 'MIN', alignCounter: 'MIN',
    w: px(320, 'Card 기본 폭 320 — 스펙은 FILL(부모 그리드 폭)'), wIntent: 'FILL', h: 'HUG',
    pad: t('comp/padding/card'), gap: t('comp/gap/md'), radius: t('comp/radius/card')
  },
  slots: [
    { kind: 'text', name: 'Title', chars: 'Title', textStyle: S('heading/sm'), fill: t('fg/default') },
    { kind: 'text', name: 'Body',  chars: '본문 텍스트가 들어갑니다.', textStyle: S('body/sm'), fill: t('fg/subtle') }
  ],
  per: {
    elevation: {
      Flat:   { fill: t('bg/default'),   border: t('comp/bdr/subtle'), shadow: null },
      Raised: { fill: t('bg/ev/raised'), border: null, shadow: { s: 'elevation/2' } }
    }
  },
  notes: []
});

/* ─────────────────────────── 4. Chip ─────────────────────────── */
C({
  name: 'Chip', form: 'box',
  axes: { state: ['Default', 'Selected', 'Disabled'] },
  order: ['state'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    w: 'HUG', h: 'HUG',
    padX: t('comp/gap/sm'), padY: t('comp/gap/xs'), gap: t('comp/gap/xs'),
    radius: t('comp/radius/chip')
  },
  slots: [
    { kind: 'text', name: 'Label', chars: 'Chip', textStyle: S('utility/standard/xs') },
    { kind: 'icon', name: 'Remove', glyph: 'x', w: t('w/icon/xs'), h: t('h/icon/xs') }
  ],
  per: {
    state: {
      Default:  { fill: t('comp/fill/neutral/secondary'), border: null,                    slots: { Label: { fill: t('fg/default') },       Remove: { fill: t('fg/default') } } },
      Selected: { fill: t('comp/fill/accent/secondary'),  border: t('comp/bdr/focused'),   slots: { Label: { fill: t('fg/accent/primary') }, Remove: { fill: t('fg/accent/primary') } } },
      Disabled: { fill: t('comp/fill/neutral/disabled'),  border: null,                    slots: { Label: { fill: t('comp/fg/disabled') }, Remove: { fill: t('comp/fg/disabled') } } }
    }
  },
  notes: ['제거 아이콘 색은 스펙에 따로 없다 — 라벨 색을 따라간다.']
});

/* ─────────────────────────── 5. Modal shell ─────────────────────────── */
C({
  name: 'Modal shell', form: 'box',
  axes: { form: ['Dialog', 'BottomSheet'] },
  order: ['form'],
  base: {
    layout: 'VERTICAL', alignPrimary: 'MIN', alignCounter: 'MIN',
    w: px(480, 'Modal 폭 480 — 스펙 본문의 "desktop 480px 기준"을 숫자로 옮긴 것. 전용 토큰 없음'),
    h: 'HUG', pad: t('comp/padding/card'), gap: t('comp/gap/md'),
    fill: t('bg/ev/raised'), shadow: { s: 'elevation/4' }
  },
  slots: [
    { kind: 'text', name: 'Title', chars: '제목', textStyle: S('heading/sm'), fill: t('fg/default') },
    { kind: 'text', name: 'Body',  chars: '내용이 들어갑니다.', textStyle: S('body/sm'), fill: t('fg/subtle') }
  ],
  per: {
    form: {
      Dialog:      { radius: t('comp/radius/modal') },
      BottomSheet: { radiusTop: t('comp/radius/modal'), radiusBottom: 0 }
    }
  },
  notes: ['오버레이(bg/variant/overlay)는 셸의 일부가 아니라 셸을 덮는 별도 레이어다 — 여기서 만들지 않는다.',
          '모바일 뷰포트에서 폭을 FILL 로 바꾸는 규칙은 Web 컬렉션 breakpoint 를 쓰는 배치 규칙이며 변형 축이 아니다.']
});

/* ─────────────────────────── 6. Pill ─────────────────────────── */
C({
  name: 'Pill', form: 'box',
  axes: { tone: ['Neutral', 'Success', 'Warning', 'Error'] },
  order: ['tone'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    w: 'HUG', h: 'HUG', padX: t('comp/gap/sm'), padY: t('comp/gap/xs'),
    radius: t('comp/radius/pill')
  },
  slots: [{ kind: 'text', name: 'Label', chars: 'Pill', textStyle: S('utility/tight/xs') }],
  per: {
    tone: {
      Neutral: { fill: t('comp/fill/neutral/tertiary'), slots: { Label: { fill: t('fg/subtle') } } },
      Success: { fill: t('status/bg/success'), slots: { Label: { fill: t('status/fg/success') } } },
      Warning: { fill: t('status/bg/warning'), slots: { Label: { fill: t('status/fg/warning') } } },
      Error:   { fill: t('status/bg/error'),   slots: { Label: { fill: t('status/fg/error') } } }
    }
  },
  notes: []
});

/* ─────────────────────────── 7. Icon Button ─────────────────────────── */
C({
  name: 'Icon Button', form: 'box',
  axes: { style: ['Primary', 'Secondary', 'Neutral', 'Ghost'], size: ['Small', 'Medium', 'Large'], state: ['Default', 'Disabled'] },
  order: ['style', 'size', 'state'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    radius: t('comp/radius/button'), padX: 0, padY: 0
  },
  slots: [{ kind: 'icon', name: 'Icon', glyph: 'search' }],
  per: {
    style: {
      Primary:   { fill: t('comp/fill/accent/primary'),   border: null, slots: { Icon: { fill: t('fg/inverse/default') } } },
      Secondary: { fill: t('comp/fill/accent/secondary'), border: null, slots: { Icon: { fill: t('fg/accent/primary') } } },
      Neutral:   { fill: t('comp/fill/neutral/primary'),  border: null, slots: { Icon: { fill: t('fg/inverse/default') } } },
      Ghost:     { fill: t('comp/fill/neutral/ghost'),    border: t('comp/bdr/default'), slots: { Icon: { fill: t('fg/default') } } }
    },
    size: {
      Small:  { w: t('w/control/sm'), h: t('h/control/sm'), slots: { Icon: { w: t('w/icon/sm'), h: t('h/icon/sm') } } },
      Medium: { w: t('w/control/md'), h: t('h/control/md'), slots: { Icon: { w: t('w/icon/md'), h: t('h/icon/md') } } },
      Large:  { w: t('w/control/lg'), h: t('h/control/lg'), slots: { Icon: { w: t('w/icon/lg'), h: t('h/icon/lg') } } }
    },
    state: {
      Default:  {},
      Disabled: { fill: t('comp/fill/neutral/disabled'), border: null, slots: { Icon: { fill: t('comp/fg/disabled') } } }
    }
  },
  notes: ['아이콘은 자리표시자다 — Freesm 아이콘 세트가 Figma 컴포넌트로 올라오면 인스턴스 스왑 슬롯으로 바꾼다.']
});

/* ─────────────────────────── 8. Checkbox ─────────────────────────── */
C({
  name: 'Checkbox', form: 'box',
  axes: { state: ['Unchecked', 'Checked', 'Indeterminate', 'Disabled'] },
  order: ['state'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    w: t('w/control/md'), h: t('h/control/md'), fill: null, padX: 0, padY: 0
  },
  slots: [{
    kind: 'frame', name: 'Box', w: t('w/icon/sm'), h: t('h/icon/sm'),
    radius: t('comp/radius/checkbox'), layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    children: [{ kind: 'icon', name: 'Mark', glyph: 'check', w: t('w/icon/xs'), h: t('h/icon/xs') }]
  }],
  per: {
    state: {
      Unchecked:     { slots: { Box: { fill: t('comp/fill/neutral/ghost'),    border: t('comp/bdr/default') },  Mark: { visible: false } } },
      Checked:       { slots: { Box: { fill: t('comp/fill/accent/primary'),   border: null },                   Mark: { visible: true,  glyph: 'check', fill: t('fg/inverse/default') } } },
      Indeterminate: { slots: { Box: { fill: t('comp/fill/accent/primary'),   border: null },                   Mark: { visible: true,  glyph: 'minus', fill: t('fg/inverse/default') } } },
      Disabled:      { slots: { Box: { fill: t('comp/fill/neutral/disabled'), border: t('comp/bdr/disabled') }, Mark: { visible: true,  glyph: 'check', fill: t('comp/fg/disabled') } } }
    }
  },
  notes: ['루트는 히트 영역(w·h/control/md), 안쪽 Box 가 눈에 보이는 체크박스(w·h/icon/sm)다 — 스펙의 비주얼/히트 분리 그대로.',
          '스펙은 마크 글리프를 "아이콘 세트 확정 후 결정"으로 열어 뒀다. 잠정으로 check·minus 를 쓴다.',
          '라벨은 Checkbox 안이 아니라 Form Field 모듈에서 조합한다 — 여기에 슬롯을 두지 않는다.']
});

/* ─────────────────────────── 9. Radio ─────────────────────────── */
C({
  name: 'Radio', form: 'box',
  axes: { state: ['Unchecked', 'Checked', 'Disabled'] },
  order: ['state'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    w: t('w/control/md'), h: t('h/control/md'), fill: null, padX: 0, padY: 0
  },
  slots: [{
    kind: 'frame', name: 'Circle', w: t('w/icon/sm'), h: t('h/icon/sm'),
    radius: t('comp/radius/radio'), layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    children: [{
      kind: 'ellipse', name: 'Dot',
      w: px(8, 'Radio 안쪽 점 8 — 비주얼 원 16 의 절반. 전용 토큰 없음'),
      h: px(8, 'Radio 안쪽 점 8 — 동일')
    }]
  }],
  per: {
    state: {
      Unchecked: { slots: { Circle: { fill: t('comp/fill/neutral/ghost'),    border: t('comp/bdr/default') },        Dot: { visible: false } } },
      Checked:   { slots: { Circle: { fill: t('comp/fill/neutral/ghost'),    border: t('comp/fill/accent/primary') }, Dot: { visible: true, fill: t('comp/fill/accent/primary') } } },
      Disabled:  { slots: { Circle: { fill: t('comp/fill/neutral/disabled'), border: t('comp/bdr/disabled') },        Dot: { visible: true, fill: t('comp/fg/disabled') } } }
    }
  },
  notes: ['comp/radius/radio 는 999(radius/full) 이므로 사각 프레임이 원으로 보인다.']
});

/* ─────────────────────────── 10. Switch ─────────────────────────── */
C({
  name: 'Switch', form: 'box',
  axes: { state: ['Off', 'On', 'Disabled'] },
  order: ['state'],
  base: {
    layout: 'HORIZONTAL', alignCounter: 'CENTER',
    w: px(42, 'Switch 트랙 폭 42 — 스펙의 "트랙 높이(24)의 약 1.75배". 전용 토큰 없음'),
    h: t('h/icon/lg'),
    padX: t('comp/gap/xs'), padY: t('comp/gap/xs'),
    radius: t('comp/radius/switch')
  },
  slots: [{
    kind: 'ellipse', name: 'Thumb',
    w: px(16, 'Switch 썸 16 — 스펙의 "트랙 높이(24) − comp/gap/xs(4)×2". 전용 토큰 없음'),
    h: px(16, 'Switch 썸 16 — 동일')
  }],
  per: {
    state: {
      Off:      { alignPrimary: 'MIN', fill: t('comp/bdr/default'),           slots: { Thumb: { fill: t('comp/fill/inverse/default') } } },
      On:       { alignPrimary: 'MAX', fill: t('comp/fill/accent/primary'),   slots: { Thumb: { fill: t('comp/fill/inverse/default') } } },
      Disabled: { alignPrimary: 'MIN', fill: t('comp/fill/neutral/disabled'), slots: { Thumb: { fill: t('comp/fill/neutral/tertiary') } } }
    }
  },
  notes: ['썸의 좌우 위치는 좌표가 아니라 auto-layout 정렬(MIN/MAX)로 만든다 — 트랙 폭이 바뀌어도 따라간다.',
          '트랙 폭·썸 크기는 전용 토큰이 없어 숫자다. 토큰이 생기면 이 두 줄만 바꾸면 된다.']
});

/* ─────────────────────────── 11. Select / Dropdown trigger ─────────────────────────── */
C({
  name: 'Select / Dropdown trigger', form: 'box',
  axes: { state: ['Default', 'Focused', 'Error', 'Disabled'] },
  order: ['state'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'SPACE_BETWEEN', alignCounter: 'CENTER',
    w: px(280, 'Select 기본 폭 280 — 스펙은 FILL'), wIntent: 'FILL', h: 'HUG',
    minW: t('a11y/touch-target/min'),
    padX: t('comp/padding/field/x'), padY: t('comp/padding/field/y'),
    gap: t('comp/gap/sm'), radius: t('comp/radius/input')
  },
  slots: [
    { kind: 'text', name: 'Placeholder', chars: '선택하세요', textStyle: S('body/md') },
    { kind: 'icon', name: 'Chevron', glyph: 'chevron-down', w: t('w/icon/sm'), h: t('h/icon/sm') }
  ],
  per: {
    state: {
      Default:  { fill: t('comp/fill/field/default'),  border: t('comp/bdr/default'),  slots: { Placeholder: { fill: t('fg/subtle') },        Chevron: { fill: t('fg/subtle') } } },
      Focused:  { fill: t('comp/fill/field/default'),  border: t('comp/bdr/focused'),  slots: { Placeholder: { fill: t('fg/subtle') },        Chevron: { fill: t('fg/subtle') } } },
      Error:    { fill: t('comp/fill/field/default'),  border: t('status/fg/error'),   slots: { Placeholder: { fill: t('fg/subtle') },        Chevron: { fill: t('fg/subtle') } } },
      Disabled: { fill: t('comp/fill/field/disabled'), border: t('comp/bdr/disabled'), slots: { Placeholder: { fill: t('comp/fg/disabled') }, Chevron: { fill: t('comp/fg/disabled') } } }
    }
  },
  notes: []
});

/* ─────────────────────────── 12. Avatar ─────────────────────────── */
C({
  name: 'Avatar', form: 'box',
  axes: { shape: ['Circle', 'Square'], size: ['Small', 'Medium', 'Large'] },
  order: ['shape', 'size'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    padX: 0, padY: 0, fill: t('comp/fill/neutral/tertiary')
  },
  slots: [{ kind: 'text', name: 'Initials', chars: 'AB', fill: t('fg/subtle') }],
  per: {
    shape: {
      Circle: { radius: t('radius/full') },
      Square: { radius: t('radius/sm') }
    },
    size: {
      Small:  { w: t('w/avatar/sm'), h: t('h/avatar/sm'), slots: { Initials: { textStyle: S('utility/tight/xs') } } },
      Medium: { w: t('w/avatar/md'), h: t('h/avatar/md'), slots: { Initials: { textStyle: S('utility/standard/xs') } } },
      Large:  { w: t('w/avatar/lg'), h: t('h/avatar/lg'), slots: { Initials: { textStyle: S('utility/standard/sm') } } }
    }
  },
  notes: ['이미지가 있으면 이니셜 슬롯을 덮어 이미지 fill 로 바꾼다 — 이미지 자체는 컴포넌트에 넣지 않는다.']
});

/* ─────────────────────────── 13. Badge / Tag ─────────────────────────── */
C({
  name: 'Badge / Tag', form: 'box',
  axes: { form: ['Label', 'Dot'], tone: ['Neutral', 'Success', 'Warning', 'Error'] },
  order: ['form', 'tone'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER', w: 'HUG', h: 'HUG'
  },
  slots: [{ kind: 'text', name: 'Label', chars: 'Badge', textStyle: S('utility/tight/xs') }],
  per: {
    form: {
      Label: { padX: t('comp/gap/sm'), padY: t('comp/gap/xs'), radius: t('comp/radius/pill'), slots: { Label: { visible: true } } },
      Dot:   { padX: 0, padY: 0, w: t('dimension/8'), h: t('dimension/8'), radius: t('radius/full'), slots: { Label: { visible: false } } }
    },
    tone: {
      Neutral: { fill: t('comp/fill/neutral/tertiary'), slots: { Label: { fill: t('fg/subtle') } } },
      Success: { fill: t('status/bg/success'), slots: { Label: { fill: t('status/fg/success') } } },
      Warning: { fill: t('status/bg/warning'), slots: { Label: { fill: t('status/fg/warning') } } },
      Error:   { fill: t('status/bg/error'),   slots: { Label: { fill: t('status/fg/error') } } }
    }
  },
  /* Dot 형은 배경이 아니라 점 자체가 색이다 — tone 이 칠한 배경색을 dotFill 로 덮는다. */
  combos: {
    'form=Dot,tone=Neutral': { fill: t('fg/subtler') },
    'form=Dot,tone=Success': { fill: t('status/fg/success') },
    'form=Dot,tone=Warning': { fill: t('status/fg/warning') },
    'form=Dot,tone=Error':   { fill: t('status/fg/error') }
  },
  notes: ['Label 형의 레이아웃·토큰은 Pill 과 사실상 같다 — 통합 여부는 아직 열린 사항이다.',
          'Dot 형은 라벨 슬롯을 숨기고 dimension/8 정사각 + radius/full 로 만든다.']
});

/* ─────────────────────────── 14. Tooltip ─────────────────────────── */
C({
  name: 'Tooltip', form: 'box',
  axes: { placement: ['Top', 'Bottom', 'Left', 'Right'] },
  order: ['placement'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER', w: 'HUG', h: 'HUG',
    padX: t('comp/gap/sm'), padY: t('comp/gap/xs'), radius: t('comp/radius/tooltip'),
    fill: t('bg/variant/inverse'), shadow: { s: 'elevation/2' }
  },
  slots: [
    { kind: 'text', name: 'Label', chars: '설명', textStyle: S('body/xs'), fill: t('fg/inverse/default') },
    { kind: 'rect', name: 'Arrow', fill: t('bg/variant/inverse'), rotation: 45,
      w: px(8, 'Tooltip 화살표 8×8 정사각을 45° 돌려 쓴다. 스펙에 화살표 규격이 없어 잠정'),
      h: px(8, 'Tooltip 화살표 8×8 — 동일'), absolute: true }
  ],
  per: {
    placement: {
      Top:    { slots: { Arrow: { anchor: 'BOTTOM' } } },
      Bottom: { slots: { Arrow: { anchor: 'TOP' } } },
      Left:   { slots: { Arrow: { anchor: 'RIGHT' } } },
      Right:  { slots: { Arrow: { anchor: 'LEFT' } } }
    }
  },
  notes: ['placement 는 툴팁이 붙는 방향이다 — 화살표는 반대쪽에 달린다(Top 배치면 화살표는 아래).',
          '화살표 규격은 스펙에 없다. 8×8 정사각 45° 회전은 잠정값이며 토큰이 생기면 교체한다.']
});

/* ─────────────────────────── 15. Link ─────────────────────────── */
C({
  name: 'Link', form: 'box',
  axes: { size: ['Small', 'Medium'], state: ['Default', 'Visited', 'Disabled'] },
  order: ['size', 'state'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'MIN', alignCounter: 'CENTER',
    w: 'HUG', h: 'HUG', padX: 0, padY: 0, fill: null
  },
  slots: [{ kind: 'text', name: 'Label', chars: '링크 텍스트', decoration: 'UNDERLINE' }],
  per: {
    size: {
      Small:  { slots: { Label: { textStyle: S('link/sm') } } },
      Medium: { slots: { Label: { textStyle: S('link/md') } } }
    },
    state: {
      Default:  { slots: { Label: { fill: t('fg/link/default') } } },
      Visited:  { slots: { Label: { fill: t('fg/link/visited') } } },
      Disabled: { slots: { Label: { fill: t('comp/fg/disabled'), decoration: 'NONE' } } }
    }
  },
  notes: ['스펙은 "자체 auto-layout 없는 인라인 텍스트"다. 컴포넌트 루트는 프레임이어야 하므로 패딩 0·배경 없음의 껍데기만 두고 실체는 텍스트 노드다.']
});

/* ─────────────────────────── 16. Divider ─────────────────────────── */
C({
  name: 'Divider', form: 'box',
  axes: { orientation: ['Horizontal', 'Vertical'] },
  order: ['orientation'],
  base: { layout: 'NONE', fill: t('comp/bdr/subtle'), radius: 0 },
  slots: [],
  per: {
    orientation: {
      Horizontal: { w: px(200, 'Divider 기본 길이 200 — 스펙은 FILL'), wIntent: 'FILL', h: t('dimension/1') },
      Vertical:   { w: t('dimension/1'), h: px(200, 'Divider 기본 길이 200 — 스펙은 FILL'), hIntent: 'FILL' }
    }
  },
  notes: []
});

/* ─────────────────────────── 17. Progress bar / Spinner ─────────────────────────── */
C({
  name: 'Progress bar / Spinner', form: 'box',
  axes: { form: ['Bar', 'Spinner'], size: ['Small', 'Medium', 'Large'] },
  order: ['form', 'size'],
  base: { layout: 'NONE', fill: t('comp/fill/neutral/tertiary') },
  slots: [
    { kind: 'frame', name: 'Fill', fill: t('comp/fill/accent/primary'), absolute: true, anchor: 'LEFT' },
    { kind: 'ellipse', name: 'Ring', fill: null, border: t('comp/fill/accent/primary'), absolute: true, anchor: 'FULL', arc: 0.75 }
  ],
  per: {
    form: {
      Bar: {
        w: px(240, 'Progress Bar 기본 길이 240 — 스펙은 FILL'), wIntent: 'FILL',
        h: t('comp/track/bar-height'), radius: t('comp/radius/progress'),
        fill: t('comp/fill/neutral/tertiary'),
        slots: { Fill: { visible: true, ratio: 0.6, radius: t('comp/radius/progress') }, Ring: { visible: false } }
      },
      Spinner: {
        fill: null, radius: 0,
        slots: { Fill: { visible: false }, Ring: { visible: true, strokeWeight: t('comp/track/spinner-stroke') } }
      }
    },
    size: {
      Small:  {}, Medium: {}, Large: {}
    }
  },
  combos: {
    'form=Spinner,size=Small':  { w: t('w/icon/sm'), h: t('h/icon/sm') },
    'form=Spinner,size=Medium': { w: t('w/icon/md'), h: t('h/icon/md') },
    'form=Spinner,size=Large':  { w: t('w/icon/lg'), h: t('h/icon/lg') }
  },
  notes: ['Bar 형에는 size 축이 걸리는 토큰이 없다 — 세 변형의 모양이 같다. 스펙이 축을 그렇게 선언했으므로 그대로 만들고, 굵기 토큰이 생기면 채운다.',
          'Spinner 는 75% 원호(arc)로 만든다 — 회전 애니메이션은 Figma 컴포넌트가 아니라 프로토타입의 몫이다.',
          '표에는 Ring 을 border+strokeWeight 로 적었지만, Figma 에서 호를 선으로 그리면 부채꼴 테두리가 되어 두 줄로 보인다. 그래서 플러그인이 같은 굵기의 도넛 채우기(innerRadius)로 옮겨 그린다 — 보이는 결과는 같고, 굵기 토큰은 그대로 산다.',
          'Bar 의 채움 비율 60% 는 보여 주기용 기본값이다.']
});

/* ─────────────────────────── 18. Skeleton ─────────────────────────── */
C({
  name: 'Skeleton', form: 'box',
  axes: { shape: ['Text', 'Rectangle', 'Circle'] },
  order: ['shape'],
  base: { layout: 'NONE', fill: t('comp/fill/neutral/tertiary') },
  slots: [],
  per: {
    shape: {
      Text:      { w: px(160, 'Skeleton Text 160×16 — 한 줄 텍스트 자리. 전용 토큰 없음'), h: px(16, 'Skeleton Text 높이 16'), radius: t('radius/2xs') },
      Rectangle: { w: px(160, 'Skeleton Rectangle 160×96 — 이미지 자리. 전용 토큰 없음'), h: px(96, 'Skeleton Rectangle 높이 96'), radius: t('radius/sm') },
      Circle:    { w: px(40, 'Skeleton Circle 40×40 — 아바타 자리. 전용 토큰 없음'), h: px(40, 'Skeleton Circle 40×40'), radius: t('radius/full') }
    }
  },
  notes: ['스펙 상태가 tokens_identified 다 — 색과 라운드만 확정이고 치수는 아직 스펙에 없다. 위 숫자는 잠정이다.']
});

/* ─────────────────────────── 19. Toast ─────────────────────────── */
C({
  name: 'Toast', form: 'box',
  axes: { tone: ['Neutral', 'Success', 'Warning', 'Error'] },
  order: ['tone'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'MIN', alignCounter: 'CENTER', w: 'HUG', h: 'HUG',
    padX: t('comp/padding/field/x'), padY: t('comp/padding/field/y'), gap: t('comp/gap/sm'),
    radius: t('comp/radius/toast'), fill: t('bg/variant/inverse'), shadow: { s: 'elevation/3' }
  },
  slots: [
    { kind: 'icon', name: 'Icon', glyph: 'info', w: t('w/icon/sm'), h: t('h/icon/sm') },
    { kind: 'text', name: 'Label', chars: '알림 메시지', textStyle: S('body/sm'), fill: t('fg/inverse/default') }
  ],
  per: {
    tone: {
      Neutral: { slots: { Icon: { fill: t('fg/inverse/subtle') } } },
      Success: { slots: { Icon: { fill: t('status/fg/success') } } },
      Warning: { slots: { Icon: { fill: t('status/fg/warning') } } },
      Error:   { slots: { Icon: { fill: t('status/fg/error') } } }
    }
  },
  notes: ['최대 폭은 Web 컬렉션 container 를 참조하는 배치 규칙이다 — 변형 축이 아니므로 여기서는 HUG 로 둔다.']
});

/* ─────────────────────────── 20. Segmented Control ─────────────────────────── */
C({
  name: 'Segmented Control', form: 'box',
  axes: { state: ['Unselected', 'Selected', 'Disabled'] },
  order: ['state'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER', w: 'HUG', h: 'HUG',
    padX: t('comp/gap/md'), padY: t('comp/padding/button/y'), radius: t('comp/radius/input')
  },
  slots: [{ kind: 'text', name: 'Label', chars: '항목', textStyle: S('utility/standard/sm') }],
  per: {
    state: {
      Unselected: { fill: t('comp/fill/neutral/ghost'), shadow: null,                 slots: { Label: { fill: t('fg/subtle') } } },
      Selected:   { fill: t('bg/ev/raised'),            shadow: { s: 'elevation/1' }, slots: { Label: { fill: t('fg/default') } } },
      Disabled:   { fill: t('comp/fill/neutral/ghost'), shadow: null,                 slots: { Label: { fill: t('comp/fg/disabled') } } }
    }
  },
  notes: ['이 컴포넌트는 세그먼트 하나다 — state 축이 세그먼트의 상태이기 때문이다.',
          '바깥 컨테이너(padding comp/gap/xs · fill comp/fill/neutral/tertiary · radius comp/radius/input)는 세그먼트를 담는 조합 규칙이며 변형이 아니다.']
});

/* ─────────────────────────── 21. Slider ─────────────────────────── */
C({
  name: 'Slider', form: 'box',
  axes: { state: ['Default', 'Disabled'] },
  order: ['state'],
  base: {
    layout: 'NONE', fill: null,
    w: px(240, 'Slider 기본 길이 240 — 스펙에 폭 토큰이 없다'),
    h: t('h/icon/md')
  },
  slots: [
    { kind: 'frame', name: 'Track', absolute: true, anchor: 'CENTER_H', h: t('comp/track/slider-height'),
      radius: t('comp/radius/slider'), fill: t('comp/fill/neutral/tertiary'),
      children: [{ kind: 'frame', name: 'Fill', absolute: true, anchor: 'LEFT', ratio: 0.5, radius: t('comp/radius/slider') }] },
    { kind: 'ellipse', name: 'Thumb', absolute: true, anchor: 'RATIO_H', ratio: 0.5,
      w: t('w/icon/md'), h: t('h/icon/md'), radius: t('comp/radius/slider') }
  ],
  per: {
    state: {
      Default:  { slots: { Fill: { fill: t('comp/fill/accent/primary') },   Thumb: { fill: t('comp/fill/inverse/default'), border: t('comp/bdr/focused') } } },
      Disabled: { slots: { Fill: { fill: t('comp/fill/neutral/disabled') }, Thumb: { fill: t('comp/fill/inverse/default'), border: t('comp/bdr/disabled') } } }
    }
  },
  notes: ['값 50% 는 보여 주기용 기본값이다 — 트랙 채움과 썸 위치가 같은 비율을 쓴다.']
});

/* ─────────────────────────── 22. Image Frame ─────────────────────────── */
C({
  name: 'Image Frame', form: 'box',
  axes: { radius: ['Small', 'Medium', 'Large'] },
  order: ['radius'],
  base: {
    layout: 'HORIZONTAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    w: px(240, 'Image Frame 기본 240×160(3:2) — 스펙은 FILL 폭 + aspectRatio 속성'), wIntent: 'FILL',
    h: px(160, 'Image Frame 기본 높이 160 — 3:2 기준'),
    padX: 0, padY: 0, fill: t('comp/fill/neutral/tertiary')
  },
  slots: [{ kind: 'icon', name: 'Placeholder', glyph: 'image', w: t('w/icon/lg'), h: t('h/icon/lg'), fill: t('fg/subtler') }],
  per: {
    radius: {
      Small:  { radius: t('comp/radius/image/sm') },
      Medium: { radius: t('comp/radius/image/md') },
      Large:  { radius: t('comp/radius/image/lg') }
    }
  },
  notes: ['이미지가 채워지면 자리표시자 아이콘을 숨기고 프레임 fill 을 이미지로 바꾼다.']
});

/* ─────────────────────────── 23. Attachment Input ─────────────────────────── */
C({
  name: 'Attachment Input', form: 'box',
  axes: { state: ['Default', 'DragOver', 'Error', 'Disabled'] },
  order: ['state'],
  base: {
    layout: 'VERTICAL', alignPrimary: 'CENTER', alignCounter: 'CENTER',
    w: px(320, 'Attachment Input 기본 폭 320 — 스펙은 FILL'), wIntent: 'FILL', h: 'HUG',
    pad: t('comp/padding/card'), gap: t('comp/gap/sm'),
    radius: t('comp/radius/input'), borderStyle: 'DASHED'
  },
  slots: [
    { kind: 'icon', name: 'Icon', glyph: 'upload', w: t('w/icon/lg'), h: t('h/icon/lg') },
    { kind: 'text', name: 'Label', chars: '파일을 끌어다 놓거나 눌러서 선택하세요', textStyle: S('body/sm') }
  ],
  per: {
    state: {
      Default:  { fill: t('comp/fill/field/default'),  border: t('comp/bdr/default'),  slots: { Icon: { fill: t('fg/subtle') },          Label: { fill: t('fg/subtle') } } },
      DragOver: { fill: t('bg/accent/subtle'),         border: t('comp/bdr/focused'),  slots: { Icon: { fill: t('fg/accent/primary') },  Label: { fill: t('fg/accent/primary') } } },
      Error:    { fill: t('comp/fill/field/default'),  border: t('status/fg/error'),   slots: { Icon: { fill: t('status/fg/error') },    Label: { fill: t('status/fg/error') } } },
      Disabled: { fill: t('comp/fill/field/disabled'), border: t('comp/bdr/disabled'), slots: { Icon: { fill: t('comp/fg/disabled') },   Label: { fill: t('comp/fg/disabled') } } }
    }
  },
  notes: ['DASHED 테두리는 토큰 대상이 아닌 스트로크 스타일 속성이다.']
});

/* ─────────────────────── 검증 ───────────────────────
   빌드표가 가리키는 토큰·스타일이 실제로 페이로드에 있는지, 축이 스키마와
   같은지 확인한다. 하나라도 어긋나면 예외를 던져 생성 자체를 멈춘다 —
   경고로 흘려보내면 잘못된 컴포넌트가 Figma 파일에 남는다. */
function validate(builds, ctx) {
  const { variableNames, styleNames, schemaAxes } = ctx;
  const bad = [];
  const seenTokens = new Set(), seenStyles = new Set();

  const walkValue = (v, where) => {
    if (v == null || typeof v !== 'object') return;
    if (typeof v.t === 'string') {
      seenTokens.add(v.t);
      if (!variableNames.has(v.t)) bad.push(where + ' — 없는 토큰 ' + v.t);
      return;
    }
    if (typeof v.s === 'string') {
      seenStyles.add(v.s);
      if (!styleNames.has(v.s)) bad.push(where + ' — 없는 스타일 ' + v.s);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walkValue(x, where + '[' + i + ']'));
    for (const k in v) walkValue(v[k], where + '.' + k);
  };

  for (const b of builds) {
    const w = '컴포넌트 ' + b.name;
    walkValue(b.base, w + '.base');
    walkValue(b.slots, w + '.slots');
    walkValue(b.per, w + '.per');
    walkValue(b.combos, w + '.combos');

    /* 축이 스키마와 같은가 */
    const mine = b.axes, theirs = schemaAxes[b.name];
    if (!theirs) { bad.push(w + ' — 스키마에 없는 컴포넌트'); continue; }
    const kA = Object.keys(mine).sort(), kB = Object.keys(theirs).sort();
    if (kA.join('|') !== kB.join('|'))
      bad.push(w + ' — 축 이름이 스키마와 다릅니다: 빌드표 [' + kA + '] vs 스키마 [' + kB + ']');
    else for (const k of kA)
      if (mine[k].join('|') !== theirs[k].join('|'))
        bad.push(w + ' — 축 ' + k + ' 값이 스키마와 다릅니다: [' + mine[k] + '] vs [' + theirs[k] + ']');

    /* order 가 축을 빠짐없이 담고 있는가 */
    if (b.order.slice().sort().join('|') !== kA.join('|'))
      bad.push(w + ' — order [' + b.order + '] 가 축 [' + kA + '] 와 다릅니다');

    /* per 의 각 축이 모든 값을 덮는가 */
    for (const ax of b.order) {
      const have = Object.keys((b.per || {})[ax] || {});
      const missing = mine[ax].filter(v => !have.includes(v));
      if (missing.length) bad.push(w + ' — per.' + ax + ' 에 빠진 값: ' + missing.join(', '));
      const extra = have.filter(v => !mine[ax].includes(v));
      if (extra.length) bad.push(w + ' — per.' + ax + ' 에 축에 없는 값: ' + extra.join(', '));
    }

    /* combos 키가 실제 조합인가 */
    for (const key of Object.keys(b.combos || {})) {
      for (const part of key.split(',')) {
        const [ax, val] = part.split('=');
        if (!mine[ax]) { bad.push(w + ' — combos 키 ' + key + ' 의 축 ' + ax + ' 가 없습니다'); break; }
        if (!mine[ax].includes(val)) { bad.push(w + ' — combos 키 ' + key + ' 의 값 ' + val + ' 이(가) 축에 없습니다'); break; }
      }
    }

    /* per / combos 가 가리키는 슬롯이 실제로 있는가 */
    const slotNames = new Set();
    const collect = list => (list || []).forEach(s => { slotNames.add(s.name); collect(s.children); });
    collect(b.slots);
    const checkSlots = (delta, where) => {
      for (const n of Object.keys((delta || {}).slots || {}))
        if (!slotNames.has(n)) bad.push(where + ' — 없는 슬롯 ' + n);
    };
    for (const ax of b.order) for (const v of Object.keys(b.per[ax])) checkSlots(b.per[ax][v], w + '.per.' + ax + '.' + v);
    for (const k of Object.keys(b.combos || {})) checkSlots(b.combos[k], w + '.combos.' + k);
  }

  if (bad.length) {
    const e = new Error('컴포넌트 빌드표 검증 실패 ' + bad.length + '건\n  · ' + bad.join('\n  · '));
    e.freesmDetails = bad;
    throw e;
  }
  return { tokens: [...seenTokens].sort(), styles: [...seenStyles].sort() };
}

const variantCount = b => b.order.reduce((a, k) => a * b.axes[k].length, 1);

module.exports = { BUILDS, TEXT, PROVISIONAL, validate, variantCount };
