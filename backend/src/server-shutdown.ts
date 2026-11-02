import type { EventEmitter } from 'node:events';
import type { Server } from 'node:http';

type ShutdownOptions = {
  signals?: Pick<EventEmitter, 'once'>;
  timeoutMs?: number;
  forceExit?: () => void;
};

/** Drain active HTTP requests on container stop, then release Prisma's pool. */
export function installGracefulShutdown(
  server: Server,
  disconnect: () => Promise<void>,
  { signals = process, timeoutMs = 8_000, forceExit = () => process.exit(1) }: ShutdownOptions = {},
): () => Promise<void> {
  let shuttingDown: Promise<void> | undefined;
  // A connection that becomes idle *after* server.close() may remain held by
  // keep-alive clients; release it only after its active response has finished.
  server.on('request', (_req, res) => {
    res.once('finish', () => {
      if (shuttingDown) server.closeIdleConnections();
    });
  });

  const stop = (): Promise<void> => {
    if (shuttingDown) return shuttingDown;

    const deadline = setTimeout(() => {
      server.closeAllConnections();
      forceExit();
    }, timeoutMs);
    deadline.unref();

    shuttingDown = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }).then(disconnect).finally(() => clearTimeout(deadline));
    return shuttingDown;
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    signals.once(signal, () => {
      void stop().catch((error: unknown) => {
        console.error('[deManage] Failed to shut down gracefully', error);
        forceExit();
      });
    });
  }
  return stop;
}
