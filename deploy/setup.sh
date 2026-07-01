#!/bin/bash
# EC2 초기 세팅 스크립트 (Ubuntu 22.04)
set -e

echo "=== 1. 시스템 업데이트 ==="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "=== 2. Docker 설치 ==="
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

echo "=== 3. Docker Compose 설치 ==="
sudo apt-get install -y docker-compose-plugin

echo "=== 4. nginx + Certbot 설치 ==="
sudo apt-get install -y nginx certbot python3-certbot-nginx

echo "=== 5. 프로젝트 클론 ==="
git clone https://github.com/26-Capstone/doma.git ~/doma
cd ~/doma

echo "=== 6. .env 파일 생성 (직접 값 입력 필요) ==="
cat > .env << 'EOF'
OPENAI_API_KEY=sk-...
DB_PASSWORD=변경하세요
DOMA_API_TOKEN=
EOF
echo ".env 파일을 편집하세요: nano ~/doma/.env"

echo "=== 7. nginx 설정 복사 ==="
sudo cp deploy/nginx.conf /etc/nginx/sites-available/doma
sudo ln -sf /etc/nginx/sites-available/doma /etc/nginx/sites-enabled/doma
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "=== 8. SSL 인증서 발급 ==="
echo "아래 명령어를 직접 실행하세요:"
echo "  sudo certbot --nginx -d doma.io.kr -d www.doma.io.kr"

echo "=== 9. 서비스 시작 ==="
echo "아래 명령어를 직접 실행하세요:"
echo "  cd ~/doma && docker compose up -d"

echo ""
echo "완료! .env 편집 → certbot → docker compose up -d 순서로 진행하세요."
