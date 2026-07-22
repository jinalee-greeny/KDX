# KDX 디자인 시스템 — Claude Code 작업 지침

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

## 추천 다음 작업 (NEXT)
1. 기초 컴포넌트를 토큰 바인딩으로: **Button**(primary/secondary/ghost · S/M/L · hover/press/disabled) → **Input/Field** → **Card** → **Chip/Badge**.
2. 실제 홈페이지 섹션(nav/hero/stats/features/products/CTA/footer)을 `brand-swap-demo.html` 구조를 참조해 코드로.
3. Dark 모드 값 추출 후 Semantic에 두 번째 모드 추가.

## 아이콘 시스템 (교체 지점)
아이콘은 브랜드처럼 **한 곳에서 통째 교체**하는 스왑 레이어다.
- 소스: `icons/icons.svg`(스프라이트) · 레지스트리: `icons/icons.json`(20종)
- 네이밍: `icon-{group}-{name}` · group = brand·action·nav·status·trend·finance·feature·category
- 사용: `<svg class="i"><use href="#icon-action-search"/></svg>`
- 교체: 커스텀 아이콘 도착 시 icons.svg에서 **같은 id의 `<symbol>` path만** 갈아끼우면 전 화면 아이콘이 동시 스왑된다(id·네이밍 유지). 현재 소스는 Lucide(ISC).
