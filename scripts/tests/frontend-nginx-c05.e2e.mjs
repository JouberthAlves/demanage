import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const image = process.env.DEMANAGE_C05_IMAGE || 'demanage-frontend:c05-ci';

function docker(...args) {
  return execFileSync('docker', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const config = JSON.parse(
  docker('compose', '-f', 'docker-compose.prod.yml', 'config', '--format', 'json'),
);
const frontend = config.services.frontend;
assert.equal(frontend.read_only, true, 'C05: production frontend rootfs must be read-only');
assert.ok(frontend.cap_drop?.includes('ALL'), 'C05: drop default capabilities');
assert.ok(
  frontend.security_opt?.includes('no-new-privileges:true'),
  'C05: prevent privilege escalation',
);
assert.ok(
  frontend.tmpfs?.some((mount) => mount.startsWith('/tmp:')),
  'C05: frontend needs writable /tmp tmpfs',
);
assert.equal(frontend.environment.PORT, '8080', 'C05: nonroot listener uses 8080');
assert.equal(frontend.ports[0].target, 8080, 'C05: host tunnel port forwards to 8080');
console.log('C05 production Compose hardening PASS');

if (process.argv.includes('--config-only')) {
  process.exit(0);
}

const user = docker('image', 'inspect', '--format', '{{.Config.User}}', image);
assert.ok(user && user !== 'root' && user !== '0', 'C05: frontend image must use nonroot USER');

const suffix = String(process.pid) + '-' + Math.random().toString(36).slice(2, 8);
const network = 'demanage-c05-' + suffix;
const api = network + '-api';
const web = network + '-web';
const nodeImage = 'node:26.12.0-trixie-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4';
const mockApi = [
  "require('node:http')",
  ".createServer((req, res) => {",
  "res.setHeader('content-type', 'application/json');",
  "res.end(JSON.stringify({ path: req.url, forwardedProto: req.headers['x-forwarded-proto'],",
  "forwardedFor: req.headers['x-forwarded-for'], cfIp: req.headers['cf-connecting-ip'] || '' }));",
  "}).listen(8888, '0.0.0.0')",
].join('');

async function get(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      lastError = new Error('HTTP ' + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError;
}

let createdNetwork = false;
try {
  docker('network', 'create', network);
  createdNetwork = true;
  docker(
    'run', '-d', '--name', api, '--network', network, '--entrypoint', 'node',
    nodeImage, '-e', mockApi,
  );
  docker(
    'run', '-d', '--name', web, '--network', network,
    '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
    '-e', 'PORT=8080', '-e', 'API_HOST=' + api, '-e', 'API_PORT=8888',
    '-e', 'APP_URL=https://demanage.biel.dev.br',
    '-e', 'NGINX_RESOLVER=127.0.0.11', '-e', 'NGINX_RESOLVER_IPV6=off',
    '-e', 'TRUST_CF_CONNECTING_IP=0',
    '-p', '127.0.0.1::8080', image,
  );
  const id = docker('exec', web, 'id', '-u');
  assert.notEqual(id, '0', 'C05: running process must not be root');
  assert.throws(
    () => docker('exec', web, 'sh', '-c', 'touch /etc/nginx/c05-write-probe'),
    'C05: container rootfs must reject writes',
  );
  const publishedPort = Number(docker('port', web, '8080/tcp').split(':').at(-1));
  assert.ok(Number.isInteger(publishedPort) && publishedPort > 0);
  const origin = 'http://127.0.0.1:' + publishedPort;
  const apiResponse = await get(origin + '/api/health', {
    headers: { 'X-Forwarded-Proto': 'http', 'CF-Connecting-IP': '203.0.113.40' },
  });
  const apiBody = await apiResponse.json();
  assert.equal(apiBody.path, '/health', 'C05: /api/ prefix stripped');
  assert.equal(apiBody.forwardedProto, 'https', 'C05: Tunnel public HTTPS preserved');
  assert.equal(apiBody.cfIp, '', 'C05: untrusted Cloudflare IP removed');
  const oauthResponse = await get(origin + '/.well-known/oauth-authorization-server');
  assert.equal((await oauthResponse.json()).path, '/.well-known/oauth-authorization-server');
  const spaResponse = await get(origin + '/despesas');
  assert.match(spaResponse.headers.get('content-type') || '', /text\/html/);
  assert.match(await spaResponse.text(), /<html/i, 'C05: SPA route fallback');
  console.log('C05 nonroot, readonly, proxy, OAuth discovery, SPA and Tunnel headers PASS');
} finally {
  for (const name of [web, api]) {
    try { docker('rm', '-f', name); } catch { /* disposable container may not exist */ }
  }
  if (createdNetwork) {
    try { docker('network', 'rm', network); } catch { /* already removed */ }
  }
}
