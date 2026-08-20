#!/bin/sh
set -e

: "${API_HOST:?API_HOST is required (Railway private hostname of the API)}"
: "${API_PORT:?API_PORT is required (internal PORT of the API)}"
: "${PORT:=80}"

envsubst '${API_HOST} ${API_PORT} ${PORT}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[deManage] nginx listening on ${PORT}, proxy /api → http://${API_HOST}:${API_PORT}"
exec nginx -g 'daemon off;'
