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

test('OAuth interaction cookies are scoped to their public API endpoints', () => {
  const apiLocation = nginx.split('  location /api/ {')[1]?.split('  location / {')[0];
  assert.ok(apiLocation, 'API proxy location must exist');
  assert.match(
    apiLocation,
    /proxy_cookie_path\s+\/oauth\/consent\s+\/api\/oauth\/interaction\/;/,
    'Interaction cookie must reach the authenticated consent API, not the SPA route',
  );
  assert.match(
    apiLocation,
    /proxy_cookie_path\s+\/oauth\/auth\/\s+\/api\/oauth\/auth\/;/,
    'Resume cookie must reach the public authorization continuation endpoint',
  );
});

test('OAuth resume redirects reach the public API without rewriting external client callbacks', () => {
  const apiLocation = nginx.split('  location /api/ {')[1]?.split('  location / {')[0];
  assert.ok(apiLocation, 'API proxy location must exist');
  assert.match(
    apiLocation,
    /proxy_redirect\s+\$APP_URL\/oauth\/auth\/\s+\$APP_URL\/api\/oauth\/auth\/;/,
    'Absolute provider resume redirects must stay on the public API origin',
  );
  assert.match(
    apiLocation,
    /proxy_redirect\s+\/oauth\/auth\/\s+\$APP_URL\/api\/oauth\/auth\/;/,
    'Relative provider resume redirects must use the configured public HTTPS origin',
  );
  assert.doesNotMatch(apiLocation, /proxy_redirect\s+\/?\s+\/api\//);
});
