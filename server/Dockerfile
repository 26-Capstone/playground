FROM node:20

WORKDIR /app
COPY package*.json ./
RUN npm install && npx playwright install --with-deps chromium

COPY server.js scraper.js ./
RUN mkdir -p snapshots

EXPOSE 3001
CMD ["node", "server.js"]
