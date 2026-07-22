# KDX Design System

KDX 기업 홈페이지 디자인 시스템 — 토큰 · 인터랙티브 데모 · 스펙 · Figma 빌드 스크립트.

**데모**: https://jinalee-greeny.github.io/KDX/demo/ · (GitHub Pages 활성화 후)
로컬에서는 `demo/index.html`을 브라우저로 열면 바로 확인됩니다.

> 먼저 **`CLAUDE.md`** 를 읽으세요 — 아키텍처 · 불변 규칙 · 토큰 사용법 · 다음 작업.

## 빠른 시작
```html
<html data-brand="deepblue" data-radius="default">
<link rel="stylesheet" href="tokens/tokens.css">
```
컴포넌트에서 `var(--comp-fill-accent-primary)`, `var(--comp-pad-card)`, `var(--comp-radius-card)`, `var(--space-section)` 같은 시맨틱/컴포넌트 토큰을 씁니다. 원시(Scale)를 직접 쓰지 말고 항상 의미 토큰을 경유합니다.

## 구조
```
kdx-design-system/
├─ CLAUDE.md              작업 지침 (아키텍처·규칙·다음 작업) — 먼저 읽기
├─ README.md
├─ demo/index.html        인터랙티브 데모 (컴포넌트·프리뷰·토큰 뷰)
├─ tokens/
│  ├─ tokens.css          계층 CSS 변수 (즉시 사용)
│  └─ tokens.json         기계판독 토큰 (별칭·모드·스코프)
├─ reference/
│  ├─ blueprint.html      변수 컬렉션 청사진 (시각 스펙)
│  └─ architecture.md     아키텍처 상세 + 열린 결정
└─ figma/                 변수 컬렉션 빌드 플러그인 스크립트 (01~06)
```

## 업데이트 워크플로우
파일 수정과 커밋은 Claude(Cowork) 세션에서 이뤄지고, **최종 push만 직접** 합니다:
```bash
git push        # 커밋은 세션에서 준비됨 → push 한 줄
```
데모를 URL로 공유하려면: 저장소 → Settings → Pages → Source `main` / `(root)` 지정.

## 현황
- Figma 변수 라이브러리 구축 완료 (5 컬렉션 · 278 변수).
- 토큰 CSS/JSON 익스포트 완료 · 서체 Pretendard 통일(교체 지점은 유지).
- Primary는 임시 **Deep Blue `#1245BA`** — Brand 레이어만 교체하면 전체 반영.
