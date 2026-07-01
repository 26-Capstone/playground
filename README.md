# DOMA — Self-Healing Web Scraper

CSS 셀렉터가 깨졌을 때 ML + LLM으로 자동 복구하는 웹 스크래퍼 관리 플랫폼.

---

## 목차

1. [아키텍처 개요](#아키텍처-개요)
2. [자가치유 흐름](#자가치유-흐름)
3. [실행 방법](#실행-방법)
4. [API 레퍼런스](#api-레퍼런스)
5. [User Journey](#user-journey)
6. [파일 구조](#파일-구조)

---

## 아키텍처 개요

```
브라우저 (React + Babel CDN)
    │  HTTP /api/*  (nginx → Spring Boot)
    │  WebSocket    (ws://localhost:3001 직접)
    ▼
nginx                                    ← :80
    │  /api/*  → spring-server:8080
    │  정적 파일 서빙 (client/)
    ▼
Spring Boot (REST API · 스케줄러 · DB)   ← :8080
    │  /internal/run  → node-scraper:3001
    │  /heal          → python-ai:8000
    ▼
Node.js (Playwright 스크래퍼 · WebSocket) ← :3001
Python FastAPI (ML 추론 · 자가치유)       ← :8000
PostgreSQL                               ← :5432
```

| 서비스 | 역할 |
|--------|------|
| **nginx** | 프론트엔드 정적 파일 서빙, `/api/*` 리버스 프록시 |
| **spring-server** | REST API, PostgreSQL 연동, 동적 스케줄러 |
| **node-scraper** | Playwright 스크래핑, WebSocket 원격 브라우저 스트리밍 |
| **python-ai** | Random Forest + GPT-4o-mini 기반 셀렉터 자가치유 |
| **postgres** | 스크래퍼 · 실행 이력 · 자가치유 제안 저장 |

---

## 자가치유 흐름

```
스크래퍼 실행 (Spring → Node.js Playwright)
    │
    ├─ 성공 → DB 업데이트 (status=healthy)
    │
    └─ 실패 → Node.js로부터 V1 HTML 스냅샷 조회
                │
                └─ Python AI /heal 호출
                        │
                        ├─ confidence ≥ threshold
                        │    → 셀렉터 자동 교체 (status=healthy)
                        │
                        ├─ confidence < threshold
                        │    → 승인 큐 저장 (status=pending)
                        │
                        └─ 치유 불가
                             → status=failed
```

---

## 실행 방법

### 사전 요구사항

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Docker + Docker Compose 포함)
- OpenAI API 키 (자가치유 LLM 사용 시)

### 1. 환경 변수 설정

프로젝트 루트에 `.env` 파일 생성:

```env
OPENAI_API_KEY=sk-...
DB_PASSWORD=doma
DOMA_API_TOKEN=           # 외부 API 인증 토큰 (선택)
```

> `.env`는 절대 git에 커밋하지 마세요. `.gitignore`에 포함되어 있습니다.

### 2. 전체 서비스 실행

```bash
docker compose up -d --build
```

최초 실행 시 Spring Boot·Node.js·Python AI 이미지를 빌드합니다 (5–10분 소요).

### 3. 접속

| 서비스 | URL |
|--------|-----|
| 대시보드 | http://localhost |
| Spring Boot API | http://localhost:8080/api/scrapers |
| Node.js 스크래퍼 | http://localhost:3001 |
| Python AI | http://localhost:8000/docs |

### 4. 동작 확인

```bash
# 컨테이너 상태
docker compose ps

# 로그 확인
docker compose logs spring-server -f
docker compose logs node-scraper -f

# API 테스트
curl http://localhost/api/scrapers
curl http://localhost/api/stats
curl -X POST http://localhost/api/scrapers/{id}/run
```

### 5. 서비스 중단

```bash
docker compose down          # 컨테이너 중단 (데이터 유지)
docker compose down -v       # 컨테이너 + DB 볼륨 삭제
```

### 특정 서비스만 재빌드

```bash
docker compose up -d --build spring-server   # Spring 코드 변경 시
docker compose restart nginx                  # nginx.conf 변경 시
```

---

## API 레퍼런스

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/scrapers` | 스크래퍼 목록 (spark 배열 포함) |
| POST | `/api/scrapers` | 스크래퍼 등록 |
| GET | `/api/scrapers/:id` | 스크래퍼 단건 조회 |
| DELETE | `/api/scrapers/:id` | 스크래퍼 삭제 (이력·제안 캐스케이드) |
| POST | `/api/scrapers/:id/run` | 스크래퍼 즉시 실행 |
| GET | `/api/scrapers/:id/results` | 실행 이력 (최근 50건) |
| GET | `/api/stats` | 대시보드 집계 통계 |
| GET | `/api/approvals` | 승인 대기 제안 목록 |
| POST | `/api/approvals/:id/approve` | 제안 승인 (셀렉터 자동 교체) |
| POST | `/api/approvals/:id/reject` | 제안 거부 |
| GET | `/api/scheduler/status` | 스케줄러 현황 |
| WS | `ws://localhost:3001` | 원격 브라우저 스트리밍 (셀렉터 선택기) |

### 내부 API (Spring → Node.js 전용)

| Method | Path | 설명 |
|--------|------|------|
| POST | `/internal/run` | Playwright 스크래핑 실행 |
| GET | `/internal/snapshot/:id` | V1 HTML 스냅샷 조회 |
| DELETE | `/internal/snapshot/:id` | V1 스냅샷 삭제 |
| POST | `/internal/fetch-html` | 현재 페이지 HTML 수집 |

---

## User Journey

### 1. 스크래퍼 등록

1. 상단 **"새 스크래퍼"** 버튼 클릭
2. **Step 1 — 대상 페이지**: URL 입력 → 미리보기 자동 렌더링
3. **Step 2 — 추출 의도**: 자연어로 수집 목적 기술 (LLM 프롬프트로 사용)
4. **Step 3 — 요소 선택**: 내장 브라우저에서 수집 대상 클릭 → CSS 셀렉터 자동 생성
   - 팝업·모달이 뜨는 경우: **ESC** / **자동 제거** / **요소 지우기** 툴바 활용
5. **Step 4 — 운영 정책**: 실행 주기(15분·1시간·매일 09시) 및 자동 복구 신뢰도 임계값 설정
6. **"스크래퍼 생성"** → PostgreSQL 저장 + 스케줄러 즉시 등록

### 2. 모니터링

- **Overview 화면**: 등록된 스크래퍼 목록 테이블
  - 상태 칩 (healthy / healing / pending / failed / paused)
  - 최근 수집 값 · 실행 시각 · Score · 7일 스파크라인
- **상단 Stat 카드**: 활성 피드 수 / 7일 성공률 / 누적 자가치유 수 / 평균 응답시간
- 30초마다 자동 갱신, "새로고침" 버튼으로 즉시 갱신

### 3. 즉시 실행 및 상세

1. 테이블에서 행 클릭 → **Detail 화면**
2. **"지금 실행"** → Playwright 즉시 실행, 결과 업데이트
3. **Overview 탭**: Score 추이 차트, 현재 셀렉터, 운영 통계
4. **Runs 탭**: 실행 이력 타임라인
5. **Settings 탭**: 셀렉터 재선택, 임계값 조정

### 4. 승인 큐

1. 자가치유 신뢰도가 임계값 미달 시 사이드바 배지에 건수 표시
2. **승인 큐 화면**: 이전 셀렉터 / 제안 셀렉터 / AI 추론 근거 비교
3. **"승인"** → 셀렉터 즉시 교체, 스크래퍼 정상화
4. **"거부"** → failed 처리, 수동 셀렉터 재선택 필요

---

## 파일 구조

```
Playground/
├── .env                        # 환경 변수 (OPENAI_API_KEY, DB_PASSWORD 등)
├── docker-compose.yml          # 전체 서비스 오케스트레이션
├── nginx.conf                  # nginx 리버스 프록시 설정
│
├── client/                     # 프론트엔드 (React + Babel CDN, 빌드 불필요)
│   ├── DOMA.html               # 진입점
│   ├── app.jsx                 # 앱 루트: 라우팅, 상태, API 폴링
│   ├── screens.jsx             # 전체 화면 컴포넌트
│   ├── data.jsx                # 공유 컴포넌트, 템플릿 데이터
│   └── tweaks-panel.jsx        # 테마·밀도·Accent 조정 패널
│
├── server/                     # Node.js 스크래퍼 서비스
│   ├── server.js               # Express + WebSocket + /internal/* API
│   ├── scraper.js              # Playwright 실행 엔진
│   ├── Dockerfile
│   └── snapshots/              # V1 HTML 스냅샷 (Docker 볼륨)
│
├── spring-server/              # Spring Boot 서비스
│   ├── src/main/java/com/doma/
│   │   ├── controller/         # REST API 컨트롤러
│   │   ├── service/            # 비즈니스 로직 (스크래퍼·스케줄러·자가치유)
│   │   ├── domain/             # JPA 엔티티 (Scraper, ScrapeResult, HealProposal)
│   │   ├── repository/         # Spring Data JPA 레포지토리
│   │   ├── security/           # Bearer 토큰 인증 필터
│   │   └── config/             # AppConfig, WebConfig
│   ├── src/main/resources/application.yml
│   └── Dockerfile
│
└── ../capstone_dataset/        # Python AI 서비스 (별도 디렉토리)
    ├── api/main.py             # FastAPI 앱
    ├── inference/healer.py     # 자가치유 파이프라인
    ├── models/                 # 학습된 ML 모델
    └── Dockerfile
```
