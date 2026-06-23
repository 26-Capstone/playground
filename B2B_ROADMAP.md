# DOMA B2B 전환 로드맵

> 대안데이터 무중단 스크래핑 플랫폼 — 사내 데이터 전문가 대상 B2B 서비스 기준

---

## 1. 수집값 시계열 시각화

**문제**: 현재 스파크라인은 셀렉터 신뢰도만 표시. 데이터 전문가의 핵심 관심사인 **값 자체의 변화**를 볼 수 없음.

### 구현 항목

- **값 변화 차트** (크롤러 상세 > 새 탭)
  - X축: 수집 일시, Y축: 수집값 (숫자형 자동 감지 시 라인 차트, 텍스트형은 diff 뷰)
  - `crawl_results.value` 컬럼을 시계열로 렌더링
  - 날짜 범위 필터 (7일 / 30일 / 전체)

- **값 변화 감지 알림 조건**
  - 이전 값 대비 N% 이상 변화 시 플래그 표시
  - 크롤러 생성 시 "값 변화 알림 임계값" 옵션 추가

- **필요한 DB 변경 없음** — `crawl_results.value`에 이미 값이 저장됨. UI + API 쿼리만 추가하면 됨.

---

## 2. 알림 시스템 (Notification)

**문제**: 크롤러 실패·치유 발생 시 UI를 열어봐야만 인지 가능. 실운영 환경에서 사용 불가 수준.

### 구현 항목

- **알림 채널**: 슬랙 Webhook / 이메일 (SMTP) — 크롤러별로 채널 선택 (`channels` 컬럼 이미 존재)

- **알림 트리거 조건**
  | 이벤트 | 기본 설정 |
  |--------|-----------|
  | 크롤러 실패 연속 N회 | 3회 |
  | 자가치유 발동 | 즉시 |
  | 신뢰도 미달 → 승인 대기 | 즉시 |
  | 크롤러 복구 완료 | 즉시 |

- **구현 위치**: `crawler.js`의 각 상태 전환 시점에 `notify(crawlerId, event)` 호출 추가

- **필요한 DB 변경**
  - `crawlers` 테이블에 `slack_webhook TEXT`, `notify_email TEXT` 컬럼 추가
  - 또는 별도 `notification_settings` 테이블

---

## 3. 데이터 소비 경로 (API Access)

**문제**: 수집된 값을 가져가는 방법이 없음. B2B 고객은 수집된 데이터를 자신의 시스템에서 소비해야 함.

### 구현 항목

- **REST API 엔드포인트**
  ```
  GET /api/v1/crawlers/:id/data?from=&to=&limit=
  ```
  - 응답: `[{ run_at, value, status, score }, ...]`
  - 날짜 범위, 상태 필터, 페이지네이션 지원

- **API Key 인증**
  - `api_keys` 테이블 (key, org_id, created_at, expires_at)
  - 요청 헤더: `Authorization: Bearer <api_key>`
  - UI에서 키 발급 / 폐기 가능

- **API 문서 페이지**
  - 현재 "채널" 옵션에 `REST API`가 이미 있으나 실제 동작 없음
  - 크롤러 상세에 "API 연동" 탭 추가 (엔드포인트 URL + curl 예시 + 현재 API Key 표시)

---

## 4. 다중 사용자 / 팀 관리

**문제**: `org`, `owner` 필드는 있으나 UI에서 팀 단위 접근 제어 불가.

### 구현 항목

- **로그인 / 세션 관리**
  - 현재 인증 없음 → 최소한 단일 비밀번호 or OAuth (Google Workspace) 추가
  - B2B 환경에서는 조직 단위 로그인이 현실적

- **권한 모델**
  | 역할 | 권한 |
  |------|------|
  | Admin | 전체 크롤러 생성·삭제·설정 |
  | Editor | 담당 크롤러 수정·실행 |
  | Viewer | 조회·CSV 다운로드만 가능 |

- **조직(Org) 격리**
  - 현재 `crawlers.org` 컬럼 활용
  - 로그인한 사용자의 org에 속한 크롤러만 표시

- **필요한 DB 변경**
  - `users` 테이블 (id, email, org, role, password_hash)
  - `sessions` 테이블 또는 JWT 사용

---

## 5. CSS 셀렉터 추상화

**문제**: 비기술 분석가가 셀렉터를 직접 다루기 어려움.

### 구현 항목

- **셀렉터 자동 제안 강화**
  - 현재 클릭 한 번으로 셀렉터 생성됨 — 이 UX는 유지
  - 단, 생성된 셀렉터를 사용자에게 그대로 노출하지 않고 "수집 대상: 상품명 첫 번째 항목" 같은 자연어 설명으로 대체 표시

- **URL + 수집 의도 입력만으로 자동 셀렉터 추천**
  - Wizard 3단계에서 `user_intent` 텍스트를 Python ML API에 전달해 후보 셀렉터 자동 추천
  - 현재는 클릭 필수 → intent 기반 자동 제안을 우선 표시

---

## 6. CSV 데이터 변화 로그 내보내기

### 제공할 데이터

`crawl_results` 테이블 기반:

```
수집일시 | 크롤러명 | URL | 수집값 | 이전값 | 값 변화 | 신뢰도 | 상태 | 응답시간(ms)
```

- **값 변화 컬럼**: 직전 수집값과의 diff (숫자형이면 `+3.2%`, 텍스트면 `변경됨`)
- **이전값 컬럼**: 비교 기준값 (직전 healthy 결과)

### 서버 구현

**엔드포인트**

```
GET /api/crawlers/:id/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&status=healthy
GET /api/export.csv?crawlers=id1,id2,id3&from=&to=          ← 복수 크롤러 통합
```

**응답 헤더**
```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="doma_export_20260527.csv"
```

**구현 포인트**
- BOM (`﻿`) 삽입 필수 — 엑셀에서 한글 깨짐 방지
- `value`에 쉼표·줄바꿈 포함 가능 → 큰따옴표 이스케이프 처리
- 5만 건 이상 시 스트리밍 방식(`res.write` 청크) 권장 — 메모리 한번에 올리지 않음
- `crawl_results` 쿼리에 날짜 범위 WHERE절 추가 (현재 `LIMIT 50` 쿼리를 범용 쿼리로 분리)

**값 변화 계산 (서버에서 처리)**
```
이전값 = 같은 crawler_id 기준 직전 healthy 결과의 value
값 변화 = 숫자 파싱 가능 시 ((현재 - 이전) / 이전 * 100).toFixed(2) + '%'
         텍스트 변경 시 '변경됨' / 동일 시 '—'
```

### 클라이언트 구현

**진입점 1 — 크롤러 상세 > 실행 이력 섹션**
- "CSV 내보내기" 버튼 + 날짜 범위 선택 (선택 사항)
- 클릭 시 `<a href="/api/crawlers/:id/export.csv" download>` 트리거

**진입점 2 — 개요 화면**
- 크롤러 목록 우상단에 "전체 내보내기" 버튼
- 체크박스로 크롤러 선택 → `/api/export.csv?crawlers=...` 호출

### 필요한 DB 변경

없음. 현재 `crawl_results` 스키마로 충분. 단, 성능을 위해 `run_at` 컬럼에 인덱스 추가 권장:

```sql
CREATE INDEX IF NOT EXISTS idx_crawl_results_run_at ON crawl_results(crawler_id, run_at DESC);
```

---

## 우선순위 제안

| 순위 | 항목 | 이유 |
|------|------|------|
| 1 | CSV 내보내기 | 구현 쉽고, 데이터 전문가 즉시 가치 체감 |
| 2 | 알림 시스템 | 실운영 진입 조건. 없으면 B2B 설득 불가 |
| 3 | 수집값 시계열 시각화 | 핵심 가치 증명 (데이터가 실제로 바뀌는 걸 보여줘야 함) |
| 4 | REST API + API Key | 고객이 직접 소비하는 경로 |
| 5 | 다중 사용자 / 팀 관리 | 조직 판매 시 필수 |
| 6 | 셀렉터 추상화 | 비기술 사용자 확장 시 |
