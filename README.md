# Mender — Self-Healing Web Scraper

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

## 구현 내역

### Phase 1 — SQLite 데이터 영속성

**파일:** `server/db.js`

- `crawlers` 테이블: id, name, url, css_selector, user_intent, threshold, schedule, channels, status, score, last_value, last_run_at, healed_count
- `crawl_results` 테이블: 실행 이력 (status, value, score, duration_ms, note)
- `heal_proposals` 테이블: 자가치유 제안 (old_selector, proposed_selector, confidence, reasoning, status)
- `dbRowToCrawler()`: DB row → 프론트엔드 shape 변환 (schedule 키→레이블, channels JSON 파싱 등)
- 크롤러 삭제 시 트랜잭션으로 연관 데이터(results, proposals) 캐스케이드 삭제

### Phase 2 — Playwright 크롤러 실행 엔진

**파일:** `server/crawler.js`

- `runCrawler(crawlerId)`: Playwright headless Chrome으로 URL 접속 → CSS 셀렉터로 값 추출
- 최초 실행 시 V1 HTML 스냅샷 저장 (`server/snapshots/{id}_v1.html`)
- 최근 20건 성공률로 score 재계산
- 추출 실패 시 `tryHeal()` 자동 호출
- `tryHeal()`: V1 스냅샷 + 현재 HTML을 Python `/heal`에 전송 → 3분기 신뢰도 판단 후 처리

### Phase 3 — node-cron 스케줄러

**파일:** `server/scheduler.js`

| 스케줄 키 | Cron 표현식 | 설명 |
|-----------|-------------|------|
| `daily-9` | `0 9 * * *` | 매일 09:00 |
| `hourly`  | `0 * * * *` | 매시간 정각 |
| `15m`     | `*/15 * * * *` | 15분 간격 |

- 서버 시작 시 DB의 모든 크롤러를 `initScheduler()`로 일괄 등록
- `running` Set으로 동시 중복 실행 방지
- 크롤러 등록/삭제 시 `addJob()` / `removeJob()` 즉시 반영

### Phase 4 — 승인 큐 (Human-in-the-Loop)

**파일:** `server/db.js`, `server/crawler.js`, `server/server.js`, `client/app.jsx`, `client/screens.jsx`

- `tryHeal()` 3분기 로직:
  - `status='healed'` AND `confidence ≥ threshold/100` → 셀렉터 자동 교체, `status=healthy`
  - `status='healed'` AND `confidence < threshold/100` → `heal_proposals`에 저장, `status=pending`
  - `status='failed'` 또는 기타 → `status=failed`, **제안 저장 안 함**
- 승인 시: `css_selector` 교체 + `status=healthy` + `healed_count+1`
- 거부 시: `status=failed`, 제안 `rejected` 처리
- 사이드바 "승인 큐" 배지에 실시간 대기 건수 표시 (0이면 숨김)
- `ApprovalsScreen`: 목록 뷰(대기 테이블) + 상세 뷰(셀렉터 비교, AI 추론 근거, 신뢰도 링) 두 단계 UI

### Phase 5 — 대시보드 실데이터 연결

**파일:** `server/db.js`, `server/server.js`, `client/app.jsx`, `client/screens.jsx`

- `GET /api/stats`: 집계 통계 엔드포인트
  - 활성 피드 수 (status ≠ paused)
  - 7일 수집 성공률
  - 누적 자가치유 수
  - 평균/P95 응답시간
- `GET /api/crawlers` 응답에 `spark` 배열 포함 (최근 20개 score, 스파크라인용)
- Overview Stat 카드 4개 모두 실데이터 반영
- 승인 배너 동적화: 대기 건수 0이면 숨김, 실제 건수 표시
- 새로고침 버튼: 크롤러 목록 + 통계 + 승인 큐 동시 갱신
- **Detail Overview 탭**: 실행 이력 API 연결 → score 추이 차트(Y축 0–100), 최근 수집 JSON, 현재 셀렉터, 집계 통계 모두 실데이터

### Phase 6 — 크롤러 삭제

**파일:** `server/db.js`, `server/server.js`, `client/app.jsx`, `client/screens.jsx`

- `DELETE /api/crawlers/:id`: proposals → results → crawlers 트랜잭션 캐스케이드 삭제
- 삭제 진입점 2곳:
  - **Overview 테이블**: 행 우측 `…` 드롭다운 → "삭제"
  - **Detail 화면 헤더**: "삭제" 버튼 → 인라인 2단계 확인 후 실행

### Phase 7 — 승인 큐 버그 수정

**파일:** `server/crawler.js`, `capstone_dataset/inference/healer.py`

**버그 1** — 빈 제안(`proposed_selector: ''`)이 큐에 저장되는 문제  
원인: `tryHeal()` `else` 분기가 Python `status='failed'` 응답에도 `db.proposals.insert()` 호출  
수정: 명시적 3분기 조건으로 분리 (Phase 4 참고)

**버그 2** — Tailwind 임의값 클래스 셀렉터가 BeautifulSoup에서 파싱 실패  
원인: Playwright 생성 셀렉터에 `min-h-\[170px\]`, `w-\[516px\]` 등 포함 → `select_one()` 예외  
수정: `healer.py`에 `_safe_select_one()` 헬퍼 추가 — 파싱 실패 시 임의값 패턴 제거 후 재시도

```python
def _safe_select_one(soup, selector):
    try:
        node = soup.select_one(selector)
        if node: return node
    except Exception:
        pass
    simplified = re.sub(r'[\w-]+\\\[.*?\\\]', '', selector)
    ...
    return soup.select_one(simplified)
```

### Phase 8 — 셀렉터 선택기 팝업 제거 도구

**파일:** `server/server.js`, `client/screens.jsx`

크롤러 등록 Step 3(요소 선택 화면)에서 팝업·모달이 원하는 요소를 가리는 문제 해결.

**서버 — 새 WebSocket 메시지 타입**

| type | 동작 |
|------|------|
| `keypress` | `page.keyboard.press(msg.key)` |
| `remove_overlays` | JS 주입으로 `[role="dialog"]`, 고 z-index fixed/absolute 요소, 공통 팝업 클래스 일괄 삭제 + body overflow 해제 |
| `remove_element` | `document.elementFromPoint(x, y).remove()` |

**클라이언트 — 팝업 제거 툴바** (URL 바 아래 항상 노출)

| 버튼 | 동작 |
|------|------|
| **ESC** | Escape 키 전송 → 네이티브 모달 닫기 |
| **자동 제거** | `remove_overlays` 전송 → 감지된 팝업 전부 삭제 |
| **요소 지우기** | 토글 ON 시 클릭이 셀렉터 선택 대신 DOM 삭제로 동작, 커서 `not-allowed` |

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

브라우저에서 `http://localhost:3001/Mender.html` 접속.

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
curl http://localhost:3001/api/crawlers
curl http://localhost:3001/api/stats
curl http://localhost:3001/api/approvals
curl http://localhost:3001/api/scheduler/status

# 특정 크롤러 즉시 실행
curl -X POST http://localhost:3001/api/crawlers/{id}/run
```

### 포트 충돌 해결

```bash
lsof -ti :3001 | xargs kill -9
```

---

## API 레퍼런스

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/crawlers` | 크롤러 목록 (spark 배열 포함) |
| POST | `/api/crawlers` | 크롤러 등록 |
| GET | `/api/crawlers/:id` | 크롤러 단건 조회 |
| DELETE | `/api/crawlers/:id` | 크롤러 삭제 (결과·제안 캐스케이드) |
| POST | `/api/crawlers/:id/run` | 크롤러 즉시 실행 |
| GET | `/api/crawlers/:id/results` | 실행 이력 (최근 50건) |
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
- 삭제 시 연관된 실행 이력(crawl_results)과 자가치유 제안(heal_proposals) 함께 삭제

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
│   ├── crawler.js              # Playwright 실행 엔진 + 자가치유 로직 (tryHeal 3분기)
│   ├── scheduler.js            # node-cron 스케줄 관리
│   ├── mender.db               # SQLite 데이터베이스 파일
│   ├── snapshots/              # V1 HTML 스냅샷 ({crawlerId}_v1.html)
│   └── package.json
│
├── client/
│   ├── Mender.html             # 진입점 HTML (React CDN, Babel, 스크립트 로드)
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
