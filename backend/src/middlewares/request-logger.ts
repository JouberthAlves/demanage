import { NextFunction, Request, Response } from 'express';

export async function requestLogger(req: Request, res: Response, next: NextFunction) {
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

    const method = chalk.blue(req.method);
    const url = chalk.cyan(req.originalUrl);
    const status =
      res.statusCode >= 500 ? chalk.red(res.statusCode) :
        res.statusCode >= 400 ? chalk.yellow(res.statusCode) :
          chalk.green(res.statusCode);

    const duration = chalk.gray(`${durationMs}ms`);
    const ip = chalk.magenta(req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip);

    console.log(`${time} ${ip} - ${method} ${url} ${status} - ${duration}`);
  });

  next();
};