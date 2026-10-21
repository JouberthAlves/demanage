###############################
# deManage frontend — Vite build + nginx (same-origin /api proxy)
###############################

FROM node:26.11.1-trixie-slim@sha256:193fe51b64e77981119c98c2002c9e32a70e2f006fb4d25068ce0558998917f0 AS builder

WORKDIR /app
ENV TZ=UTC

RUN npm i -g pnpm@10.17.1

# Dependency layer first: source edits do not reinstall packages.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# VITE_API_URL is compiled into the bundle and is also the runtime value that
# entrypoint.sh uses for the CSP connect-src. The runtime stage keeps the same value.
ARG VITE_API_URL=/api
RUN pnpm build

FROM nginx:1.31-alpine3.24@sha256:892bb2152464f0c5d8972593a5f5afaf8054552580b699d95f8ff4af08c2d33d

WORKDIR /app

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY entrypoint.sh /entrypoint.sh
# .gitattributes keeps *.sh as LF, so no CRLF conversion is needed here.
RUN chmod +x /entrypoint.sh

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

ENV PORT=80 TZ=UTC
EXPOSE 80

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
