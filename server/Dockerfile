FROM node:20 AS client-builder
WORKDIR /app
COPY package*.json ./
COPY client/package*.json client/
RUN npm install
COPY client/ client/
RUN npm run build --workspace=client

FROM node:20
WORKDIR /app
COPY server/package*.json ./
RUN npm install && npx playwright install --with-deps chromium

COPY server/server.js server/scraper.js server/browserLimiter.js server/extractText.js server/viewport.js ./
RUN mkdir -p snapshots
COPY --from=client-builder /app/client/dist ./client

EXPOSE 3001
CMD ["node", "server.js"]
