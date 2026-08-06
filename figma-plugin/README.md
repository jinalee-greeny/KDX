# Freesm 토큰 빌더 — Figma 플러그인

`figma/build-payload.json` 을 읽어 Figma 파일의 변수와 스타일을 토큰 정의에 맞춥니다.
**아무것도 지우지 않습니다.** 개명은 제자리에서 하고, 정의에 없는 변수는 고아로 보고만 합니다.

---

## 왜 플러그인인가

Figma REST API 로는 이 일을 할 수 없습니다.

- 변수 쓰기(`file_variables:write`)는 Enterprise 플랜 전용입니다.
- 텍스트·이펙트 스타일은 REST 로 만들 수 없습니다.

그래서 **열려 있는 파일 안에서 도는 플러그인**이 유일한 길입니다.

---

## 설치

1. Figma 데스크톱 앱을 엽니다. (브라우저 버전은 로컬 플러그인을 못 불러옵니다.)
2. 메뉴 → `Plugins` → `Development` → `Import plugin from manifest…`
3. 이 폴더의 `manifest.json` 을 고릅니다.
4. 토큰을 넣을 파일을 열고 → `Plugins` → `Development` → **Freesm 토큰 빌더**

파일은 셋뿐입니다.

| 파일 | 하는 일 |
|---|---|
| `manifest.json` | 플러그인 등록 정보 |
| `code.js` | 실제 작업 — 파일 상태 읽기, 차이 계산, 적용 |
| `ui.html` | 세 화면 |

---

## 세 화면

### 1 · 페이로드

`figma/build-payload.json` 의 내용을 넣습니다. 두 가지 방법이 있습니다.

- **붙여넣기** — 파일을 열어 전체를 복사해 텍스트 상자에 붙입니다. 네트워크를 쓰지 않습니다.
- **URL 불러오기** — 페이로드를 어딘가에 올려 두었다면 주소를 넣습니다.

넣는 즉시 JSON 을 검사해 컬렉션·변수·스타일 개수를 보여 줍니다. 숫자가 예상과 다르면
그 자리에서 멈추면 됩니다.

### 2 · 차이 (dry-run)

**적용하기 전에 반드시 거치는 화면입니다.** 파일을 읽기만 하고 아무것도 바꾸지 않습니다.

- 신규 / 값변경 / 개명 / 분할 / 변화없음 / 고아 를 숫자로 먼저 보여 주고,
- 각 항목을 펼치면 이름 하나하나까지 볼 수 있습니다. 색은 견본과 함께 옛 값 → 새 값으로 나옵니다.

여기서 숫자가 이상하면 — 특히 **개명이나 고아가 예상보다 많으면** — 적용하지 말고
페이로드를 다시 만드십시오. 개명은 되돌리기 어렵습니다.

### 3 · 적용

한 줄씩 진행 상황이 흐르고, 끝나면 요약과 문제 목록이 남습니다.
순서는 항상 이렇습니다.

```
컬렉션·모드 → 개명 → 분할 → 변수 생성 → 값·스코프 주입 → 스타일
```

변수를 **값 없이 먼저 다 만든 뒤** 값을 넣는 이유는, 별칭이 가리킬 대상이 그때는 이미
전부 존재해야 하기 때문입니다.

---

## 네 가지 원칙

**삭제 없음.** 어떤 경우에도 변수·스타일을 지우지 않습니다. 정의에 없는 것은 고아 목록에
이름만 올립니다. 정말 지울지는 사람이 판단합니다.

**개명은 제자리.** `variable.name` 을 고칩니다. Figma 의 바인딩은 이름이 아니라 ID 로
걸려 있으므로, 이렇게 하면 그 변수를 쓰던 모든 곳이 그대로 살아 있습니다.
지우고 새로 만들면 전부 끊어집니다.

**dry-run 필수.** 차이 화면을 보지 않고는 적용 단추가 열리지 않습니다.

**컴포넌트는 만들지 않습니다.** Figma 는 토큰의 집이지 컴포넌트의 집이 아닙니다.
페이로드의 `components` 는 명세 목록으로 보여 줄 뿐입니다.

---

## 안전장치 — 이관표 자기 검사

개명표는 "옛 이름 → 새 이름"입니다. 이 표가 틀리면 **살아 있는 변수를 이름 없는 곳으로
밀어냅니다.** 실제로 생성기에 그런 버그가 있었습니다 — `radius/2xs` 를
`radius/undefined` 로 개명하는 항목이 두 건 있었고, 그대로 돌렸다면 두 변수가 이름을
잃었을 것입니다.

그래서 지금은 두 곳에서 막습니다.

- **생성기(`gen-payload.js`)** — 위험한 항목이 하나라도 있으면 페이로드를 아예 만들지 않고 멈춥니다.
- **플러그인** — 남이 만든 페이로드도 받을 수 있으므로 여기서 한 번 더 봅니다. 위험한 항목은
  `거부` 로 표시하고 건너뜁니다.

거부 조건은 셋입니다.

1. 새 이름이 비어 있거나 `undefined` 로 끝난다.
2. 옛 이름이 페이로드에도 **정규 이름으로** 들어 있다. (개명하면 현행 변수가 사라집니다.)
3. 분할인데 결과 이름이 하나뿐이다.

---

## 손으로 처리해야 하는 것

플러그인이 할 수 없는 일이 셋 있습니다. 전부 화면에 목록으로 나오지만, 실행은 사람 몫입니다.

### 1 · 컬렉션 이동 22건

**Figma 는 변수를 다른 컬렉션으로 옮기지 못합니다.** API 에도 UI 에도 방법이 없습니다.
새 컬렉션에 같은 이름으로 만들고, 쓰던 곳을 다시 연결한 뒤, 옛 것을 지우는 수밖에 없습니다.

| 옛 자리 | 지금 자리 |
|---|---|
| `Scale/spacing/0` | `Semantic/spacing/0` |
| `Scale/spacing/25` | `Semantic/spacing/25` |
| `Scale/spacing/50` | `Semantic/spacing/50` |
| `Scale/spacing/75` | `Semantic/spacing/75` |
| `Scale/spacing/100` | `Semantic/spacing/100` |
| `Scale/spacing/125` | `Semantic/spacing/125` |
| `Scale/spacing/150` | `Semantic/spacing/150` |
| `Scale/spacing/200` | `Semantic/spacing/200` |
| `Scale/spacing/250` | `Semantic/spacing/250` |
| `Scale/spacing/300` | `Semantic/spacing/300` |
| `Scale/spacing/400` | `Semantic/spacing/400` |
| `Scale/spacing/500` | `Semantic/spacing/500` |
| `Scale/spacing/600` | `Semantic/spacing/600` |
| `Scale/spacing/800` | `Semantic/spacing/800` |
| `Scale/radius/2xs` | `Radius/radius/2xs` |
| `Scale/radius/xs` | `Radius/radius/xs` |
| `Scale/radius/s` | `Radius/radius/sm` |
| `Scale/radius/m` | `Radius/radius/md` |
| `Scale/radius/l` | `Radius/radius/lg` |
| `Scale/radius/xl` | `Radius/radius/xl` |
| `Scale/radius/2xl` | `Radius/radius/2xl` |
| `Scale/radius/full` | `Radius/radius/full` |

옛 파일에 `Scale/spacing/*` 이나 `Scale/radius/*` 가 남아 있다면 고아로 보고됩니다.
위 표대로 옮긴 뒤에 지우십시오.

### 2 · Radius 컬렉션의 기본 모드

`collection.defaultModeId` 는 읽기 전용입니다. Radius 의 기본 모드는 `default`(두 번째)여야
하는데 플러그인이 바꿀 수 없으므로, Figma 변수 패널에서 손으로 지정해 주십시오.
차이 화면의 경고에도 같은 내용이 뜹니다.

### 3 · 이름충돌 4건

`bdr/default` · `bdr/subtle` · `bdr/subtler` · `bdr/strong` 이 각각
`comp/bdr/*` 과 겹칩니다. 플러그인은 `comp/bdr/*` 을 살리고 값만 갱신하며,
겹치는 쪽은 고아로 보고합니다. 아직 쓰는 곳이 있는지 확인한 뒤에 지우십시오.

---

## 페이로드는 어떻게 만드나

```bash
node figma/gen-payload.js
```

`tokens/tokens.json` 과 데모의 `SCHEMA` 를 읽어 `figma/build-payload.json` 을 씁니다.
페이로드는 **무엇을** 만 담고 **어떻게** 는 담지 않습니다. 삭제 지시는 아예 들어 있지 않습니다.

현재 규모:

```
컬렉션 5 · 변수 305 (Scale 131 · Brand 14 · Semantic 126 · Radius 24 · Web 10)
이관표 — 개명 19 · 분할 11 · 이름충돌 4 · 컬렉션 이동(개명 불가) 22 · 스타일 개명 35
텍스트 스타일 44 · 이펙트 스타일 6 · 폰트 조합 4 · 컴포넌트 23
```

---

## 알아 둘 것

- **폰트.** `Pretendard Variable` 과 `Inter` 를 씁니다. 없는 폰트는 오류가 아니라 문제 목록에
  기록되고, 그 폰트를 쓰는 텍스트 스타일만 건너뜁니다.
- **타입 불일치.** Figma 는 변수의 타입을 바꾸지 못합니다. `COLOR` 여야 할 것이 `FLOAT` 로
  되어 있다면 보고만 하고 건너뜁니다. 손으로 지우고 다시 만드십시오.
- **스코프.** 페이로드에 스코프가 없으면 `ALL_SCOPES` 를 넣습니다. 빈 배열은 어떤 속성
  선택기에도 안 뜨므로 위험합니다.
- **멱등성.** 같은 페이로드를 두 번 돌려도 두 번째는 전부 "변화 없음"이 됩니다.
- **네트워크.** 붙여넣기만 쓰면 네트워크를 전혀 쓰지 않습니다. `networkAccess` 는 URL
  불러오기 때문에만 열어 두었습니다.
