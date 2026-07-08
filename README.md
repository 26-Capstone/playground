# DOMA — Self-Healing Web Scraper

CSS 셀렉터가 깨졌을 때 ML + LLM으로 자동 복구하는 웹 스크래퍼 관리 플랫폼.

**라이브:** [https://doma.io.kr](https://doma.io.kr)

---

## 목차

1. [아키텍처 개요](#아키텍처-개요)
2. [자가치유 흐름](#자가치유-흐름)
3. [실행 방법](#실행-방법)
4. [배포](#배포)
5. [API 레퍼런스](#api-레퍼런스)
6. [User Journey](#user-journey)
7. [파일 구조](#파일-구조)

---

## 아키텍처 개요

```
브라우저 (React + Babel CDN)
    │  HTTPS → https://doma.io.kr
    ▼
nginx (리버스 프록시 · SSL)
    │  → localhost:3001
    ▼
Node.js (Playwright 스크래퍼 · 정적 파일 서빙 · /api 프록시) ← :3001
    │  /api/* /fetch-html /heal → spring-server:8080
    ▼
Spring Boot (REST API · 동적 스케줄러 · DB · Webhook)  ← :8080
    │  /heal → python-ai:8000
    ▼
Python FastAPI (ML 추론 · 자가치유)  ← :8000
PostgreSQL                           ← :5432
```

| 서비스 | 역할 |
|--------|------|
| **node-scraper** | 정적 파일 서빙, `/api/*` Spring 프록시, Playwright 스크래핑, WebSocket |
| **spring-server** | REST API, PostgreSQL 연동, 동적 스케줄러, Webhook 알람 |
| **python-ai** | Random Forest + Claude 기반 셀렉터 자가치유 |
| **postgres** | 스크래퍼 · 실행 이력 · 자가치유 제안 저장 |

---

## 자가치유 흐름

```
스크래퍼 실행 (Spring → Node.js Playwright)
    │
    ├─ 성공 → DB 업데이트 (status=healthy) → Webhook 알람 조건 검사
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

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- OpenAI API 키 (자가치유 LLM 사용 시)

### 1. 환경 변수 설정

```env
OPENAI_API_KEY=sk-...
DB_PASSWORD=doma
DOMA_API_TOKEN=           # 외부 API 인증 토큰 (선택)
```

### 2. 실행

```bash
docker compose up -d --build
```

### 3. 접속

| 서비스 | URL |
|--------|-----|
| 대시보드 | http://localhost:3001 |
| Spring Boot API | http://localhost:8080/api/scrapers |
| Python AI | http://localhost:8000/docs |

### 4. 유용한 명령어

```bash
docker compose ps                              # 컨테이너 상태
docker compose logs spring-server -f           # Spring 로그
docker compose logs node-scraper -f            # Node 로그
docker compose up -d --build spring-server     # Spring 재빌드
docker compose down                            # 중단 (데이터 유지)
docker compose down -v                         # 중단 + DB 삭제
```

---

## 배포

**운영 환경:** AWS EC2 (t3.small, Ubuntu 24.04) + nginx + Let's Encrypt

### CI/CD

`main` 브랜치에 push하면 GitHub Actions가 자동으로 EC2에 배포합니다.

```
git push origin main → GitHub Actions → SSH → EC2 docker compose up -d --build
```

**필요한 GitHub Secrets:**

| Secret | 값 |
|---|---|
| `EC2_HOST` | EC2 퍼블릭 IP |
| `EC2_SSH_KEY` | `.pem` 키 파일 전체 내용 |

---

## API 레퍼런스

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/scrapers` | 스크래퍼 목록 |
| POST | `/api/scrapers` | 스크래퍼 등록 |
| GET | `/api/scrapers/:id` | 스크래퍼 단건 조회 |
| DELETE | `/api/scrapers/:id` | 스크래퍼 삭제 |
| POST | `/api/scrapers/:id/run` | 즉시 실행 |
| PATCH | `/api/scrapers/:id/selector` | 셀렉터 수정 |
| PATCH | `/api/scrapers/:id/settings` | 설정 변경 (스케줄·임계값·Webhook) |
| POST | `/api/scrapers/:id/webhook-test` | Webhook 테스트 발송 |
| GET | `/api/scrapers/:id/results` | 실행 이력 (최근 50건) |
| GET | `/api/scrapers/:id/results/csv` | 결과 CSV 다운로드 |
| GET | `/api/scrapers/:id/snapshot` | V1 HTML 스냅샷 |
| GET | `/api/stats` | 대시보드 통계 |
| GET | `/api/scheduler/status` | 스케줄러 현황 |
| GET | `/api/v1/scrapers/:id/data` | 외부 데이터 조회 (Bearer 토큰 인증) |

---

## User Journey

### 1. 스크래퍼 등록

1. **"새 스크래퍼"** 버튼 클릭
2. URL 입력 → 미리보기 렌더링
3. 수집 목적 자연어 입력
4. 내장 브라우저에서 수집 대상 클릭 → CSS 셀렉터 자동 생성
5. 실행 주기·신뢰도 임계값 설정
6. 생성 → PostgreSQL 저장 + 스케줄러 즉시 등록

### 2. 모니터링

- 스크래퍼 목록: 상태 칩·최근 수집값·스파크라인
- 30초마다 자동 갱신

### 3. 상세 화면 탭

| 탭 | 내용 |
|---|---|
| Overview | 수집값 차트, 현재 셀렉터, 통계 |
| Runs | 실행 이력 타임라인, CSV 다운로드 |
| Settings | 스케줄·임계값·Webhook 알람 설정 |

### 4. Webhook 알람

Settings 탭에서 설정:

- **텍스트 수집값**: 값이 바뀔 때 발송
- **숫자 수집값**: 변동폭 초과 또는 범위 이탈 시 발송
- **지원 포맷**: Generic JSON / Slack Block Kit

### 5. 승인 큐

자가치유 신뢰도 미달 시 사이드바에 배지 표시 → 제안 비교 후 승인/거부

---

## 파일 구조

```
Playground/
├── .env                        # 환경 변수
├── docker-compose.yml          # 서비스 오케스트레이션
├── deploy/
│   └── nginx.conf              # EC2 nginx 설정 (SSL 포함)
├── .github/workflows/
│   └── deploy.yml              # GitHub Actions CI/CD
│
├── client/                     # 프론트엔드 (React + Babel CDN)
│   ├── DOMA.html               # 진입점
│   ├── app.jsx                 # 앱 루트
│   ├── screens.jsx             # 전체 화면 컴포넌트
│   ├── data.jsx                # 공유 컴포넌트·유틸
│   └── tweaks-panel.jsx        # 테마 조정 패널
│
├── server/                     # Node.js 스크래퍼 서비스
│   ├── server.js               # Express + /internal/* API
│   ├── scraper.js              # Playwright 실행 엔진
│   └── Dockerfile
│
├── spring-server/              # Spring Boot 서비스
│   └── src/main/java/com/doma/
│       ├── controller/         # REST API
│       ├── service/            # 비즈니스 로직 (스케줄러·Webhook·자가치유)
│       ├── domain/             # JPA 엔티티
│       ├── repository/
│       ├── security/           # Bearer 토큰 인증
│       └── config/
│
└── ai/                         # Python AI 서비스
    ├── api/main.py             # FastAPI
    ├── inference/healer.py     # 자가치유 파이프라인
    └── models/                 # 학습된 ML 모델
```
