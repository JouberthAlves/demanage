import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const nginx = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');

test('OAuth reverse proxy forwards the trusted public HTTPS scheme, not internal Tunnel HTTP', () => {
  assert.match(nginx, /map\s+"\$APP_URL"\s+\$demanage_public_proto\s*\{[\s\S]*?"~\^https:\/\/"\s+https;/);
  assert.equal(
    (nginx.match(/proxy_set_header\s+X-Forwarded-Proto\s+\$demanage_public_proto;/g) ?? []).length,
    2,
    'Both /.well-known and /api proxy locations must use the trusted scheme',
  );
  assert.doesNotMatch(nginx, /proxy_set_header\s+X-Forwarded-Proto\s+\$scheme;/);
  assert.doesNotMatch(nginx, /proxy_set_header\s+X-Forwarded-Proto\s+\$http_x_forwarded_proto;/);
});
