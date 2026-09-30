###############################
# deManage API — multi-stage
###############################

FROM node:26 AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
# Prisma 7 loads prisma.config.ts during generation, but this step does not connect to the database.
RUN DATABASE_URL='postgresql://build:build@127.0.0.1:5432/build' pnpm prisma generate
RUN pnpm build

FROM node:26

WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/package.json ./
COPY entrypoint.sh .

RUN chmod +x ./entrypoint.sh

# Plataformas (Railway etc.) injetam PORT; app lê PORT || API_PORT
ENV NODE_ENV=production
EXPOSE 8888

ENTRYPOINT ["/bin/sh", "./entrypoint.sh"]
