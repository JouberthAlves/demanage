import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { isIP } from 'node:net';
import test from 'node:test';
import express from 'express';
import rateLimit from 'express-rate-limit';

/** Simulate the nginx realip module's peer check. The nginx config is
 * independently guarded by tunnel-client-ip.test.ts; no production routing here.
 */
function forwardedByNginx(args: {
  socketPeer: string;
  cfConnectingIp?: string;
  suppliedXff?: string;
  trustedTunnelPeer?: string;
}) {
  const { socketPeer, cfConnectingIp, trustedTunnelPeer } = args;
  return socketPeer === trustedTunnelPeer && isIP(cfConnectingIp ?? '') > 0
    ? cfConnectingIp!
    : socketPeer;
}

test('two legitimate visitors are isolated by the backend limiter only behind a verified tunnel peer', async () => {
  const app = express();
  app.set('trust proxy', 1); // One nginx hop. nginx *overwrites* XFF.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 2,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );
  app.get('/probe', (req, res) => {
    res.json({ ip: req.ip });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}/probe`;

  async function request(args: Parameters<typeof forwardedByNginx>[0]) {
    const normalized = forwardedByNginx(args);
    const response = await fetch(endpoint, {
      headers: { 'X-Forwarded-For': normalized },
    });
    const body = await response.text();
    return {
      status: response.status,
      body: response.ok ? (JSON.parse(body) as { ip: string }) : null,
    };
  }

  try {
    const ingress = '192.0.2.22';
    // The default remains conservative: visitor headers from a shared proxy
    // peer cannot create separate buckets by claiming distinct IPs.
    assert.equal(
      forwardedByNginx({
        socketPeer: ingress,
        cfConnectingIp: '198.51.100.10',
      }),
      ingress,
    );
    assert.equal(
      forwardedByNginx({
        socketPeer: ingress,
        cfConnectingIp: '198.51.100.11',
        suppliedXff: '203.0.113.4',
      }),
      ingress,
    );
    const visitorA = {
      socketPeer: ingress,
      trustedTunnelPeer: ingress,
      cfConnectingIp: '198.51.100.10',
    };
    const visitorB = {
      socketPeer: ingress,
      trustedTunnelPeer: ingress,
      cfConnectingIp: '198.51.100.11',
    };

    assert.equal((await request(visitorA)).status, 200);
    assert.equal((await request(visitorA)).status, 200);
    const aBlocked = await request(visitorA);
    assert.equal(aBlocked.status, 429);
    const bAllowed = await request(visitorB);
    assert.equal(
      bAllowed.status,
      200,
      'different visitor has independent quota',
    );
    assert.equal(bAllowed.body?.ip, visitorB.cfConnectingIp);

    const attacker = await request({
      socketPeer: '192.0.2.99',
      trustedTunnelPeer: ingress,
      cfConnectingIp: visitorA.cfConnectingIp,
      suppliedXff: visitorB.cfConnectingIp,
    });
    assert.equal(attacker.status, 200);
    assert.equal(
      attacker.body?.ip,
      '192.0.2.99',
      'untrusted peer cannot spoof either visitor',
    );
    assert.equal(
      (
        await request({
          socketPeer: '192.0.2.99',
          trustedTunnelPeer: ingress,
          cfConnectingIp: visitorB.cfConnectingIp,
          suppliedXff: '203.0.113.99',
        })
      ).body?.ip,
      '192.0.2.99',
    );
    assert.equal(
      (
        await request({
          socketPeer: '192.0.2.99',
          trustedTunnelPeer: ingress,
          cfConnectingIp: '198.51.100.66',
          suppliedXff: '203.0.113.45',
        })
      ).status,
      429,
      'forged visitor headers cannot reset the untrusted peer quota',
    );
    assert.equal(
      (
        await request({
          socketPeer: ingress,
          trustedTunnelPeer: ingress,
          cfConnectingIp: 'invalid-ip',
          suppliedXff: visitorB.cfConnectingIp,
        })
      ).body?.ip,
      ingress,
      'invalid visitor header falls back to proxy peer',
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
