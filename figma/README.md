# figma/ — 토큰을 Figma로 내보내는 경로

## 왜 REST가 아니라 플러그인인가

Figma REST API에서 변수를 쓰는 엔드포인트는 `POST /v1/files/:file_key/variables` 하나뿐이고
Enterprise 조직 전용이다. 읽기(`GET …/variables/local`)도, 스코프 `file_variables:write`도 같다.
pxd는 Enterprise가 아니므로 토큰을 아무리 잘 만들어도 403이 돌아온다.
그리고 설령 Enterprise였어도 REST에는 노드·스타일을 만드는 엔드포인트가 아예 없어
텍스트 스타일 44종·이펙트 스타일 6종·컴포넌트셋은 못 만든다.

플러그인은 열린 파일 안에서 돌기 때문에 토큰도 플랜 제한도 없고
`figma.variables.*` · `createTextStyle()` · `createComponent()` 로 세 범위를 전부 쓴다.

## 파이프라인

```
tokens/tokens.json ────────────────┐
                                   ├─→ figma/gen-payload.js ─→ figma/build-payload.json ─→ 플러그인
demo/index.html 내장 const SCHEMA ─┘
```

페이로드는 "무엇을 만들지"만 서술한다. 어떻게 만들지는 플러그인이 정한다.
**삭제 지시는 들어가지 않는다** — 페이로드에 없는 기존 변수는 플러그인이 고아로 보고만 한다.

컴포넌트 스키마는 저장소에 별도 JSON 사본을 두지 않는다. 사본을 두면 그 사본이 곧 낡기 때문에,
생성기가 `demo/index.html`의 `const SCHEMA`를 직접 뽑아 쓴다 — 데모가 곧 스키마의 단일 원천이다.
외부 JSON으로 실험하고 싶으면 `--schema x.json`으로 덮어쓸 수 있다.

## 실행

```bash
node figma/gen-payload.js                       # → figma/build-payload.json
node figma/gen-payload.js --brand brand.json    # 연결된 브랜드 색으로 Brand 컬렉션을 채움
node figma/validate-payload.js                  # 별칭·모드·타입 자체 검사
python3 figma/parity-check.py                   # 구 01~06.js 가 만들던 것과 대조
```

## 페이로드 구조

| 키 | 내용 |
|---|---|
| `$meta` | 버전·브랜드 연결 여부·정책(삭제 금지/고아 보고/제자리 개명/dry-run 필수)·경고 |
| `migrations` | v0.4 → v0.77 이관표. 개명 21 · 분할 11 · 이름충돌 4 · 컬렉션 이동 22 · 스타일 개명 38 |
| `collections` | Scale · Brand · Semantic · Radius(3모드) · Web(3모드) |
| `variables` | 305개. 이름·타입·모드별 값 또는 별칭·scopes·codeSyntax |
| `styles` | 텍스트 44 · 이펙트 6 · 미리 로드할 폰트 조합 4 |
| `components` | 23개 컴포넌트셋의 variantAxes · tokenBindings · layout |

## 새 파일용 7컬렉션 배치 — `relayout-payload.js`

`build-payload.json`은 **지금 있는 파일**(5컬렉션)을 갱신하는 용도다.
빈 파일에 처음부터 지을 때는 배치가 다르다 — `relayout-payload.js`가 그 변환을 맡는다.

```
Scale           → Primitive
Brand           → Brand
Semantic(COLOR) → Semantic/color
Semantic(FLOAT) → Semantic/dimension
(신규)          → Semantic/typo      ← tokens.json 의 typography 에서 합성
Radius          → Radius
Web             → Web
```

컬렉션 이름에 슬래시를 넣으면 Figma 가 `Semantic` 그룹 아래로 묶어 준다.
**화면상으로는 4칸으로 보이지만 실제 컬렉션은 7개다** — Figma 컬렉션은 모드축을 하나만 가지므로
Radius(sharp/default/rounded)와 Web(mobile/tablet/desktop)은 한 컬렉션에 같이 못 산다.

`Semantic/typo`는 이 단계에서 새로 생긴다. `tokens.json`의 타이포 키는 굵기가 마지막 마디에 붙어 있는데
(`body/md/400`), 굵기를 떼면 **27개 역할**이 남고 같은 역할 안에서 size·lineHeight·letterSpacing이
굵기마다 달라지는 경우가 하나도 없다 — 그래서 굵기 없는 변수 81개(27×3)로 접힌다.
굵기는 텍스트 스타일 이름에만 남는다.

```bash
node figma/relayout-payload.js       # → figma/build-payload.split7.json (386개)
node figma/validate-payload.js --in figma/build-payload.split7.json
```

이관표(`migrations`)는 넣지 않는다. 빈 파일에는 옮길 기존 변수가 없다.

## 자간은 px 다 (2026-08-05 교정)

`tokens.json`은 단위를 적지 않는다. 초기 생성기는 `letterSpacing`만 `PERCENT`로 가정했는데 이게 틀렸다.

- 같은 자리의 `size`·`lineHeight`는 전부 px다. 자간만 다른 단위일 이유가 없다.
- **CSS `letter-spacing`은 %를 받지 않는다** — %로 읽으면 데모가 렌더할 수 없는 값이 된다.
- %로 읽으면 `-0.4%` × 40px = -0.16px 로 눈에 안 보인다. px로 읽어야 사이즈 대비 약 -1%의 의미 있는 조임이 된다.
- Figma는 바인딩된 FLOAT 변수를 **px로 해석**한다. %인 동안에는 `Semantic/typo`의 자간 변수 27개를 아무도 못 쓴다.

쓰이는 값은 `-0.4`·`-0.2`·`0` 세 가지뿐이고 **소수다**. 바뀐 건 단위지 값이 아니다 —
진짜 정수로 반올림하면 셋 다 0이 되어 자간 토큰이 사라진다.

## 이관표를 왜 따로 두는가

지금 Figma 파일의 변수는 옛 이름이고 Button·Input·Card 레이어가 거기 묶여 있다.
`variable.name`은 쓰기가 가능하므로 **제자리 개명**하면 기존 바인딩이 전부 살아남는다.
새로 만들고 옛것을 지우면 바인딩이 전부 끊긴다.

세 가지 예외가 있다.

- **분할 11건** — `size/icon/md` 하나가 `w/icon/md`·`h/icon/md` 둘로 쪼개진다.
  기존 변수를 `w/*`로 개명하고 `h/*`를 새로 만든 뒤 높이 바인딩만 다시 건다.
- **이름충돌 4건** — 구 스크립트가 맨몸 `bdr/*`와 `comp/bdr/*`를 둘 다 만들어서 네 자리가 겹친다.
  바인딩이 걸린 `comp/bdr/*`를 남기고 값만 갱신하며, 맨몸 쪽은 고아로 보고한다.
- **컬렉션 이동 22건** — Figma 변수는 컬렉션 사이를 못 옮긴다.
  구 `Scale/spacing/*`·`Scale/radius/*`는 개명이 아니라 새 자리의 변수로 다시 바인딩해야 한다.

## 구 스크립트

`01-scale-colors.js` ~ `06-text-styles.js`는 2026-07-21에 실제로 돌려
지금 파일의 278개 변수와 42개 텍스트 스타일을 만든 것이다. 데이터를 손으로 박아 넣은 형태라
v0.77 개명 이후 어긋났다. **생성기가 이들을 대체한다** — 지우지 않고 대조 기준으로 남겨 둔다
(`parity-check.py`가 이 파일들을 읽는다).

## 검증 세 겹

생성기 자체 경고 · 페이로드 자체 검사(`validate-payload.js`) · 구 스크립트 대조(`parity-check.py`).
2026-08-04 기준 결과는 경고 1건(모바일 breakpoint 하한 0 — 의도), 자체 검사 오류 0건,
대조 결과 없어진 항목 0건이다. 값·scopes 불일치 10건은 전부 v0.77에서 의도적으로 바로잡은 것들이다
(`comp/bdr/*` scope 좁힘 6 · 별칭 정정 4).
