###############################
# deManage frontend — Vite build + nginx (same-origin /api proxy)
###############################

FROM node:22 AS builder

WORKDIR /app

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY . .

RUN npm i -g pnpm
RUN pnpm i
RUN pnpm build

FROM nginx:alpine

WORKDIR /app

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY entrypoint.sh /entrypoint.sh

RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

ENV PORT=80
EXPOSE 80

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
