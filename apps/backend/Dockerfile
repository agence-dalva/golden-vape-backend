# ── Stage 1 : build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Dépendances système minimales pour les packages natifs (ex: pg)
RUN apk add --no-cache python3 make g++

COPY package.json yarn.lock ./
COPY apps/backend/package.json ./apps/backend/package.json

RUN yarn install --frozen-lockfile --non-interactive

COPY apps/backend/ ./apps/backend/
WORKDIR /app/apps/backend
RUN NODE_ENV=development yarn build

# ── Stage 2 : runner minimal ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Dépendances runtime uniquement (pas python/make/g++)
RUN apk add --no-cache dumb-init

COPY --from=builder /app/apps/backend/.medusa/server ./

RUN yarn install --non-interactive --production --frozen-lockfile && \
    yarn cache clean

EXPOSE 9000

# dumb-init gère les signaux proprement (SIGTERM → graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "node_modules/.bin/medusa db:migrate && node_modules/.bin/medusa start"]
