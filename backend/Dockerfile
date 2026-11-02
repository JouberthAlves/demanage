###############################
# deManage API — multi-stage
###############################

# One FROM line per base image so Dependabot's docker ecosystem can bump it.
FROM node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS node-base
WORKDIR /app
ENV TZ=UTC

FROM node-base AS pnpm-base
RUN npm install -g pnpm@10.17.1

# Dependency layers copy only manifests, so source edits do not reinstall packages.
# pnpm-workspace.yaml carries onlyBuiltDependencies (Prisma engines need their install scripts).
FROM pnpm-base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# prisma generate reads prisma.config.ts but does not connect: no DATABASE_URL needed.
RUN pnpm exec prisma generate && pnpm build

# Production dependencies only. `prisma` is a runtime dependency because the
# entrypoint runs `prisma migrate deploy`.
FROM pnpm-base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node-base AS runtime

ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts package.json ./
COPY --chown=node:node entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Platforms that inject PORT win over API_PORT (see src/utils/var.ts).
EXPOSE 8888
USER node

ENTRYPOINT ["/bin/sh", "./entrypoint.sh"]
