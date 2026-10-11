###############################
# deManage frontend — Vite build + nginx (same-origin /api proxy)
###############################

FROM node:26.10.0-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS builder

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

FROM nginx:1.31-alpine3.24@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2

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
