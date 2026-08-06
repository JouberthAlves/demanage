#!/bin/sh
set -e

echo '[deManage] Running prisma migrate deploy...'
pnpm exec prisma migrate deploy

echo '[deManage] Starting API...'
exec node dist/server.js
