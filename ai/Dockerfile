FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# inference에 필요한 파일만 복사 (venv, data, src 제외)
COPY api/       ./api/
COPY inference/ ./inference/
COPY models/    ./models/

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
