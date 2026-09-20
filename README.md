# 압구정 아파트 재건축 투자 지도

압구정 1~6구역 재건축을 **구역별 구성 · 입지 · 재건축 후 계획 · 진행 일정** 네 축으로 정리한
웹 기반 인터랙티브 전자책입니다. 시세는 **국토교통부 실거래가 공개 API**로 갱신합니다.

- 빌드 도구·프레임워크·런타임 의존성이 **없습니다**. Node 20+ 내장 기능만 사용합니다.
- 원고는 Markdown, 데이터는 JSON, 산출물은 정적 HTML입니다.
- 라이트/다크 테마, 모바일 대응, 인쇄용 PDF 레이아웃을 모두 포함합니다.

## 빠른 시작

```bash
# 1. 시세 데이터 채우기 (API 키 필요 — 아래 참고)
MOLIT_API_KEY=발급받은키 npm run fetch

# 2. 사이트 빌드
npm run build

# 3. 로컬 미리보기
npm run serve          # http://localhost:4173
```

API 키 없이 레이아웃만 보려면 합성 샘플로 빌드됩니다.

```bash
node scripts/make-sample.mjs   # 샘플 데이터 생성 (가격은 전부 가짜)
npm run build
```

> 샘플로 빌드하면 사이트 상단에 경고 배너가 표시됩니다.
> **판매·배포 전에 반드시 `npm run fetch`로 실제 실거래를 채우세요.**

## 국토교통부 실거래가 API 키 발급

1. [공공데이터포털 — 국토교통부 아파트 매매 실거래가 상세 자료](https://www.data.go.kr/data/15126468/openapi.do)에서 **활용신청**
2. 마이페이지 → 오픈API → 인증키에서 **일반 인증키(Encoding)** 복사
3. `MOLIT_API_KEY` 환경변수로 전달

```bash
MOLIT_API_KEY=xxx npm run fetch              # 기본 36개월
MOLIT_API_KEY=xxx node scripts/fetch-trades.mjs --months 60
```

무료이며 개발계정 기준 일 10,000건 트래픽이 제공됩니다. 36개월 수집에 수십 건만 사용합니다.

수집 스크립트는 강남구(법정동코드 `11680`) 전체를 조회한 뒤 법정동이 `압구정동`인 거래만 추출하고,
해제된 거래를 제외한 다음 단지·평형·구역별로 집계해 `data/trades/apgujeong.json`을 만듭니다.
**평형 목록은 미리 입력한 값이 아니라 실거래에 신고된 전용면적에서 도출**됩니다.

## 프로젝트 구조

```
content/          원고 (Markdown + 프런트매터). 여기만 고치면 됩니다.
  00-cover.md       표지·목차
  01-zones.md       1장 구역별 설명
  02-location.md    2장 입지 분석
  03-after.md       3장 재건축 후 구역별 특징·분담금
  04-schedule.md    4장 진행 현황과 일정
  05-risk.md        5장 리스크 점검
  06-method.md      부록 데이터 방법론과 면책

data/             데이터 레이어 (모든 수치의 단일 출처)
  meta.json         제목·판본·기준일
  zones.json        구역별 단지·세대수·시공사·공사비·진행단계·마일스톤
  complexes.json    단지 목록, 실거래 단지명 별칭, 대지지분
  location.json     입지 요소 (백화점·상권/한강/학군/교통)
  policy.json       재초환 등 제도, 추정 모델 기본값과 근거
  sources.json      출처 전체 (원고의 [^src:키]가 이걸 참조)
  trades/           수집된 실거래 (apgujeong.json 우선, 없으면 sample.json)

scripts/
  fetch-trades.mjs  국토부 API 수집·집계
  build.mjs         content + data → dist/
  serve.mjs         로컬 정적 서버
  check-data.mjs    데이터 정합성 점검
  make-sample.mjs   합성 샘플 생성
  pdf.mjs           인쇄용 PDF 내보내기 (playwright 선택 설치)
  lib/              molit(API) · markdown · charts · widgets · format

assets/           style.css, app.js (그대로 dist로 복사)
dist/             빌드 산출물 (git 제외)
```

## 원고 쓰기

프런트매터:

```markdown
---
title: 구역별 설명
subtitle: 페이지 상단 부제
desc: 표지 목차 카드에 들어가는 한 줄 설명
chapter: 1장
slug: zones
---
```

`kind: cover`를 쓰면 그 페이지가 `dist/index.html`이 됩니다.

### 출처 인용

```markdown
2구역은 통합심의를 통과했습니다[^src:hankyung-2026-07-03].
```

`data/sources.json`의 키를 쓰면 본문에 윗첨자 번호가 붙고 장 하단에 출처 목록이 자동 생성됩니다.
없는 키를 쓰면 `npm run check`가 오류로 잡아 줍니다.

### 콜아웃

```markdown
:::note      참고
:::warn      주의
:::risk      리스크
:::tip       체크포인트
:::data      데이터 기준
```

### 인터랙티브 위젯

원고에 `:::위젯이름` / `:::` 한 쌍만 넣으면 삽입됩니다.

| 위젯 | 내용 |
|---|---|
| `data-status` | 시세 기준일·출처·갱신 시각 배너 |
| `toc-grid` | 표지의 장별 카드 목차 |
| `zone-cards` | 구역별 요약 카드 (인수로 구역 지정 가능: `:::zone-cards z2 z3`) |
| `zone-compare` | 6개 구역 비교표 |
| `stage-ladder` | 재건축 10단계 절차와 투자자 관점 의미 |
| `price-trend` | 구역별 평당가 추이 라인 차트 (호버 크로스헤어) |
| `complex-prices` | 단지별 평당가 막대 차트 |
| `complex-table` | 단지×평형 시세표 (구역 필터·검색·정렬) |
| `share-calculator` | 지분 대비 가격 계산기 |
| `contribution-calculator` | 분담금 추정 계산기 + 비례율 민감도 표 |
| `construction-cost` | 구역별 공사비 규모 표 |
| `progress-meters` | 구역별 진행 단계 게이지 |
| `timeline` | 구역별 마일스톤 타임라인 |
| `location-cards` | 입지 요소 카드 (`:::location-cards river school`) |
| `policy-jaechohwan` | 재초환 요약 박스 |
| `sources-list` | 출처 전체 목록 |

## 데이터 점검

```bash
npm run check          # 출처 키·구역 참조·미입력 항목 점검
npm run check:links    # dist/ 의 내부 링크와 앵커 점검
npm run verify         # check → build → check:links 한 번에
```

- 원고와 데이터의 **출처 키가 실제로 존재하는지** 검증
- 구역 참조, 진행 단계 범위, 단지명 별칭 충돌 확인
- **아직 채우지 못한 항목**을 구역별로 나열 (대지지분, 기존 세대수 등)
- 실거래에서 매칭되지 않은 단지명 보고 → `data/complexes.json`의 `aliases`에 추가

## 아직 비어 있는 데이터

정직성을 위해 **추정으로 채우지 않고 비워 둔** 항목입니다. 사이트에는 '미확인/미입력'으로 표시됩니다.

| 항목 | 채우는 방법 |
|---|---|
| 단지별 **대지지분** | [등기부등본](https://www.iros.go.kr) 표제부 '대지권의 표시'(확정적·유료), [일사편리](https://www.kras.go.kr)·[씨:리얼](https://seereal.lh.or.kr)·집합건축물대장 전유부(무료) → `data/complexes.json`의 `landSharePyeong`에 `"전용면적": 대지지분평` 형태로 입력. **부동산공시가격 알리미에는 대지지분이 없습니다.** |
| 1·4·5구역 기존 세대수 | 조합 자료 → `data/zones.json`의 `unitsBefore` |
| 1·6구역 계획 세대수·층수 | 정비계획 확정 후 |
| 아파트 구조 방식(기둥식 여부) | 사업시행계획인가 도서, 도급계약서 |
| 2구역 총공사비, 3·5구역 3.3㎡당 단가 | 공개 시 |

`landSharePyeong`을 채우면 시세표의 '지분당 단가' 칸과 지분 계산기가 자동으로 활성화됩니다.

## PDF로 내보내기

브라우저에서 각 장을 열고 **인쇄 → PDF로 저장**하면 됩니다.
인쇄용 스타일이 이미 적용되어 있습니다 — 목차·버튼 숨김, 링크 주소 표기, '표로 보기' 전체 펼침,
차트·카드 페이지 분할 방지.

스크립트로 일괄 내보내려면:

```bash
npm i -D playwright
npm run serve &
node scripts/pdf.mjs      # dist-pdf/ 에 장별 PDF
```

## 배포

`main` 또는 `claude/**` 브랜치에 푸시하면 GitHub Actions가 빌드해 GitHub Pages로 배포합니다.
**최초 1회만** 저장소 Settings → Pages → Source를 **GitHub Actions**로 바꿔 주세요.
배포 주소: `https://<사용자명>.github.io/k-ritual/`

산출물은 상대 경로만 쓰므로 **`dist/` 폴더를 그대로 압축해 배포해도 동작합니다.**
받는 사람이 `index.html`을 더블클릭하면 브라우저에서 열리고, 계산기와 차트까지 전부 작동합니다
(서버 없이 열리도록 스크립트를 일반 스크립트로 두었습니다).

시세를 정기 갱신하려면 저장소 Secrets에 `MOLIT_API_KEY`를 등록하세요.
워크플로가 매월 1일 실거래를 다시 수집한 뒤 배포합니다.

## 색과 접근성

차트 색은 색각 이상(적록·청황) 조건에서 인접 계열 구분이 유지되는지 검증한 팔레트를 사용합니다.
색만으로 정보를 전달하지 않도록 **모든 차트에 범례와 '표로 보기'** 를 함께 제공하고,
상태 표시(완료/진행/목표)는 색과 함께 **아이콘 + 라벨**을 항상 붙입니다.
라이트/다크 각각에 대해 별도로 검증된 색 단계를 씁니다.

## 면책

이 저장소의 콘텐츠는 공개 자료를 정리한 **정보 제공 목적**의 자료이며 투자 권유가 아닙니다.
모든 수치는 발행일 기준이고 조합의 확정 수치가 아닙니다.
자세한 내용은 부록의 면책 조항(`content/06-method.md`)을 확인하세요.
