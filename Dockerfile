FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# o banco mora em /app/data, que no Coolify precisa ser um volume persistente (Storages -> /app/data); sem isso ele se perde a cada deploy.
# O valor definido nas variaveis do Coolify continua mandando.
ENV DB_PATH=/app/data/data.sqlite

EXPOSE 3000
CMD ["node", "dist/src/index.js"]
