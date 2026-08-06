###############################
# deManage API — multi-stage
###############################

FROM node:22 AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate
RUN pnpm build

FROM node:22

WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/package.json ./
COPY entrypoint.sh .

RUN chmod +x ./entrypoint.sh

# Plataformas (Railway etc.) injetam PORT; app lê PORT || API_PORT
ENV NODE_ENV=production
EXPOSE 8888

ENTRYPOINT ["./entrypoint.sh"]
