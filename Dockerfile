# build: instala TODAS as deps (incluindo typescript/ts-node-dev) e compila.
# Fica so nesse estagio -- nao vai pra imagem final.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# runtime: so o necessario pra rodar (sem devDependencies, sem codigo fonte
# .ts) e um usuario sem privilegio de root -- achados da auditoria: a imagem
# antiga rodava como root e misturava devDependencies (typescript,
# ts-node-dev...) na imagem final, sem motivo (nada disso e usado em producao).
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
# /app/data e onde o SQLite (DB_PATH) e a sessao evolution costumam morar --
# cria com dono certo ANTES de trocar de usuario, pra funcionar tanto com
# volume nomeado (Docker copia o conteudo/dono do diretorio da imagem no
# primeiro mount) quanto sem volume nenhum (dev/teste rapido).
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "dist/src/index.js"]
