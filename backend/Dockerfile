###############################
# deManage API — multi-stage
###############################

FROM node:26.10.0-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS builder

WORKDIR /app
ENV TZ=UTC

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN npm install -g pnpm@10.17.1 && pnpm install --frozen-lockfile

COPY . .
# Prisma 7 loads prisma.config.ts during generation, but this step does not connect to the database.
RUN DATABASE_URL='postgresql://build:build@127.0.0.1:5432/build' pnpm prisma generate
RUN pnpm build

FROM node:26.10.0-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33

WORKDIR /app
ENV TZ=UTC

RUN npm install -g pnpm@10.17.1

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/pnpm-lock.yaml ./
COPY --from=builder --chown=node:node /app/package.json ./
COPY --chown=node:node entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

# Plataformas (Railway etc.) injetam PORT; app lê PORT || API_PORT
ENV NODE_ENV=production
EXPOSE 8888
USER node

ENTRYPOINT ["/bin/sh", "./entrypoint.sh"]
