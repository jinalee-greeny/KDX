# KDX 디자인 시스템 아키텍처 v0.4

기반: `[KDX-pxd] Foundation`(ALTO) 승계 · 목표: **브랜드 미확정 상태로 개발 진행 → 에셋 도착 시 Brand 레이어 한 곳만 교체해 전체 반영**.
Primary(임시): **Deep Blue `#1245BA`** · 웹 · 반응형 · 모바일 1st(3 breakpoint).

## 핵심 아이디어
브랜드 정체성(컬러·서체·형태·에셋)을 얇은 **Brand 레이어 하나**에 격리. 시맨틱은 `blue/50`이 아니라 `color/primary/50`(Brand)을 참조 → 브랜드 도착 시 Brand만 교체하면 전체 캐스케이드. 색뿐 아니라 **수치(spacing/size/border/radius)도 같은 원리**로 프리미티브(dimension)에 별칭, 곡률은 모드로 스왑.

## 5개 컬렉션 (총 278 변수)
| 컬렉션 | 수 | 모드 | 내용 |
|---|---|---|---|
| **Scale** | 130 | 1 | 원시. `color/*`(gray·blue·red·orange·green·purple + alpha) 113, `dimension/*` 17. 수의 유일 프리미티브 = dimension. |
| **Brand** | 15 | 1 | ★교체 지점★. `color/primary/*` 12램프, `brand/font/{display,text}`, `brand/asset/{logo,icon-set,image-tone}`. |
| **Semantic** | 109 | Light | 의미. 색 71 + 수치 38. 전부 Scale/Brand 별칭. |
| **Radius** | 14 | sharp·default·rounded | 곡률. `radius/*` 8(모드별 dimension 별칭) + `comp/radius/*` 6. |
| **Web** | 10 | mobile·tablet·desktop | 반응형. breakpoint·container·grid·section·display. |
+ Text Styles 42 · Effect Styles(shadow) 6.

## Semantic 상세 (병합 금지 — 맥락 분리 유지)
- **색 71**: bg 11 · fg 12 · bdr 7 · comp 20 · status 6 · chart 14 · static 4 (그룹별 표기는 blueprint 참조).
  accent·link·focus·강조배경은 `color/primary/*`(Brand) 참조. **chart 등락색은 브랜드 무관 고정**(up 빨강/down 파랑/flat 회색).
- **수치 38**: `spacing/*` 14(→dimension), `size/*` 12(→dimension), `border/*` 3(→dimension), `comp/pad/*` 5(→spacing), `comp/gap/*` 4(→spacing). comp는 2단 캐스케이드.

## Radius 모드 (곡률 스왑)
Figma 변수는 곱셈이 안 되므로 배율 대신 **모드**로 곡률 성격 교체. 각 스텝이 모드별로 다른 dimension을 가리킨다.

| 스텝 | sharp | default | rounded |
|---|---|---|---|
| 2xs · xs · s · m · l · xl · 2xl | 0·2·2·4·6·8·12 | 2·4·8·12·16·20·24 | 4·8·12·20·24·28·32 |
| full | 999 | 999 | 999 |

`comp/radius`: button→m · input→s · card→l · chip→full · modal→xl · pill→full.

## Deep Blue 램프 (Primary placeholder)
05 #F2F5FA · 10 #D9E1F2 · 20 #AFC0E9 · 30 #6B90E5 · 40 #205CE9 · **50 #1245BA** · 55 #103CA2 · 60 #0E348B · 70 #0F2762 · 80 #0C1C40 · 90 #091125 · 96 #050A14 (흰 텍스트 대비 8.12, AA 통과).

## Web / 반응형 (모바일 1st · 3단계, min-width)
- breakpoint: mobile 0 / tablet 768 / desktop 1024
- container/max 100% / 720 / 1200 · pad 20 / 32 / 40 · columns 4 / 8 / 12 · gutter 16 / 20 / 24
- space/section 64 / 96 / 120 · space/block 40 / 56 / 72
- web/display xl 36→52→72 · l 30→40→56 · m 26→32→44 (초대형 타이틀만 반응형, 본문류는 전 해상도 고정)

## 열린 결정
- **`brand/shape/radius-scale` 고아 변수**: 곡률이 모드로 이관되며 사용처 없음. (A) 삭제 / (B) 브랜드→권장 Radius 모드 힌트로 재정의. 미결.
- **Semantic Dark 모드**: 구조는 준비, 값 미추출.

## 이력
- v0.1 4-tier + Brand + Web 아키텍처 확립, Deep Blue placeholder.
- v0.2 시맨틱 워싱(맥락 분리 유지, 병합 없음), 차트 유지.
- v0.3 Figma 라이브러리 구축, 수치 시맨틱화(dimension 별칭) + Radius 모드 신설.
- v0.4 청사진·데모 동기화, 토큰 코드 익스포트(이 패키지).
