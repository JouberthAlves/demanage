#!/bin/sh
set -e

: "${API_HOST:?API_HOST is required}"
: "${API_PORT:?API_PORT is required}"
: "${PORT:=80}"
: "${NGINX_RESOLVER:=[fd12::10]}"
: "${NGINX_RESOLVER_IPV6:=on}"
: "${TRUST_CF_CONNECTING_IP:=0}"

envsubst '${API_HOST} ${API_PORT} ${PORT} ${NGINX_RESOLVER} ${NGINX_RESOLVER_IPV6} ${TRUST_CF_CONNECTING_IP}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[deManage] nginx listening on ${PORT}, proxy /api → http://${API_HOST}:${API_PORT}, resolver ${NGINX_RESOLVER}"
exec nginx -g 'daemon off;'
