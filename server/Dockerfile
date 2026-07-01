# Stage 1: Vite 클라이언트 빌드
FROM node:20-alpine AS client-builder
WORKDIR /client
COPY client/package*.json ./
RUN npm install
COPY client .
RUN npm run build

# Stage 2: 서버
FROM node:20
WORKDIR /app
COPY server/package*.json ./
RUN npm install && npx playwright install --with-deps chromium

COPY server/server.js server/scraper.js ./
COPY --from=client-builder /client/dist ./dist
RUN mkdir -p snapshots

EXPOSE 3001
CMD ["node", "server.js"]
