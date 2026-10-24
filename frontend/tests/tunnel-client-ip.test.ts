import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const nginx = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');
const entrypoint = readFileSync(
  new URL('../entrypoint.sh', import.meta.url),
  'utf8',
);
const compose = readFileSync(
  new URL('../../docker-compose.prod.yml', import.meta.url),
  'utf8',
);
const script = fileURLToPath(new URL('../realip-config.sh', import.meta.url));
const shellScript =
  process.platform === 'win32'
    ? script
        .replace(
          /^([A-Za-z]):/,
          (_match, drive: string) => `/${drive.toLowerCase()}`,
        )
        .replaceAll('\\', '/')
    : script;

const shell =
  process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\sh.exe' : 'sh';

function configure(extra: Record<string, string | undefined> = {}) {
  return spawnSync(shell, [shellScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TRUST_CF_CONNECTING_IP: '0',
      TRUST_CF_INGRESS_VERIFIED: '0',
      TRUSTED_TUNNEL_PROXY_IP: '',
      ...extra,
    },
  });
}

test('Cloudflare visitor headers are ignored by default and cannot override nginx peer IP', () => {
  const result = configure();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /set_real_ip_from|real_ip_header/);
  assert.match(nginx, /include \/etc\/nginx\/demanage-tunnel-realip\.conf;/);
  assert.doesNotMatch(nginx, /\$http_cf_connecting_ip|\$http_x_forwarded_for/);
  assert.equal(
    (nginx.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g) ?? [])
      .length,
    2,
  );
  assert.equal(
    (nginx.match(/proxy_set_header CF-Connecting-IP "";/g) ?? []).length,
    2,
  );
  assert.match(entrypoint, /realip-config\.sh/);
  assert.match(
    compose,
    /TRUST_CF_CONNECTING_IP: \$\{TRUST_CF_CONNECTING_IP:-0\}/,
  );
});

test('enabling visitor IP requires both explicit verified ingress and an exact peer', () => {
  for (const settings of [
    { TRUST_CF_CONNECTING_IP: '1' },
    { TRUST_CF_CONNECTING_IP: '1', TRUST_CF_INGRESS_VERIFIED: '1' },
    { TRUST_CF_CONNECTING_IP: '1', TRUSTED_TUNNEL_PROXY_IP: '192.0.2.22' },
    {
      TRUST_CF_CONNECTING_IP: 'true',
      TRUST_CF_INGRESS_VERIFIED: '1',
      TRUSTED_TUNNEL_PROXY_IP: '192.0.2.22',
    },
  ]) {
    const result = configure(settings);
    assert.notEqual(
      result.status,
      0,
      `must fail closed for ${JSON.stringify(settings)}`,
    );
  }
});

test('trusted tunnel accepts one strictly validated peer, never a CIDR or injected nginx directive', () => {
  const allowed = configure({
    TRUST_CF_CONNECTING_IP: '1',
    TRUST_CF_INGRESS_VERIFIED: '1',
    TRUSTED_TUNNEL_PROXY_IP: '192.0.2.22',
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(
    allowed.stdout,
    /^set_real_ip_from 192\.0\.2\.22;\nreal_ip_header CF-Connecting-IP;\nreal_ip_recursive off;\n$/,
  );

  for (const ip of [
    '192.0.2.0/24',
    '0.0.0.0/0',
    '256.0.2.22',
    '192.0.2.999',
    '192.0.2.022',
    '192.0.2.22; return 200',
    '192.0.2.22\nset_real_ip_from 0.0.0.0/0;',
    'localhost',
    '2001:db8::2',
    '',
  ]) {
    const attempt = configure({
      TRUST_CF_CONNECTING_IP: '1',
      TRUST_CF_INGRESS_VERIFIED: '1',
      TRUSTED_TUNNEL_PROXY_IP: ip,
    });
    assert.notEqual(attempt.status, 0, `rejected ${JSON.stringify(ip)}`);
    assert.doesNotMatch(
      attempt.stdout,
      /set_real_ip_from/,
      'must not output unsafe directives',
    );
  }
});
