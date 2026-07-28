# KDX 디자인 시스템 — Claude Code 작업 지침

> 데모 워크벤치의 제품명은 **Freesm**이다 — Free + 프리즘 발음의 조어(브랜드 미확정 상태로부터 자유로운 시스템, 시드 하나 → 전체 분광). 파일명·경로는 기존 유지.

KDX 기업 홈페이지용 디자인 시스템이다. ALTO(KDX의 조각투자 MTS) 파운데이션을 승계해
**토큰 우선(tokens-first)**으로 재구축했고, Figma 변수 라이브러리 구축까지 완료된 상태다.
이 폴더는 그 결과물(토큰 + 스펙 + 레퍼런스)을 코드로 넘기기 위한 핸드오프 패키지다.

## 지금까지 된 것 (DONE)
- Figma 변수 라이브러리 구축 완료 — 5개 컬렉션 / 총 278 변수.
- 토큰 코드 익스포트: `tokens/tokens.css`(즉시 사용) + `tokens/tokens.json`(기계판독).
- 반응형 브랜드 스왑 데모(`reference/brand-swap-demo.html`)로 동작 검증.

## 아키텍처 (5 레이어 · 절대 원칙)
```
Scale(원시)  →  Brand(교체 지점)  →  Semantic(의미)  →  Radius(곡률 모드)  →  Web(반응형)
```
1. **Scale** — 브랜드 무관 원시 원자. `color/*`(gray·blue·red·orange·green·purple + alpha) + `dimension/*`(0~64px). **수의 유일 프리미티브는 dimension.**
2. **Brand** — ★교체 지점★. `color/primary/*` 램프 + `brand/font/*` + 에셋. **현재 Primary는 임시 Deep Blue `#1245BA`(placeholder).** 실제 브랜드 확정 시 이 레이어만 바꾸면 전체가 캐스케이드된다.
3. **Semantic** — 의미 토큰(총 109). 색 71 + 수치 38. 전부 Scale/Brand에 **별칭(alias)**. accent·link·focus·강조배경은 `brand/*`를 참조한다.
4. **Radius** — 곡률. `sharp / default / rounded` **3개 모드**. Figma 변수는 곱셈이 안 되므로 배율 대신 모드로 곡률 성격을 교체한다.
5. **Web** — 반응형. `mobile / tablet / desktop` 3단계(모바일 1st). breakpoint·container·grid·section 리듬·display 사이즈.

## 반드시 지킬 규칙 (INVARIANTS — 어기면 시스템이 깨진다)
1. **동일 값이어도 맥락이 다르면 토큰을 분리 유지한다. 절대 병합하지 마라.** 지금 값이 같아도 모드/맥락에 따라 독립적으로 갈라질 수 있다. (예: `fg/subtlest`와 `fg/faint`, `comp/fill/inverse/default`(모드 인식)와 `static/white`(고정)는 값이 겹쳐도 별개다.)
2. **수치도 색과 동일한 구조로 다룬다.** spacing·size·border는 `dimension`에, `comp/pad`·`comp/gap`은 다시 `spacing`에 별칭(2단 캐스케이드). 하드코딩 px 금지 — 항상 토큰 var를 쓴다.
3. **곡률은 모드 스왑으로만 바꾼다.** `[data-radius="sharp|default|rounded"]`. 개별 컴포넌트는 `comp/radius/*`만 물린다.
4. **브랜드 교체는 Brand 레이어 한 곳에서만.** 컴포넌트/시맨틱에 브랜드 색을 직접 박지 마라.
5. **차트 등락색은 브랜드 무관 고정** — 상승=빨강, 하락=파랑, 보합=회색(한국 증시 관례). 브랜드를 바꿔도 이 색은 고정이다.
6. **serif 제외.** 서체는 `var(--brand-font-display|text)`(현재 Pretendard Variable)만.
7. **모바일 우선 · 3 breakpoint**(tablet 768 / desktop 1024, min-width 기준).

## 토큰 사용법 (tokens.css)
```html
<html data-brand="deepblue" data-radius="default"> <!-- 브랜드·곡률 모드 선택 -->
<link rel="stylesheet" href="tokens/tokens.css">
```
```css
.btn-primary{
  background: var(--comp-fill-accent-primary);   /* → brand primary/50 */
  color:      var(--static-white);
  padding:    var(--comp-pad-button-y) var(--comp-pad-button-x);  /* → spacing → dimension */
  border-radius: var(--comp-radius-button);       /* → radius/m (현재 모드값) */
  min-height: var(--size-control-m);              /* 44px */
  font:       600 var(--body-m) / 1.5 var(--brand-font-text);
}
.section{ padding-block: var(--space-section); }  /* 반응형: 64→96→120 자동 */
```
- **브랜드 스왑**: `data-brand` 값 변경 또는 Brand 레이어 값 교체 → accent/link/focus/강조배경 전체 반영.
- **곡률 스왑**: `data-radius` 값 변경 → 전 컴포넌트 곡률 동시 전환.
- **반응형**: `--container-*`, `--grid-*`, `--space-*`, `--web-display-*`는 미디어쿼리로 자동 전환.
- 명명 규칙: Figma 변수명의 `/`를 `-`로 바꾼 것이 CSS 변수명이다. (`comp/fill/accent/primary` → `--comp-fill-accent-primary`)

## 다른 포맷이 필요하면
- **Tailwind**: `tokens/tokens.json`을 읽어 `tailwind.config`의 `theme.extend`(colors/spacing/borderRadius/fontSize)로 매핑. 색은 semantic 이름을, 수치는 `dimension`/`spacing`을 키로.
- **Style Dictionary / DTCG**: `tokens.json`의 alias 관계를 `{scale.color.gray.100}` 형태 참조로 변환.
- 변환이 필요하면 이 규칙대로 새 빌드 스텝을 추가하되, 위 INVARIANTS를 반드시 유지할 것.

## 파일 맵
- `tokens/tokens.css` — 계층 CSS 변수(Scale→Brand→Semantic→Radius→Web + shadow). **주 소비 대상.**
- `tokens/tokens.json` — 기계판독 토큰(별칭·모드·스코프·타이포 메타 포함).
- `reference/blueprint.html` — 변수 컬렉션 청사진(v0.4). 각 토큰의 별칭·모드를 시각적으로 확인.
- `reference/brand-swap-demo.html` — 브랜드 스왑 + 반응형 + 프리셋 토큰 조절 데모. **홈페이지 구현의 동작/구조 레퍼런스.**
- `reference/architecture.md` — 아키텍처 상세 + 열린 결정.
- `figma/01~06*.js` — Figma 플러그인(use_figma) 빌드 스크립트. Figma 라이브러리를 재현/확장할 때 순서대로 실행.

## 열린 결정 (OPEN — 진행 전 확인 필요)
- **`brand/shape/radius-scale` 고아 변수**: 곡률이 모드 방식으로 이관되면서 사용처가 없어짐. (A) 삭제 / (B) "브랜드→권장 Radius 모드"를 지정하는 힌트로 재정의. 데모는 B(권장값 힌트)로 두고 곡률은 프리셋에서 직접 선택 중.
- **Semantic Dark 모드**: 구조는 잡혀 있으나 다크 값 미추출. 진행 시 dark 값 정의 필요.

## 모듈 레이어 (범용 재사용 섹션)
컴포넌트(원자/분자) 위, 페이지 아래에 **모듈** 계층이 있다. 컴포넌트를 조립한 **재사용 섹션**이며 페이지의 구성 단위다. 데모의 좌측 탐색 → **모듈** 그룹에서 각 모듈을 개별 문서로 확인한다.
- 현재 모듈: `header(GNB)` · `hero` · `stats(통계 밴드)` · `steps(이용 절차)` · `products(상품 리스트)` · `features(특징 카드)` · `cta` · `footer` + 범용 `logowall(로고월)` · `faq`.
- **레이아웃(Grid·Carousel·List)은 전역 설정이 아니라 `상품 리스트` 모듈의 변형(variant)이다.** `[data-layout]`를 모듈 컨테이너에 걸어 `.plist`/`.pcard` 구조를 전환한다. 레이아웃 같은 배치 성격은 그 배치를 갖는 모듈에 귀속시킨다(전역 노브로 두지 않는다).
- 모든 모듈은 곡률·간격·보더·크기 노브와 Brand 스왑을 실시간 반영한다(반응형은 `@container page`).
- 새 범용 모듈 추가 시: 데모 `M`(마크업)·`MOD_META`(문서)·`MOD_ORDER`·좌측 탐색 nav-item에 각각 등록. 신규 섹션 CSS는 토큰 var만 사용(하드코딩 px 금지).

## 예시 화면 — 화면 조립기 (v0.49)
데모의 **예시 화면** 영역(GNB `pages`)이 고정 샘플 3종(홈·로그인·회원가입)에서 **사용자가 직접 화면을 쌓아 보는 조립기**로 확장됐다. 모듈 레이어가 "섹션 하나를 문서로 본다"면, 여기는 "그 섹션들을 실제 화면 순서로 쌓아 본다"에 해당한다.
- **셀(cell)이 단위다.** 화면은 `screens[{id,name,secs:[key,…]}]`(인메모리) 배열이고, 렌더는 `.page > .inner` 안에 `secs`를 순서대로 `<div class="cell">`로 감싸 붙인다. `.inner`는 좌우 패딩만 갖고 섹션 여백(`.foot`·`.ctaband`의 `margin-top:var(--sect)`)은 래퍼를 그대로 통과하므로, 셀 래핑이 기존 레이아웃을 바꾸지 않는다. 컨테이너 쿼리도 `.frame`의 named container `page`에 그대로 물린다.
- **선택 가능한 섹션 26종** = 기존 모듈 `M` 10종 + 신규 `PSEC` 16종(`pagehead·filter·pager·pdetail·pspec·notice·terms·contact·pricing·evhero·events·coupon·mysum·holdings·empty·e404`). `SEC=Object.assign({},M,PSEC)`로 합치고 `SEC_META`(이름·설명), `SEC_GROUPS`(6개 그룹: 공통 / 목록·탐색 / 상세·정보 / 문서·폼 / 이벤트·프로모션 / 마이·상태)로 고르기 모달을 구성한다.
- **화면 템플릿 11종**(`SCR_TPL`): 상품 목록 · 상품 상세 · 이벤트 · 약관·정책 · 공지사항 · 마이페이지 · 요금 안내 · 고객지원·문의 · 프로모션 랜딩 · 404 오류 · 빈 화면부터.
- **빈 페이지를 만들지 않는다(설계 원칙).** 새 화면은 반드시 섹션이 채워진 상태로 열린다 — `SCR_TPL`의 모든 항목이 `secs.length>=1`이고, 가장 비어 있는 '빈 화면부터'도 `header+pagehead` 2셀로 시작한다. 사용자가 셀을 전부 지워도 백지 대신 `.cellzero` 안내("이 화면에는 아직 섹션이 없습니다" + `＋ 첫 섹션 추가`)가 자리를 지킨다. 두 조건 모두 `verify49.js`가 검사한다.
- **편집 동선**: 셀에 마우스를 올리면 `.cellbar`(섹션 이름 · ↑ · ↓ · 복제 · 아래에 추가 · 삭제). 화면 상단 `#scrBar`에 `＋ 섹션 추가` · `화면 추가` · `이 화면 삭제`. 탭 스트립(`renderPgTabs`)은 기본 3종 + 사용자 화면(각각 ✕ 삭제) + `＋ 화면 추가`로 매 라우팅마다 다시 그린다. 마지막 화면을 지우면 홈으로 복귀한다.
- **레이아웃 컨트롤의 자리**: 상품 리스트의 Grid·Carousel·List는 전역 노브가 아니므로(위 모듈 레이어 원칙) 화면에 `products` 섹션이 들어 있을 때만 `#scrBar`에 `[data-sb-lay]` 세그먼트로 나타난다. 곡률·간격·보더·크기·디바이스·Brand는 기존 노브가 `screenEl`에도 그대로 전파된다.
- **주의**: 데모 스크립트에는 브랜드 인제스트 쪽에 `function pickMode(...)`가 이미 있다. 화면 고르기 상태 변수는 `pickKind`를 쓴다(같은 이름을 쓰면 `Identifier already declared`로 스크립트 전체가 죽는다).
- 새 섹션 추가 시: `PSEC`(마크업) · `SEC_META`(이름·설명) · `SEC_GROUPS`(어느 그룹인지) 세 곳에 등록하고, 필요하면 `SCR_TPL`에 템플릿을 추가한다. CSS는 토큰 var만 사용.

## 추천 다음 작업 (NEXT)
1. 기초 컴포넌트를 토큰 바인딩으로: **Button**(primary/secondary/ghost · S/M/L · hover/press/disabled) → **Input/Field** → **Card** → **Chip/Badge**. (데모에 정식화 완료)
2. 모듈을 실제 홈페이지 코드로: 위 모듈 레이어를 컴포넌트 단위로 마크업/구현하고, 페이지는 모듈을 조립해 구성. 배치 변형은 모듈 속성으로.
3. Dark 모드 값 추출 후 Semantic에 두 번째 모드 추가.

## 브랜드 인제스트 (URL·Figma·PDF → Brand 레이어 자동 세팅)
브랜드 소스를 연결하면 Brand 레이어(교체 지점)에 맞춰 세팅하는 워크플로우. 두 단계로 나뉜다.
1. **소스 해석 (에이전트 세션에서)**: URL(사이트에서 주요 컬러·서체·곡률 성격 추출) / Figma(MCP로 변수·스타일 직접 읽기 — 충실도 최고) / PDF(브랜드 가이드에서 hex·폰트명 추출) → **시드 컬러 + 폰트**로 정리.
2. **램프 생성·적용 (데모 내장)**: 데모 인스펙터 Brand 그룹의 **커스텀 패널**에 시드 hex 입력, 폰트는 내장 목록(Pretendard·웹폰트 온디맨드·시스템 서체) 또는 **파일 업로드(OTF·TTF·WOFF, FontFace API)**로 선택 → HSL 기반으로 05~70 램프 자동 생성(수제 램프의 명도 곡선 근사: 05·10·20 라이트 / 40 비비드 / 55·60·70 다크) → `[data-brand="custom"]`로 주입, 4번째 브랜드로 전체 캐스케이드. p50의 흰 텍스트 대비(AA 4.5) 자동 검사. 비교 매트릭스에도 4번째 열로 합류.
- 코드 반영 시: 생성된 램프를 `tokens.css`의 `[data-brand]` 블록과 Brand 컬렉션 값으로 옮기면 된다(구조 동일). 램프 생성 로직은 데모의 `genRamp()` 참조.
- **제품 내장(1단계)**: 데모 GNB의 **'브랜드 연결'** 모달. 파일(이미지→채도 가중 주요색, 폰트→FontFace 등록)·텍스트(hex/font-family 추출)는 클라이언트에서 즉시 동작. URL·Figma 탭은 `api/ingest.js`(Vercel 서버리스)가 해석 — URL은 HTML+링크된 CSS에서 컬러·폰트 수집(theme-color 가중), Figma는 REST API로 채움색 수집(**환경변수 FIGMA_TOKEN 필요**). 추출 후보 중 시드 선택→커스텀 브랜드 파이프라인으로 연결.
- **Primary 판별 원칙(v0.37 — 혼합 스코어가 아닌 명시적 우선순위 계층)**: **1순위 선언** — 사이트가 스스로 선언한 브랜드 색(theme-color·msapplication-TileColor 메타, `--primary/--brand/--accent/point/key-color/main-color` 변수). 유효(유채색)하면 무조건 승. **2순위 로고 마크** — favicon·apple-touch-icon만(og:image는 콘텐츠 이미지라 제외). 유채색 비율 ≥2%일 때만 인정(흑백 로고는 통과). **3순위 사용 통계(v0.39 보강)** — '화면에 실제 등장한 색(HTML)'을 CSS 번들 색보다 **×10 가중**(번들은 toastify류 라이브러리 상태색까지 담긴 '가능성의 창고'라 노이즈). 스코어=빈도(√)×채도×명도 적합도×대비 적합도(**소프트**, 하한 0.25 — 네온 그린·옐로처럼 흰 텍스트 대비가 낮은 브랜드색을 결격시키지 않음. AA는 적용 후 별도 경고). 폴백 전용. 판별 근거와 후보별 출처(선언/로고/CSS)를 UI에 명시. **형태 분석**은 별도(v0.40): border-radius·padding(Figma는 cornerRadius·itemSpacing)을 **사용 빈도 기반**으로 — 모드 버킷(sharp/default/rounded, compact/default/comfortable)별 등장 횟수를 집계해 **다수 버킷 채택**(중앙값 아님 — 리셋 0 같은 노이즈에 강함), 근거로 최빈값·버킷 점유율 표기 → 프리셋 자동 적용.
- **URL 수집 견고화 + 북마클릿(v0.41)**: 서버 `fget()` — 데스크톱 Chrome UA 기본, 403/429/503 시 모바일 UA 재시도, 8초 타임아웃, 실패 시 북마클릿 안내 문구. **Freesm 스캔 북마클릿** — 대상 페이지에서 computed style 실측(색 빈도·radius·padding·폰트·theme-color·브랜드 변수) → JSON 클립보드 복사 → 데모 파일·텍스트 탭에 붙여넣으면 자동 인식(판별 근거 "북마클릿 실측"). 봇 차단·로그인·SPA 렌더 사이트의 최종 우회로.
- **분석 기준 패널(v0.42)**: '브랜드 연결' 모달 헤더의 **분석 기준** 토글 — Primary 3계층, 형태 빈도 버킷, 폰트, 램프·접근성, 그라디언트, 소스별 신뢰도를 데모 안에서 바로 확인(문서 없이도 판별 근거가 설명됨).
- **그라디언트 브랜드 지원(v0.43 — 정식 토큰 + 제한된 사용)**: 인스타그램처럼 브랜드 색 자체가 그라디언트인 경우를 소화. 수집(텍스트·CSS / 북마클릿 `grads` / `api/ingest` `gradients`) → **정지점 2개 이상 유채색**일 때만 브랜드 그라디언트로 인정(흰↔검 페이드·투명 오버레이 제외), 빈도×유채 정지점 수×멀티 휴(Δhue≥20°) 가중으로 대표 선정 → **`--brand-gradient` 토큰으로 승격**(`--accent-gradient` 시맨틱 별칭). 적용은 **면 한정** — `html[data-gradient="on"]` 스코프에서 CTA 버튼·로고 마크·히어로 배경·바 차트만. **텍스트·보더·포커스는 솔리드 Primary 유지**, 그 시드는 **흰 텍스트 대비 3:1을 통과한 정지점 중 스코어 최고값**(인스타그램 → 오렌지 #FA7E1E가 아니라 마젠타 **#D62976**, AA 4.73). CSS 주입 방지를 위해 방향은 화이트리스트(`to <side>`·`<n>deg`, 기본 135deg)만 통과시키고 정지점 hex로 **재직렬화**해 주입. 인스펙터에 그라디언트 프리뷰 + 적용/해제 스위치.

- **그라디언트 수집 경로 확대(v0.44)**: v0.43은 CSS `*-gradient(` 문자열만 봤기 때문에 그라디언트가 CSS에 없는 브랜드(로고 SVG에만 있거나, PDF 가이드에 hex 나열로만 적힌 경우)는 잡히지 않았다. 수집 순서를 **CSS → SVG defs → 텍스트 프로즈**로 확대. ① **SVG** — `<linearGradient>`/`<radialGradient>`의 `stop-color`(속성·`style=` 양쪽), `stop-opacity<.5` 정지점 제외, `x1/y1/x2/y2`에서 각도 산출. 로고 SVG 파일 업로드도 텍스트로 읽어 처리. ② **텍스트** — CSS·SVG가 하나도 없을 때만, 줄 단위로 '그라디언트/그라데이션/gradient' 키워드가 있으면 hex 2개, 없으면 hex 3개 이상 나열된 줄을 후보로. ③ **CSS 명명색**(`orange`·`purple` 등 37종) 지원. 북마클릿은 `bv:2`로 올리며 페이지 내 SVG 그라디언트도 함께 수집(구버전 북마클릿 JSON이면 경고 표시). 서버 `api/ingest.js`도 인라인 SVG + SVG 파비콘의 defs를 원문 그대로 `gradients`에 실어 보낸다(판별·정규화는 클라이언트 단일 경로 유지). 결과 패널에 **출처 라벨**(CSS/SVG/텍스트) 표기. 더불어 `data-gradient`를 커스텀 브랜드에 한정 — 다른 브랜드로 스왑하면 면 적용이 꺼진다(램프 기본 그라디언트 누출 방지).

- **화면 캡처(스크린샷) 인식 · 신뢰도 게이트(v0.45)**: "URL이 막히면 자동 스크린 캡처로 분석할 수 있나"를 실측으로 검토한 결과 — ① 자동 캡처는 봇 차단을 **풀지 못한다**(Vercel 헤드리스 브라우저도 같은 데이터센터 IP로 막힌다). ② 캡처가 되더라도 **전체 화면 픽셀 빈도로는 브랜드 색을 찾지 못한다**: 합성 스크린샷 6종 실측에서 corporate → `#C09048`(4.0%) vs 정답 `#1245BA`, feed → `#4890C0`(1.1%) vs 정답 `#D62976`으로 오답. 해상도를 64 → 160 → 320px로 올려도 결과가 **바뀌지 않아** 샘플링이 아니라 구조적 한계임이 확인됐다(콘텐츠 사진이 면적을 지배). ③ 브라우저를 띄울 수 있다면 픽셀이 아니라 **computed style**을 뽑는 게 옳다 — 그게 북마클릿이 이미 하는 일이다. 그래서 자동 캡처 대신 **기존 이미지 업로드 경로를 구조 신호 2개로 보강**했다. **(a) 상단 UI 구간 하드 크롭** — 위에서 아래로 행을 훑어 한 행의 서로 다른 양자화 유채색 수가 8을 넘는 지점(사진 시작)을 헤더 끝으로 보고 안전 1행을 뺀 뒤 그 위만 분석. 가중치(weighting)로는 사진 픽셀 질량(≈30,000px)을 버튼(≈140px)이 이길 수 없어 **크롭**이어야 한다. **(b) 내부 면적 점수** — `score = n × chroma² × max(0.08, 1−edge)`, `edge`는 해당 색 픽셀이 중성·제외 픽셀과 인접한 비율. 안티에일리어싱 경계색(edge≈1.0인 파스텔 프린지)이 1위로 올라오는 문제를 막는다. **신뢰도 등급**: `high`(n≥30 && 점유≥0.4) · `mid`(n≥12 && (점유≥0.2 ‖ 2위 대비 ≥2배)) · 그 외 `low`, 헤더 크롭이 실패해 전체 화면으로 폴백하면 무조건 `low`. 결과 패널에 `#igWarn` 배너로 등급별 안내를 **감추지 않고** 노출하고, 판별 근거 문자열은 `화면 캡처 추정 — 상단 UI 구간 분석 · 신뢰도 …`. 입력 분기는 **700×400 이상이면 스크린샷 경로, 미만이면 기존 로고 경로**(`imgDominant`). 그라디언트 로고는 `shotGrad()`가 후보 3개 이상·채도≥60·`edge`<0.9·최대 휴 스프레드≥60°일 때만 추정하고 출처를 `화면 캡처(추정)`로 표기. 합성 6종 회귀: corporate `#1848C0`(높음) · branded `#1848C0`(높음) · dark `#00F060`(보통) · feed `#C03078`(낮음) · photoHero `#F06018`(낮음) · logo는 512×512라 로고 경로로 `#D83078` — 6/6 정답. 단, 합성 스크린샷 기준 튜닝이므로 실제 캡처(JPEG 노이즈·복잡한 사진)에서는 게이트가 더 보수적으로 걸릴 수 있다. 검증 스크립트는 `verify45.js`.

- **URL 입력 관문 제거(v0.46)**: `^https?://` 정규식으로 막고 "http(s)로 시작하는 URL을 입력하세요"를 띄우던 검사를 없앴다. 스킴을 손으로 붙이게 하는 건 사람의 편의가 아니라 정규식의 편의다. `normalizeUrl()`이 ① 공백·따옴표 제거 ② 스킴 오타 교정(`htp://`·`https:/`·`ttps://`·`hhttps://` → 뒤에 콜론이나 슬래시가 올 때만 매치시켜 `ttps.co.kr` 같은 실제 호스트명은 건드리지 않는다) ③ 스킴이 없으면 `https://` 자동 부착 ④ `new URL()` 파싱 후 호스트명에 점이 최소 하나 있는지 확인. `javascript:`·`ftp:` 등 다른 스킴은 거절하되 `host:8080`의 포트 콜론은 통과시킨다(`:(?!\d)`). 보정된 주소는 입력창에 다시 써서 무엇으로 요청했는지 보이게 하고, **Enter 키로도 실행**된다. 거절 메시지는 규칙이 아니라 예시를 준다 — "도메인만 입력해도 됩니다 — 예: instagram.com".

- **해석 지침 정리 · 그라디언트 채택 게이트(v0.47)**: "네이버를 해석했는데 핑크 그라디언트가 들어온다"는 보고를 재현 하네스(`/tmp/diag.js`)로 그대로 재현하고 원인을 특정했다 — `parseGradients(...)[0]`이 **페이지 어디서 발견됐든 최고점 그라디언트를 무조건 `--brand-gradient`로 승격**했고, 그 시드가 `declared` 배열에 합쳐져 **로고 마크보다 앞선 Primary 후보**가 됐다. 즉 시스템에 *"이 페이지에는 브랜드 그라디언트가 없다"*는 상태 자체가 없었다. 고친 규칙은 다음과 같다. **① 기본값은 '없음'** — `gradAccept()`가 증거를 통과한 그라디언트만 승격한다. **② 맥락 증거** — 선언 지점 앞 200자를 읽어 `--brand-*`·`--primary-*` 변수이거나 `.logo`·`.btn`·`.cta`·헤더 같은 브랜드 표면이면 `ctx=1`, `.promo`·`.event`·`.banner`·`.skeleton`·`.shimmer` 류면 `ctx=-1`로 **즉시 기각**. **③ 색 계열 정합** — 선언값·로고 마크로 Primary가 확정됐다면 정지점 하나가 그 색과 **휴 40° 이내**여야 한다. Primary 자체가 CSS 사용 통계·스크린샷 추정이면 잣대로 쓰지 않는다(추정으로 추정을 검증하는 순환 방지). **④ 근거량** — 맥락이 없으면 **2곳 이상 반복** 또는 **참조된 로고 SVG 안**이어야 한다. **⑤ 2패스 판정**(`igResolveGrad`) — 그라디언트를 뺀 채 Primary를 먼저 확정하고 그 Primary를 잣대로 게이트를 돌린다. **⑥ 계층 재정렬** — `igResolve`에 `gradCands`를 추가해 **선언 > 로고 마크 > 그라디언트 시드 > 사용 통계** 순으로 고정했다(그라디언트가 로고를 이길 수 없다). **⑦ SVG 참조 검사** — `<linearGradient>`가 `url(#id)`로 실제 참조될 때만 인정한다(defs에 정의만 된 죽은 코드 제외). **⑧ `shotGrad()` 제거** — 스크린샷에서의 그라디언트 추정은 근거가 없다. '상단에 고채도 색이 여러 개 흩어져 있다'는 컬러 아이콘 줄·태그 칩·썸네일이 모두 만드는 패턴이고, 픽셀에는 색 사이가 보간인지 경계인지가 남지 않는다. **⑨ 기각도 결과다** — 무엇을 찾았고 왜 안 썼는지를 패널에 그대로 쓰고 **수동 적용** 버튼으로 사람이 뒤집게 한다. **⑩ 저신뢰 자동 적용 보류** — 스크린샷 신뢰도가 `low`면 Primary를 자동 적용하지 않고 후보만 제시한다. **⑪ 북마클릿 bv:3** — 그라디언트를 `sel{background-image:...}` 형태로 **선언 요소의 태그·id·클래스와 함께** 보내고, SVG 그라디언트는 참조된 것만 보낸다. 구버전(bv<3) 결과는 판별이 보수적으로 동작한다고 안내한다. 검증은 `verify47.js`(7 케이스: 네이버형 프로모션 기각 · 인스타형 로고 채택 · 브랜드 동일계열 채택 · 단독 장식 기각 · SVG 미참조 기각 · SVG 참조 채택 · 스켈레톤 기각, + 수동 승격 · bv3 freesm 채택/기각 · 일반 CSS 회귀) 전부 통과, `verify45.js`·`verify43.js` 회귀 통과.

- **분석 결과 나래비 · 그라디언트 오탐/미탐 정리(v0.48)**: v0.47의 게이트가 반대 방향으로 과교정돼 "그라디언트를 아예 못 읽는다"는 보고가 들어왔고, 세 가지 결함을 각각 특정했다. **① 거짓 음성의 주범 — `GRAD_CTX_NEG`의 `ad` 부분일치.** 반대 증거 정규식이 `[.#][\w-]*(…|ad|…)[\w-]*` 형태여서 `.header`·`.gradient`·`.shadow`·`.download`·`.leaderboard`가 전부 매칭됐고, NEG가 POS보다 먼저 평가돼 **정상 브랜드 그라디언트가 통째로 즉시 기각**됐다. NEG를 `promo·event·advert·adsense·sale·coupon·skeleton·shimmer·placeholder·toast·tooltip·chart·graph·ribbon·sticker`로 좁히고, `card`·`thumb`·`banner`·`badge`는 브랜드 면일 때가 더 많아 **중립(0)** 으로 내렸다. 변수 선언(`--brand-*`·`--primary-*`)은 그 자체가 근거이므로 **NEG보다 먼저** 평가한다. 맥락 창은 마지막 `}`·`>` 뒤만 보게 잘라 **직전 규칙의 셀렉터를 내 맥락으로 오인**하는 문제를 없앴다. **② 거짓 양성 잔여 — 휴 허용치와 근거량.** 멀티 휴 브랜드 그라디언트는 정지점이 넓게 벌어져 40°는 너무 좁았으므로 **50°** 로 넓히고, 대신 휴 검사를 통과했으면 '2곳 이상 반복' 요구를 면제해 **같은 계열이라는 사실 자체를 근거로 인정**했다. **③ "Primary를 바꿔도 화면이 안 바뀐다".** `igApplySel`이 스와치 클릭마다 기존 `igGradSel`을 다시 적용했는데, `--brand-gradient`는 사용자가 보는 바로 그 면(`.btn-primary`·`.logo .mark`·`.hero .visual`·`.hbar i`)을 덮는다. 이제 **사람이 스와치를 직접 누르면**(`userPick`) 고른 색이 그 그라디언트의 시드가 아닌 한 **그라디언트를 자동 해제**하고, 목록 머리말에 "Primary를 직접 고르셔서 해제했습니다"라고 적어 되돌릴 수 있게 한다. **④ 판정 → 나래비.** 단일 accept/reject를 버리고 `gradVerdicts()`가 **그라디언트마다 판정과 사유**를 만든다(`gradAccept` 폐기). 결과 패널은 찾은 그라디언트를 **채택·기각 가리지 않고 전부 나열**하고 각 줄에 미리보기 바 · 정지점 스와치 · 색 수 · 멀티 휴 Δ · 출처(CSS·SVG 로고·텍스트 나열) · 사용 횟수 · 맥락 라벨 · `브랜드 근거 있음/근거 부족` 뱃지 · 기각 사유 · **적용/해제** 버튼을 붙인다. 맨 위 **그라디언트 없음** 줄이 기본값이자 복귀 경로다. 0개면 무엇을 인식 대상으로 보는지를 그 자리에 적는다(빈 상태). 임의의 `#igGradForce` 승격 버튼은 목록이 대체하므로 삭제했다. **⑤ 나머지 분석 요소도 조작 가능하게.** 검출 폰트는 **누르면 적용되는 칩**이 되고(목록에 없으면 `cbFontSel`에 '검출됨' 옵션으로 추가), 곡률·간격은 분석값을 함께 표시하는 **세그먼트 컨트롤**이 됐다(현재값은 `#presetCtl`의 `on` 버튼을 진실로 읽는다). **⑥ 산문 폴백 가드.** 참조되지 않아 이미 걸러낸 SVG `<linearGradient>`의 `stop-color`를 텍스트 폴백이 다시 주워 담던 구멍을 막아, 폴백은 **그라디언트 문법이 아예 없는 텍스트**에서만 돈다. 검증은 `verify48.js`(11 열거/게이트 케이스 + 스와치 전환 시 자동 해제 · 기각 그라디언트 수동 적용 · 없음 복귀 · 폰트 칩 · 형태 노브 · bv3 freesm 채택/기각 회귀) **FAILS none / ERRORS none**, `verify45.js`·`verify43.js` 회귀 통과. `verify47.js`는 `#igGradForce`를 전제하므로 `attic/verify47.retired.js`로 은퇴시켰다(케이스는 `verify48.js`가 승계).

## 아이콘 시스템 (교체 지점)
아이콘은 브랜드처럼 **한 곳에서 통째 교체**하는 스왑 레이어다.
- 소스: `icons/icons.svg`(스프라이트) · 레지스트리: `icons/icons.json`(20종)
- 네이밍: `icon-{group}-{name}` · group = brand·action·nav·status·trend·finance·feature·category
- 사용: `<svg class="i"><use href="#icon-action-search"/></svg>`
- 교체: 커스텀 아이콘 도착 시 icons.svg에서 **같은 id의 `<symbol>` path만** 갈아끼우면 전 화면 아이콘이 동시 스왑된다(id·네이밍 유지). 현재 소스는 Lucide(ISC).
