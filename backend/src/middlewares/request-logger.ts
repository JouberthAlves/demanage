import type { NextFunction, Request, Response } from 'express';

export function sanitizeLogValue(value: string, maxLength = 2048) {
  return (
    value
      // eslint-disable-next-line no-control-regex -- Strip controls before writing untrusted values to logs.
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?')
      .slice(0, maxLength)
  );
}

type Chalk = (typeof import('chalk'))['default'];

// chalk é ESM-only: carregado uma única vez (não por requisição).
let chalkPromise: Promise<Chalk | null> | undefined;
function loadChalk() {
  chalkPromise ??= import('chalk').then(
    (module) => module.default,
    () => null,
  );
  return chalkPromise;
}

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

type LogParts = {
  time: string;
  ip: string;
  method: string;
  url: string;
  status: number;
  durationMs: string;
};

export function formatLogLine(parts: LogParts, chalk: Chalk | null) {
  const paint = (pick: (c: Chalk) => (text: string) => string, text: string) =>
    chalk ? pick(chalk)(text) : text;

  const statusText = String(parts.status);
  const status =
    parts.status >= 500
      ? paint((c) => c.red, statusText)
      : parts.status >= 400
        ? paint((c) => c.yellow, statusText)
        : paint((c) => c.green, statusText);

  return [
    paint((c) => c.gray, parts.time),
    paint((c) => c.magenta, parts.ip),
    '-',
    paint((c) => c.blue, parts.method),
    paint((c) => c.cyan, parts.url),
    status,
    '-',
    paint((c) => c.gray, `${parts.durationMs}ms`),
  ].join(' ');
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime();

  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const parts: LogParts = {
      time: timeFormatter.format(new Date()),
      ip: sanitizeLogValue(req.ip || 'unknown', 128),
      method: sanitizeLogValue(req.method, 32),
      url: sanitizeLogValue(req.originalUrl),
      status: res.statusCode,
      durationMs: (seconds * 1e3 + nanoseconds / 1e6).toFixed(2),
    };

    void loadChalk().then((chalk) => {
      console.log(formatLogLine(parts, chalk));
    });
  });

  next();
}
