# Self-Healing Web Scraper — 프로젝트 보고서

---

## 1. 프로젝트 배경 및 필요성

### 1.1 문제 정의

웹 크롤러는 특정 HTML 요소를 가리키는 **CSS 셀렉터**를 사전에 지정해두고 데이터를 추출한다.
그런데 현대 웹사이트는 다음과 같은 이유로 HTML 구조가 빈번하게 변경된다.

| 변경 원인 | 설명 |
|---|---|
| **CSS-in-JS 빌드** | React/Vue 컴포넌트 재빌드 시 `css-a1b2c3d4` 형태의 해시 클래스명이 매 배포마다 교체 |
| **A/B 테스트** | 마케팅 실험을 위해 동일 페이지의 DOM 구조가 사용자 세그먼트별로 분기 |
| **Div Soup(랩핑)** | 레이아웃 리팩터링 과정에서 의미 없는 `div` 계층이 추가되어 셀렉터 깊이 변화 |
| **안티 스크래핑(허니팟)** | 봇 탐지를 위한 숨겨진 가짜 노드 삽입으로 크롤러 혼란 유발 |

이로 인해 지정해둔 CSS 셀렉터가 **무효화(깨짐)** 되면 크롤러는 빈 값 또는 오류를 반환하고,
이를 수동으로 점검·수정하는 작업이 지속적으로 발생한다.

### 1.2 현재 해결 방식의 한계

- 셀렉터가 깨질 때마다 **개발자가 직접** 해당 사이트를 열어 DevTools로 새 셀렉터를 확인하고 코드를 수정
- 크롤링 대상 사이트가 많거나 배포 빈도가 높을수록 **유지비용이 지수적으로 증가**
- 변경 탐지 자동화가 없으면 **조용한 데이터 손실** 발생 (에러 없이 잘못된 값이 수집됨)

### 1.3 해결 방향

> **"셀렉터가 깨졌을 때, ML + LLM이 자동으로 변경된 HTML에서 원래 타겟 노드를 복구한다"**

사람이 개입 없이, 이전 버전(V1) HTML과 새 버전(V2) HTML을 비교하여
원래 타겟이 V2에서 어디로 이동했는지 자동으로 추적하는 **Self-Healing** 메커니즘을 구현한다.

---

## 2. 시스템 개요 및 핵심 기능

### 2.1 시스템 아키텍처

```
[사용자 브라우저]
       │  React SPA (DOMA 대시보드)
       ▼
┌─────────────────────────────────────────────────┐
│           Node.js / Express  서버                │
│  REST API · WebSocket(Playwright) · Scheduler   │
│  SQLite  (crawlers · crawl_results · proposals) │
└──────────────────┬──────────────────────────────┘
                   │ POST /heal
        ┌──────────▼──────────┐
        │  V2에서 셀렉터 동작?  │──── YES ───▶  no_change_needed 반환
        └──────────┬──────────┘
                 NO │
        ┌──────────▼──────────────────────────────┐
        │  ML 1차 필터링 (Random Forest / SVM)      │
        │  V2 후보 노드 전체 → Top-30 압축           │
        └──────────┬──────────────────────────────┘
                   │ Top-30 후보 + 문맥(HTML snippet)
        ┌──────────▼──────────────────────────────┐
        │  LLM 2차 정밀 타겟팅 (GPT-4o-mini)        │
        │  의미론적 판단 + robust_selector 생성       │
        └──────────┬──────────────────────────────┘
                   │
               healed 반환
        (robust_selector, extracted_text, confidence)
```

### 2.2 핵심 기능

| 기능 | 설명 |
|---|---|
| **자동 셀렉터 복구** | V1→V2 HTML 변경 시 새 CSS 셀렉터 자동 생성 |
| **ML 후보 필터링** | 수천 개 DOM 노드 중 Top-30으로 압축하여 LLM 비용 절감 |
| **LLM 정밀 선택** | GPT-4o-mini가 의미·구조·순위 맥락을 종합해 최종 노드 결정 |
| **랭킹 노드 보정** | "1위", "베스트" 등 순위 타겟의 위치를 DOM 탐색으로 자동 교정 |
| **운영 대시보드** | 크롤러 등록·실행·스케줄·승인을 단일 UI에서 관리 (DOMA) |
| **REST API 제공** | FastAPI 기반 `/heal` 엔드포인트로 외부 시스템과 연동 |

### 2.3 입출력 명세

**입력 (`POST /heal`)**
```json
{
  "v1_html":      "<string>  V1(과거) 페이지 HTML",
  "v2_html":      "<string>  V2(현재) 페이지 HTML",
  "css_selector": "<string>  V1 기준 기존 셀렉터",
  "user_intent":  "<string>  ex) '1위 상품 이름을 추출하고 싶다'",
  "target_name":  "<string>  ex) 'ranking top1 item name'"
}
```

**출력**
```json
{
  "status":          "healed | no_change_needed | failed",
  "robust_selector": "<새 CSS 셀렉터>",
  "extracted_text":  "<복구된 텍스트 값>",
  "confidence":      0.0 ~ 1.0,
  "reasoning":       "<LLM 판단 근거>"
}
```

---

## 3. 지금까지 개발된 사항

### 3.1 데이터 수집 및 전처리

#### 3.1.1 원본 HTML 수집

- **수집 방식**: Wayback Machine CDX API + Playwright 기반 렌더링
- **수집 사이트 수**: **19개 도메인**, **62개 HTML 스냅샷** (`html_archives/`)
- **시간 범위**: 2005년 ~ 2026년 (사이트별 상이)

| 카테고리 | 대상 사이트 |
|---|---|
| 이커머스 / 쇼핑 | kream, gmarket, daiso, oliveyoung, zigzag |
| 금융 | hana bank, kdb bank, tossinvestment, krx, seibro |
| 암호화폐 | coinmarketcap |
| 문화 / 엔터 | melon, yes24, kofic, kinolights, naver webtoon, youtubemusic |
| 뉴스 / 기타 | hankyung market, ohou, semrush |

#### 3.1.2 정답 레이블 구축 (Ground Truth)

- 파일: `data/ground_truth.csv`
- **총 479개 타겟** (target_name, html_filename, css_selector) 수작업 레이블링
- 추출 대상 예시: 상품명, 가격, 할인율, 순위, 주가, 코인시가총액, 음악차트 등

#### 3.1.3 변이(Mutation) 시뮬레이션

실제 현장에서 발생하는 크롤러 붕괴 패턴 4가지를 코드로 구현하여 원본 HTML에서 변이본을 자동 생성한다.

| 패턴 | 설명 | 현실 사례 |
|---|---|---|
| **A — CSS-in-JS 해시** | 클래스명을 `css-a1b2c3d4` 또는 Tailwind 유틸리티로 교체 | React, Styled-components 재빌드 |
| **B — Div Soup 래핑** | 타겟 노드 주변에 레이아웃용 `div` 한 겹 추가 | 컴포넌트 리팩터링 |
| **C — 허니팟 삽입** | 숨겨진(`display:none`) 가짜 노드를 타겟 인근에 주입 | 안티 스크래핑 방어 |
| **D — A/B 테스트 클래스** | 기존 클래스에 `--variant-B`, `-v3` 접미사 부착 | 마케팅 실험 |

- 원본 62개 × 3가지 변이본 = **186개 변이 HTML** (`data/mutated/`)
- 변이 적용 비율: 전체 태그의 20% 무작위 선택, 패턴 적용 확률 A:40%, B:30%, C:15%, D:15%

#### 3.1.4 피처 추출 (Delta Feature Engineering)

V1(원본) 정답 노드와 V2(변이) 후보 노드 사이의 **차이(Delta)**를 피처로 변환한다.

| # | 피처명 | 설명 |
|---|---|---|
| 1 | `position_diff` | 문서 전체에서의 상대적 위치 차이 |
| 2 | `nth_child_diff` | 형제 노드 중 인덱스 차이 |
| 3 | `text_length_diff` | 텍스트 길이 차이 |
| 4 | `dom_depth_diff` | DOM 트리 깊이 차이 |
| 5 | `sibling_count_diff` | 형제 노드 개수 차이 |
| 6 | `class_similarity` | CSS 클래스 Jaccard 유사도 |
| 7 | `path_similarity` | 조상 경로(ID+클래스) Jaccard 유사도 |
| 8 | `is_tag_match` | 태그 이름 일치 여부 |
| 9 | `is_currency_match` | 통화 기호 일치 여부 |
| 10 | `is_financial_format_match` | 순수 숫자 포맷 일치 여부 |
| 11 | `is_comma_format_match` | 쉼표 포맷 일치 여부 |
| 12 | `value_diff_ratio` | 수치 값 차이 비율 |
| 13 | `context_similarity` | 부모 노드 텍스트 문맥 유사도 |
| 14 | `parent_tag_match` | 부모 태그 이름 일치 여부 |
| 15 | `ancestor_tag_path_sim` | 조상 태그 경로 유사도 (클래스 무관) |
| 16 | `child_count_diff` | 직접 자식 노드 수 차이 |
| 17 | `text_digit_ratio_diff` | 텍스트 내 숫자 비율 차이 |
| 18 | `list_ancestor_index_diff` | 리스트 컨테이너 내 인덱스 차이 |

- **오버피팅 방지를 위한 Data Drift 시뮬레이션 적용**: 정답(label=1) 샘플에 대해 class_similarity, path_similarity, context_similarity에 무작위 노이즈를 추가하여, 모델이 클래스/경로 일치에 과도하게 의존하지 않도록 학습

#### 3.1.5 레이블링 전략 (Hard Negative Sampling)

- 정답(label=1): V2에서 텍스트 완전 일치 노드 1개
- 오답(label=0): **Hard Negative 5개** (동일 태그 타입, 같은 리스트 내 다른 아이템) + **Easy Negative 5개** (숫자 포함 다른 태그) = 10개
- 최종 레이블 비율: 정답 1 : 오답 10 (불균형 → `class_weight='balanced'` 적용)

#### 3.1.6 데이터셋 규모

| 항목 | 수치 |
|---|---|
| 원본 HTML 스냅샷 | 62개 |
| 변이 HTML | 186개 |
| Ground Truth 타겟 | 479개 |
| 전체 학습 피처 행 | 13,508개 |
| Train / Test 분할 (8:2) | 10,806 / 2,702 |

---

### 3.2 학습 모델 Specification 및 성능

#### 3.2.1 모델 아키텍처 비교 (GridSearchCV 벤치마크)

3가지 분류 모델을 `StandardScaler + Pipeline` 형태로 구성하여 5-fold Cross Validation 기반 GridSearchCV로 최적 하이퍼파라미터를 탐색한 뒤 테스트셋 성능을 비교한다.

| 모델 | 탐색 하이퍼파라미터 |
|---|---|
| **Logistic Regression** | `C` ∈ {0.1, 1.0, 10.0} |
| **SVM (RBF Kernel)** | `C` ∈ {0.1, 1, 10, 100}, `gamma` ∈ {'scale', 'auto', 0.1, 0.01} |
| **Random Forest** | `n_estimators` ∈ {100, 200}, `max_depth` ∈ {None, 10, 20}, `min_samples_split` ∈ {2, 5} |

- 최적화 기준(scoring): **F1-Score** (불균형 이진 분류에 적합)
- 클래스 불균형 대응: 모든 모델에 `class_weight='balanced'` 적용
- 최고 F1 모델을 자동으로 `models/best_self_healing_model.pkl`에 저장

> **실제 성능 수치**: `python main.py` 실행 후 출력되는 벤치마크 표 참조
> (Accuracy / Precision / Recall / F1-Score 4개 지표로 비교)

#### 3.2.2 추론 파이프라인 (Hybrid ML + LLM)

최종 추론은 단일 모델이 아닌 **2단계 하이브리드** 방식으로 동작한다.

```
V2 전체 후보 노드 (수천 개)
        │
        ▼  [1단계: ML 모델]
        │  best_self_healing_model.pkl 으로 predict_proba
        │  확률 상위 Top-30 노드 선별
        │
        ▼  [2단계: LLM (GPT-4o-mini)]
        │  Top-30 후보 + 각 노드의 context HTML 전달
        │  user_intent 기반 의미론적 최종 선택
        │  robust_selector 직접 생성
        ▼
    최종 복구 노드 + CSS 셀렉터
```

- ML이 탐색 공간을 수천 → 30으로 압축 → **LLM 토큰 비용 절감**
- LLM이 클래스명 변경·순위·의미 맥락을 종합 판단 → **ML 단독 대비 정확도 향상**

---

### 3.3 운영 플랫폼 — DOMA 대시보드

ML 추론 서버(`api/main.py`)를 실제 서비스로 연결하는 **풀스택 운영 플랫폼**이다.
Node.js + React 기반으로 크롤러의 등록·실행·모니터링·결과 시각화를 단일 UI 안에서 처리한다.

#### 3.3.1 주요 화면 및 기능

| 화면 | 기능 |
|---|---|
| **대시보드** | 전체 크롤러 상태, 7일 성공률·응답시간·자가치유 횟수 통계 |
| **크롤러 상세 — 값 추이** | 수집 간 값 변화를 주식 차트 형태로 시각화, 변경 시점 강조 표시 |
| **크롤러 상세 — 실행 이력** | 수집 이력 테이블 (추출값·신뢰도·응답시간), CSV 내보내기 |
| **셀렉터 선택 위저드** | Playwright headless 브라우저를 실시간 스트리밍, 클릭으로 CSS 셀렉터 자동 생성 |
| **승인 큐** | 신뢰도 미달 복구 결과를 사람이 검토 후 승인·거부 (Human-in-the-Loop) |

#### 3.3.2 값 추이 시각화

수집 값이 숫자형(가격·지수·환율 등)으로 판별되면 인터랙티브 차트를 렌더링한다.

- 상승 구간 초록 / 하락 구간 빨강으로 색상 분기 (주식 차트 컨벤션)
- 마우스 크로스헤어 + 호버 툴팁으로 특정 시점 값·수집 시각 확인
- 헤더에 기간 전체 ±% 변동률 배지 표시
- 숫자형 판별 실패 시 값 변화 이력 리스트로 대체, 변경된 행에 **변경** 배지 표시

#### 3.3.3 CSV 내보내기

`GET /api/crawlers/:id/results/csv` — 크롤러별 수집 이력 전체를 파일로 저장한다.

- BOM UTF-8 인코딩 (Excel 한글 깨짐 방지)
- 컬럼: 수집시각 / 상태 / 추출값 / 신뢰도 / 응답시간(ms) / 비고

---

## 4. 향후 계획

### 4.1 데이터 확장

- [ ] **대상 사이트 다양화**: 현재 19개 → 30개 이상으로 확대 (글로벌 사이트 추가)
- [ ] **실제 배포 이전/이후 HTML 쌍 수집**: 시뮬레이션이 아닌 실제 변경 사례 기반 데이터 보강
- [ ] **변이 패턴 다양화**: 현재 4가지 → 테이블 열 순서 변경, 동적 렌더링(SPA) 패턴 추가

### 4.2 모델 고도화

- [ ] **Tree-based Ensemble 고도화**: XGBoost / LightGBM 도입으로 F1 성능 개선
- [ ] **신경망 기반 접근**: DOM 트리를 그래프로 모델링하는 GNN(Graph Neural Network) 탐색
- [ ] **피처 중요도 분석**: Feature Importance로 불필요한 피처 제거, 모델 경량화
- [ ] **LLM 프롬프트 최적화**: Few-shot 예시 추가, 셀렉터 생성 규칙 강화

### 4.3 서비스 안정화

- [ ] **End-to-End 평가 지표 구축**: 복구된 셀렉터가 실제 페이지에서 올바른 값을 추출하는지 검증하는 자동 테스트 파이프라인
- [ ] **API 인증 및 Rate Limiting**: 외부 서비스 연동을 위한 보안 강화
- [ ] **배치 처리 지원**: 단일 요청 외 다수 타겟을 한 번에 처리하는 bulk heal 엔드포인트
- [ ] **모니터링 대시보드 고도화**: 이상값 감지, 다중 크롤러 값 비교 차트

### 4.4 프론트엔드 / UX

- [ ] **Chrome Extension 형태 배포**: 개발자가 브라우저에서 직접 셀렉터를 선택하고 치유를 요청하는 UI
- [ ] **치유 결과 시각화**: V1/V2 HTML에서 변경된 노드를 하이라이트해서 보여주는 Diff 뷰어
- [ ] **Webhook·Slack 알림**: 값 급변 또는 자가치유 발동 시 외부 채널 자동 알림

---

## 5. 파일 구조 요약

```
capstone_dataset/                   # ML 파이프라인
├── main.py                         # 전체 파이프라인 실행 진입점
├── api/
│   └── main.py                     # FastAPI 서버 (/heal 엔드포인트)
├── inference/
│   └── healer.py                   # 핵심 추론 모듈 (heal_target 함수)
├── src/
│   ├── collection/
│   │   └── fetch_archive.py        # Wayback Machine HTML 수집
│   ├── processing/
│   │   ├── html_mutator.py         # 변이 시뮬레이션 (패턴 A/B/C/D)
│   │   ├── feature_extractor.py    # Delta Feature 추출
│   │   └── data_preprocessor.py   # Train/Test 분할
│   └── model/
│       └── train_model.py          # 모델 학습 및 벤치마크
├── data/
│   ├── ground_truth.csv            # 정답 레이블 (479개)
│   ├── mutated/                    # 변이 HTML (186개)
│   └── processed/                  # 학습 데이터 CSV
├── html_archives/                  # 원본 HTML 스냅샷 (62개)
└── models/
    └── best_self_healing_model.pkl # 최고 성능 모델

Playground/                         # 운영 플랫폼 (DOMA)
├── server/
│   ├── server.js                   # Express + WebSocket 서버
│   ├── db.js                       # SQLite 스키마 및 CRUD
│   ├── crawler.js                  # 수집 실행 엔진
│   ├── scheduler.js                # 스케줄 관리 (node-cron)
│   └── doma.db                     # 데이터베이스
└── client/
    ├── DOMA.html                 # 앱 진입점
    ├── app.jsx                     # 라우팅 및 전역 상태
    └── screens.jsx                 # 전체 화면 컴포넌트
        ├── OverviewScreen          대시보드
        ├── DetailScreen            크롤러 상세 (값 추이·실행 이력)
        ├── StockChart              주식형 인터랙티브 차트
        ├── ApprovalsScreen         승인 큐
        └── NewCrawlerScreen        크롤러 등록 위저드
```
