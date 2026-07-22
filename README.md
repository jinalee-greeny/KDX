# KDX Design System — 핸드오프 패키지

KDX 기업 홈페이지 디자인 시스템의 토큰·스펙·레퍼런스 묶음. Claude Code로 바로 넘겨 작업 시작할 수 있게 구성.

> **먼저 `CLAUDE.md`를 읽어라.** 아키텍처·불변 규칙·토큰 사용법·다음 작업이 거기 있다.

## 빠른 시작
```html
<html data-brand="deepblue" data-radius="default">
<link rel="stylesheet" href="tokens/tokens.css">
```
그다음 컴포넌트에서 `var(--comp-fill-accent-primary)`, `var(--comp-pad-card)`, `var(--comp-radius-card)`, `var(--space-section)` 같은 시맨틱/컴포넌트 토큰을 쓴다. 원시(Scale)를 직접 쓰지 말고 항상 의미 토큰을 경유한다.

## 데모
`demo/index.html` — 브랜드 스왑 · 반응형 · 프리셋 토큰 조절 + 토큰 뷰(Figma 컬렉션 브라우저) 데모. 브라우저로 바로 열거나 GitHub Pages로 배포 가능.

## 구조
```
kdx-design-system/
├─ CLAUDE.md              ← 작업 지침 (아키텍처·규칙·다음 작업). 반드시 먼저 읽기
├─ README.md
├─ demo/
│  └─ index.html          ← 인터랙티브 데모 (컴포넌트·프리뷰·토큰 뷰)
├─ tokens/
│  ├─ tokens.css          ← 계층 CSS 변수 (즉시 사용)
│  └─ tokens.json         ← 기계판독 토큰 (별칭·모드·스코프)
├─ reference/
│  ├─ blueprint.html      ← 변수 컬렉션 청사진 (시각 스펙)
│  └─ architecture.md     ← 아키텍처 상세 + 열린 결정
└─ figma/
   └─ 01~06*.js           ← Figma 플러그인 빌드 스크립트 (라이브러리 재현/확장용)
```

## 현황 요약
- Figma 변수 라이브러리 구축 완료 (5 컬렉션 · 278 변수).
- 토큰 CSS/JSON 익스포트 완료.
- Primary는 **임시 Deep Blue `#1245BA`** (브랜드 미확정 — Brand 레이어만 교체하면 전체 반영).
