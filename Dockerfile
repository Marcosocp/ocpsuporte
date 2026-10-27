# Imagem de produção do OCP Suporte (roda no ZGX; arm64 e amd64).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY views ./views
COPY public ./public
COPY migracoes ./migracoes
COPY src ./src
COPY scripts ./scripts
USER node
EXPOSE 3200
CMD ["node", "dist/server.js"]
