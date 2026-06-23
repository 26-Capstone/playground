# DOMA — Self-Healing Web Scraper

CSS 셀렉터가 깨졌을 때 ML + LLM으로 자동 복구하는 웹 크롤러 관리 플랫폼.

---

## 목차

1. [아키텍처 개요](#아키텍처-개요)
2. [구현 내역 (Phase 1–8)](#구현-내역)
3. [실행 방법](#실행-방법)
4. [API 레퍼런스](#api-레퍼런스)
5. [User Journey](#user-journey)
6. [파일 구조](#파일-구조)

---

## 아키텍처 개요

```
브라우저 (React, no bundler)
    │  HTTP + WebSocket
    ▼
Node.js (Express + ws + Playwright)   ← :3001
    │  SQLite (better-sqlite3)
    │  node-cron 스케줄러
    │  HTTP proxy → /heal
    ▼
Python FastAPI (ML 추론)              ← :8000
    │  Random Forest + GPT-4o-mini
    └─ 자동 셀렉터 복구 파이프라인
```

### 자가치유 흐름

```
크롤러 실행
    │
    ├─ 성공 → DB 업데이트 (status=healthy)
    │
    └─ 실패 → Python /heal 호출
                │
                ├─ status='healed' AND confidence ≥ threshold
                │    → 자동 복구 (status=healthy, selector 교체)
                │
                ├─ status='healed' AND confidence < threshold
                │    → 승인 큐 저장 (status=pending, 수동 검토 요청)
                │
                └─ status='failed' | 기타
                     → status=failed, 제안 저장 안 함
```

---

## 실행 방법

### 사전 요구사항

- Node.js 18+
- Python 3.10+ (ML 서버 사용 시)
- Playwright 브라우저 바이너리

### 1. 의존성 설치

```bash
# 프로젝트 루트에서
npm install

# Playwright 브라우저 설치 (최초 1회)
npx playwright install chromium
```

### 2. 환경 변수 설정

프로젝트 루트에 `.env` 파일 생성:

```env
PORT=3001
PYTHON_API_URL=http://localhost:8000
OPENAI_API_KEY=sk-...       # 자가치유 LLM 사용 시 필요
```

> **주의:** `.env`는 절대 git에 커밋하지 마세요. `.gitignore`에 포함되어 있습니다.

### 3. Node.js 서버 실행

```bash
# 프로덕션 모드
npm start

# 개발 모드 (파일 변경 감지 + 자동 재시작)
npm run dev
```

브라우저에서 `http://localhost:3001/DOMA.html` 접속.

### 4. Python ML 서버 실행 (자가치유 기능 사용 시)

```bash
cd capstone_dataset
source venv/bin/activate        # 또는 conda activate <env>
pip install -r requirements.txt # 최초 1회

uvicorn api.main:app --reload --port 8000
```

> **주의:** `uvicorn main:app`은 오류 발생 (`Attribute "app" not found in module "main"`).  
> 반드시 `uvicorn api.main:app` 으로 실행해야 합니다.

Python 서버 없이 Node.js만 실행해도 크롤링 및 UI는 정상 동작합니다. 자가치유 호출 시 `[healer] 오류: fetch failed`가 발생하며, 크롤러 상태는 `failed`로 표시됩니다.

### 5. 동작 확인

```bash
# 서버 상태
curl http://localhost:3001/api/scrapers
curl http://localhost:3001/api/stats
curl http://localhost:3001/api/approvals
curl http://localhost:3001/api/scheduler/status

# 특정 크롤러 즉시 실행
curl -X POST http://localhost:3001/api/scrapers/{id}/run
```

### 포트 충돌 해결

```bash
lsof -ti :3001 | xargs kill -9
```

---

## API 레퍼런스

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/scrapers` | 크롤러 목록 (spark 배열 포함) |
| POST | `/api/scrapers` | 크롤러 등록 |
| GET | `/api/scrapers/:id` | 크롤러 단건 조회 |
| DELETE | `/api/scrapers/:id` | 크롤러 삭제 (결과·제안 캐스케이드) |
| POST | `/api/scrapers/:id/run` | 크롤러 즉시 실행 |
| GET | `/api/scrapers/:id/results` | 실행 이력 (최근 50건) |
| GET | `/api/stats` | 대시보드 집계 통계 |
| GET | `/api/approvals` | 승인 대기 제안 목록 |
| POST | `/api/approvals/:id/approve` | 제안 승인 (셀렉터 자동 교체) |
| POST | `/api/approvals/:id/reject` | 제안 거부 |
| GET | `/api/scheduler/status` | 스케줄러 현황 |
| POST | `/heal` | Python ML 서버 프록시 |
| POST | `/fetch-html` | Playwright HTML 수집 (셀렉터 선택기용) |
| WS | `ws://localhost:3001` | 브라우저 스트리밍 (셀렉터 선택기) |

---

## User Journey

### 1. 크롤러 등록

1. 상단 **"새 크롤러"** 버튼 또는 사이드바 클릭
2. **Step 1 — 기본 정보**: 이름, URL, 도메인 카테고리, 알림 채널 입력
3. **Step 2 — 셀렉터 선택**: 내장 브라우저에서 수집할 요소를 직접 클릭 → CSS 셀렉터 자동 생성
   - 팝업·모달이 뜨는 경우: URL 바 아래 툴바에서 **ESC** / **자동 제거** / **요소 지우기** 사용
4. **Step 3 — 수집 의도**: 자연어로 "무엇을 추출할 것인지" 기술 (LLM 프롬프트로 사용됨)
5. **Step 4 — 스케줄 & 임계값**: 실행 주기(15분/1시간/매일 09시) 및 자동 복구 신뢰도 임계값(0–100) 설정
6. **"크롤러 생성"** → DB 저장 + 스케줄러 즉시 등록

### 2. 크롤러 모니터링

- **Overview 화면**: 등록된 모든 크롤러를 테이블로 표시
  - 상태 칩 (정상 / 자가치유 중 / 승인 대기 / 실패 / 일시중지)
  - 최근 수집 값과 실행 시각
  - Score (최근 20건 성공률, 도넛 링으로 시각화)
  - 7일 추이 스파크라인
  - 다음 실행까지 남은 시간
- **상단 Stat 카드**: 활성 피드 수 / 7일 성공률 / 누적 자가치유 수 / 평균 응답시간
- 데이터는 **30초마다 자동 갱신**, "새로고침" 버튼으로 즉시 갱신 가능

### 3. 크롤러 상세 및 즉시 실행

1. 테이블에서 행 클릭 → **Detail 화면**
2. **"지금 실행"** 버튼 → Playwright로 즉시 크롤링 실행
   - 성공: 수집 값과 Score 즉시 업데이트
   - 실패: 자가치유 자동 시작 (화면에 진행 상태 표시)
3. **Overview 탭**: score 추이 차트, 최근 수집 JSON, 현재 셀렉터, 운영 통계 (실데이터)
4. **Runs 탭**: 실행 이력 타임라인 (상태, 소요시간, 수집 값, 노트)
5. **Settings 탭**: 셀렉터 수정, 임계값 조정

### 4. 크롤러 삭제

- **Overview**: 테이블 행 우측 `…` → 드롭다운 "삭제"
- **Detail 화면**: 헤더 "삭제" 버튼 → 인라인 확인 후 삭제
- 삭제 시 연관된 실행 이력(scrape_results)과 자가치유 제안(heal_proposals) 함께 삭제

### 5. 자가치유 자동 복구

크롤러 실행 실패 시 자동으로 작동:

1. V1 HTML 스냅샷(최초 성공 시 저장)과 현재 HTML을 Python ML 서버에 전송
2. ML 서버가 새 CSS 셀렉터 후보와 신뢰도 점수 반환
3. **신뢰도 ≥ 임계값** → 셀렉터 자동 교체, `status=healthy`, healed_count+1
4. **신뢰도 < 임계값** → 승인 큐에 저장, `status=pending`, 관리자 알림
5. **치유 불가** → `status=failed`, 제안 저장 없음

### 6. 승인 큐 검토

1. 사이드바 **"승인 큐"** 배지에 대기 건수 표시 (0이면 숨김)
2. Overview 화면 상단 배너에서 직접 이동 가능
3. **승인 큐 화면 — 목록 뷰**
   - 대기 중인 모든 제안을 테이블로 표시
   - 이전 셀렉터 / 제안 셀렉터 / 신뢰도 한눈에 비교
   - 목록에서 바로 **"승인"** 버튼으로 빠른 처리 가능
4. **"검토"** 클릭 → 상세 뷰
   - 이전 vs. 제안 셀렉터 코드 비교
   - 추출된 텍스트 미리보기
   - AI 추론 근거 (왜 이 셀렉터를 선택했는지)
   - 신뢰도 링 (점수 시각화)
5. **"승인 후 자동 복구"**: 셀렉터 즉시 교체, 크롤러 정상화
6. **"거부 · 다시 시도"**: 크롤러 failed 처리, 재등록 또는 수동 셀렉터 수정 필요

---

## 파일 구조

```
Playground/
├── .env                        # 환경 변수 (PORT, PYTHON_API_URL, OPENAI_API_KEY)
├── package.json                # 워크스페이스 루트
│
├── server/
│   ├── server.js               # Express + WebSocket 서버, API 라우트
│   ├── db.js                   # SQLite 스키마 & 쿼리 (better-sqlite3)
│   ├── scraper.js              # Playwright 실행 엔진 + 자가치유 로직 (tryHeal 3분기)
│   ├── scheduler.js            # node-cron 스케줄 관리
│   ├── doma.db                 # SQLite 데이터베이스 파일
│   ├── snapshots/              # V1 HTML 스냅샷 ({scraperId}_v1.html)
│   └── package.json
│
├── client/
│   ├── DOMA.html               # 진입점 HTML (React CDN, Babel, 스크립트 로드)
│   ├── app.jsx                 # 앱 루트: 라우팅, 상태 관리, 테마, API 폴링
│   ├── screens.jsx             # 모든 화면 컴포넌트
│   ├── data.jsx                # 목 데이터, 공유 컴포넌트 (Icon, ScoreRing, Stat 등)
│   ├── tweaks-panel.jsx        # 우하단 Tweaks 패널 (테마/밀도/Accent 조정)
│   └── package.json
│
└── capstone_dataset/           # Python ML 서버
    ├── api/
    │   └── main.py             # FastAPI 앱 (uvicorn api.main:app)
    ├── inference/
    │   └── healer.py           # 자가치유 파이프라인 (_safe_select_one 포함)
    └── venv/
```
