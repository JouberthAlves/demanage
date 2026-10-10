#!/bin/sh
set -e

: "${API_HOST:?API_HOST is required}"
: "${API_PORT:?API_PORT is required}"
: "${PORT:=80}"
: "${TRUST_CF_CONNECTING_IP:=0}"
: "${APP_URL:=http://localhost}"
: "${VITE_API_URL:=/api}"

# nginx resolver: default to the container's own DNS server (Docker embedded DNS,
# Kubernetes, or any host resolver). Override with NGINX_RESOLVER when needed.
if [ -z "${NGINX_RESOLVER:-}" ]; then
  NGINX_RESOLVER=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)
  NGINX_RESOLVER=${NGINX_RESOLVER:-127.0.0.11}
fi
case "$NGINX_RESOLVER" in
  \[*) NGINX_RESOLVER_IS_IPV6=1 ;;
  *:*) NGINX_RESOLVER_IS_IPV6=1; NGINX_RESOLVER="[$NGINX_RESOLVER]" ;;
  *) NGINX_RESOLVER_IS_IPV6=0 ;;
esac
if [ -z "${NGINX_RESOLVER_IPV6:-}" ]; then
  if [ "$NGINX_RESOLVER_IS_IPV6" = 1 ]; then NGINX_RESOLVER_IPV6=on; else NGINX_RESOLVER_IPV6=off; fi
fi

validate_api_csp_source() {
  if ! printf '%s\n' "$API_CSP_SOURCE" | grep -Eq '^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?$'; then
    echo "[deManage] VITE_API_URL must use a valid HTTP(S) origin or same-origin path" >&2
    exit 1
  fi
}

case "$VITE_API_URL" in
  //*)
    API_CSP_SCHEME=${APP_URL%%://*}
    case "$API_CSP_SCHEME" in
      http|https) ;;
      *)
        echo "[deManage] APP_URL must use HTTP(S) for a protocol-relative VITE_API_URL" >&2
        exit 1
        ;;
    esac
    API_CSP_AUTHORITY=$(printf '%s\n' "$VITE_API_URL" | sed -E 's#^//([^/]+).*#\1#')
    API_CSP_SOURCE="$API_CSP_SCHEME://$API_CSP_AUTHORITY"
    validate_api_csp_source
    ;;
  /*)
    API_CSP_SOURCE="'self'"
    ;;
  http://*|https://*)
    API_CSP_SOURCE=$(printf '%s\n' "$VITE_API_URL" | sed -E 's#^(https?://[^/]+).*#\1#')
    validate_api_csp_source
    ;;
  *)
    echo "[deManage] VITE_API_URL must use an HTTP(S) origin or same-origin path" >&2
    exit 1
    ;;
esac

export API_HOST API_PORT PORT NGINX_RESOLVER NGINX_RESOLVER_IPV6 \
  TRUST_CF_CONNECTING_IP APP_URL API_CSP_SOURCE

envsubst '${API_HOST} ${API_PORT} ${PORT} ${NGINX_RESOLVER} ${NGINX_RESOLVER_IPV6} ${TRUST_CF_CONNECTING_IP} ${APP_URL} ${API_CSP_SOURCE}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[deManage] nginx listening on ${PORT}, proxy /api → http://${API_HOST}:${API_PORT}, resolver ${NGINX_RESOLVER}"
exec nginx -g 'daemon off;'
