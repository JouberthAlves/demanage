#!/bin/sh
set -eu

# Prints *only* validated nginx realip directives. Entrypoint writes this to
# an included file. Empty output is the safe default (original socket peer).
case "${TRUST_CF_CONNECTING_IP:-0}" in
  0) exit 0 ;;
  1) ;;
  *)
    echo '[deManage] TRUST_CF_CONNECTING_IP must be exactly 0 or 1' >&2
    exit 1
    ;;
esac

# Operator attestation alone is NOT proof. See docs/self-hosting.md for the
# distinct, exclusive ingress-peer requirement before setting this to 1.
if [ "${TRUST_CF_INGRESS_VERIFIED:-0}" != 1 ]; then
  echo '[deManage] Refusing Cloudflare visitor IP without verified exclusive tunnel ingress' >&2
  exit 1
fi

# Require a single IPv4 socket peer (not a CIDR). Docker-host gateway addresses
# shared by other local processes are NOT exclusive tunnel ingress peers.
peer=${TRUSTED_TUNNEL_PROXY_IP:-}
case "$peer" in
  ''|*[!0-9.]*)
    echo '[deManage] TRUSTED_TUNNEL_PROXY_IP must be one literal IPv4 peer' >&2
    exit 1
    ;;
esac

if ! printf '%s\n' "$peer" | awk -F. '
  NF != 4 { exit 1 }
  {
    for (i = 1; i <= 4; i++) {
      if ($i !~ /^[0-9]+$/ || length($i) > 3 || ($i + 0) > 255 || (length($i) > 1 && substr($i, 1, 1) == "0")) exit 1
    }
  }
'; then
  echo '[deManage] TRUSTED_TUNNEL_PROXY_IP is not a canonical IPv4 address' >&2
  exit 1
fi

printf 'set_real_ip_from %s;\nreal_ip_header CF-Connecting-IP;\nreal_ip_recursive off;\n' "$peer"
