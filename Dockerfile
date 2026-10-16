# syntax=docker/dockerfile:1
# NODE_IMAGE pode ser trocado (ex.: node:24-bookworm) — a instalação do OpenSSL só roda se faltar.
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
# O motor do Prisma precisa da libssl3 (ausente na imagem slim).
RUN if ! ldconfig -p | grep -q 'libssl.so.3'; then \
      apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*; \
    fi

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM base
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
RUN mkdir -p /app/data/bible && chown -R node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://localhost:'+(process.env.HEALTH_PORT||process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Aplica migrações pendentes (CLI do Prisma é dependência de produção) e inicia o bot.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/src/index.js"]
