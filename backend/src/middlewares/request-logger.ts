import { NextFunction, Request, Response } from 'express';

export function sanitizeLogValue(value: string, maxLength = 2048) {
  return (
    value
      // eslint-disable-next-line no-control-regex -- Strip controls before writing untrusted values to logs.
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?')
      .slice(0, maxLength)
  );
}

export async function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { default: chalk } = await import('chalk');
  const start = process.hrtime();

  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const durationMs = (seconds * 1e3 + nanoseconds / 1e6).toFixed(2);

    const now = new Date();
    const localTime = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).format(now);

    const time = chalk.gray(localTime);

    const method = chalk.blue(sanitizeLogValue(req.method, 32));
    const url = chalk.cyan(sanitizeLogValue(req.originalUrl));
    const status =
      res.statusCode >= 500
        ? chalk.red(res.statusCode)
        : res.statusCode >= 400
          ? chalk.yellow(res.statusCode)
          : chalk.green(res.statusCode);

    const duration = chalk.gray(`${durationMs}ms`);
    const ip = chalk.magenta(sanitizeLogValue(req.ip || 'unknown', 128));

    console.log(`${time} ${ip} - ${method} ${url} ${status} - ${duration}`);
  });

  next();
}
