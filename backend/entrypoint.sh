#!/bin/sh
set -e

# Compose provides the raw PostgreSQL password; encode it for the URI without
# modifying the password on disk or in the existing PostgreSQL volume.
# Standalone deployments that already supply DATABASE_URL remain supported.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  DATABASE_URL=$(node -e 'process.stdout.write("postgresql://demanage:" + encodeURIComponent(process.env.POSTGRES_PASSWORD) + "@db:5432/demanage?schema=public")')
  export DATABASE_URL
fi
: "${DATABASE_URL:?DATABASE_URL or POSTGRES_PASSWORD is required}"

# Call the local CLI directly: the runtime image has no pnpm.
echo '[deManage] Running prisma migrate deploy...'
./node_modules/.bin/prisma migrate deploy

echo '[deManage] Starting API...'
exec node dist/server.js
