# 로컬 환경 검증 가이드 — Self-Healing Crawler × Mender

> 두 서버를 띄우고 브라우저에서 실제 기능을 눌러보며 확인하는 절차입니다.

---

## 0. 사전 준비

```bash
# Python 패키지 확인
cd ~/Desktop/capstone_dataset
pip install -r requirements.txt

# Node.js 패키지 확인
cd ~/Desktop/Playground
npm install
```

---

## 1. 서버 실행 (터미널 2개)

### 터미널 A — Python FastAPI (포트 8000)

```bash
cd ~/Desktop/capstone_dataset
uvicorn api.main:app --reload --port 8000
```

정상 출력:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Application startup complete.
```

### 터미널 B — Mender Node.js (포트 3001)

```bash
cd ~/Desktop/Playground
npm start
```

정상 출력:
```
Mender → http://localhost:3001/Mender.html
```

---

## 2. 헬스체크 (curl)

두 서버가 뜬 직후 아래 명령으로 응답 확인:

```bash
# Python API
curl http://localhost:8000/health
# → {"status":"ok"}

# Node.js 프록시 (Python API 경유)
curl -s http://localhost:3001/heal \
  -H "Content-Type: application/json" \
  -d '{"v1_html":"<p id=a>hi</p>","v2_html":"<p id=b>hi</p>","css_selector":"#a","user_intent":"텍스트"}' \
  | python3 -m json.tool
# → {"status":"healed"|"no_change_needed"|"failed", "robust_selector":"...", ...}
```

---

## 3. 브라우저 UI 검증

브라우저에서 접속:
```
http://localhost:3001/Mender.html
```

---

### 3-A. 자가치유 패널 (HealPanel) 테스트

**목적**: 깨진 CSS 셀렉터를 ML + GPT가 복구하는지 확인

1. 사이드바에서 **`쿠팡 최저가`(pending)** 또는 **`옥션 베스트`(failed)** 크롤러 클릭
2. 상세 화면 우상단 **"자가치유 실행"** 버튼 클릭
3. HealPanel이 열리면:

   **V1 HTML (구버전)**
   - `파일 선택` 클릭 →  `~/Desktop/capstone_dataset/data/testdata/html1_v1.html` 업로드

   **V2 HTML (신버전)**
   - `파일 선택` 클릭 → `~/Desktop/capstone_dataset/data/testdata/html1_v2.html` 업로드

   **셀렉터 · 의도** — 크롤러 데이터로 자동 채워짐 (직접 수정도 가능)

4. **"자가치유 실행"** 버튼 클릭
5. 결과 확인:

   | 항목 | 의미 |
   |------|------|
   | 상태 배지 (`healed` / `no_change_needed`) | 치유 성공 여부 |
   | 추출된 텍스트 | 새 셀렉터로 실제 추출한 값 |
   | 복구된 셀렉터 | AI가 제안한 대체 CSS 셀렉터 |
   | AI 근거 | GPT-4o-mini의 선택 이유 |
   | 신뢰도 | 0.0 ~ 1.0 (Random Forest 확률) |

> **추천 테스트 쌍**: `html1_v1.html` / `html1_v2.html` ~ `html10_v1.html` / `html10_v2.html`  
> 경로: `~/Desktop/capstone_dataset/data/testdata/`

---

### 3-B. URL에서 HTML 직접 가져오기

HealPanel 내 **"URL에서 가져오기"** 버튼으로 실시간 HTML을 수집할 수 있습니다.

테스트에 적합한 봇 친화적 URL (쿠팡·네이버쇼핑은 안티봇으로 차단됨):

```
https://www.melon.com/chart/index.htm          # 멜론 차트
https://www.jobkorea.co.kr/Search/?stext=python # 잡코리아 검색결과
https://dart.fss.or.kr/main.do                 # 금융감독원 DART
https://news.ycombinator.com                   # Hacker News
```

---

### 3-C. 신규 크롤러 등록 (셀렉터 추출 위저드)

**목적**: Playwright 스크린캐스트 + WebSocket 기능 확인

1. 사이드바 **"+ 새 크롤러"** 버튼 클릭
2. URL 입력창에 아래 URL 입력 후 이동:
   ```
   https://news.ycombinator.com
   ```
3. 스크린캐스트가 브라우저 화면을 스트리밍하면 ✅
4. 마우스를 화면 위에서 움직이면 파란 하이라이트 박스가 따라와야 함
5. 원하는 요소(뉴스 제목 등)를 **클릭** → 우측 패널에 CSS 셀렉터 자동 추출
6. **"등록"** 버튼으로 크롤러 저장

---

## 4. API 직접 호출 (curl 심화)

### /heal 엔드포인트

```bash
# testdata html 파일로 직접 요청
V1=$(cat ~/Desktop/capstone_dataset/data/testdata/html1_v1.html)
V2=$(cat ~/Desktop/capstone_dataset/data/testdata/html1_v2.html)

curl -s http://localhost:3001/heal \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json, sys
print(json.dumps({
  'v1_html': open('$HOME/Desktop/capstone_dataset/data/testdata/html1_v1.html').read(),
  'v2_html': open('$HOME/Desktop/capstone_dataset/data/testdata/html1_v2.html').read(),
  'css_selector': 'div.price',
  'user_intent': '상품 가격을 추출해줘',
  'target_name': 'test'
}))
")" | python3 -m json.tool
```

### /fetch-html 엔드포인트

```bash
curl -s http://localhost:3001/fetch-html \
  -H "Content-Type: application/json" \
  -d '{"url":"https://news.ycombinator.com"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['html'][:500])"
```

---

## 5. 예상 결과 요약

| 검증 항목 | 예상 결과 |
|---------|---------|
| `GET /health` | `{"status":"ok"}` |
| HealPanel 파일 업로드 후 치유 실행 | `status: healed` + 새 셀렉터 반환 |
| URL에서 가져오기 (봇 비차단 사이트) | HTML 로드 후 V1/V2 박스 채워짐 |
| 크롤러 등록 위저드 스크린캐스트 | 실시간 화면 스트리밍 + 클릭 시 셀렉터 추출 |
| 쿠팡·네이버 등 안티봇 사이트 | `Access Denied` (정상 — 코드 문제 아님) |

---

## 6. 트러블슈팅

### Python API가 안 뜰 때
```bash
# 포트 확인
lsof -i :8000
# .env 확인
cat ~/Desktop/capstone_dataset/.env
# 수동 키 확인
cd ~/Desktop/capstone_dataset && python3 -c "from dotenv import load_dotenv; import os; load_dotenv(); print(os.getenv('OPENAI_API_KEY','NOT SET')[:20])"
```

### Node.js 포트 충돌
```bash
lsof -ti :3001 | xargs kill -9
npm start
```

### 치유 결과가 `failed`로 반환될 때
- `.env`의 `OPENAI_API_KEY` 값이 유효한지 확인 (OpenAI 콘솔에서 사용량 확인)
- ML 모델 파일 존재 확인: `ls ~/Desktop/capstone_dataset/models/`
- FastAPI 터미널에서 스택 트레이스 확인

### HealPanel이 안 보일 때
- 크롤러 상태가 `failed` 또는 `pending`인 크롤러만 "자가치유 실행" 버튼이 표시됨
- `running` / `success` 상태 크롤러에는 버튼 없음
