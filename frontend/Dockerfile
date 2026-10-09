###############################
# deManage frontend — Vite build + nginx (same-origin /api proxy)
###############################

FROM node:26.10.0-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS builder

WORKDIR /app
ENV TZ=UTC

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY . .

RUN npm i -g pnpm@10.17.1
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM nginx:1.31-alpine3.24@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY entrypoint.sh /entrypoint.sh

RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

ENV PORT=80 TZ=UTC
EXPOSE 80

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
