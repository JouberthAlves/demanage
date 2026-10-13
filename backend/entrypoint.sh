#!/bin/sh
set -e

: "${DATABASE_URL:?DATABASE_URL is required}"

# Call the local CLI directly: the runtime image has no pnpm.
echo '[deManage] Running prisma migrate deploy...'
./node_modules/.bin/prisma migrate deploy

echo '[deManage] Starting API...'
exec node dist/server.js
