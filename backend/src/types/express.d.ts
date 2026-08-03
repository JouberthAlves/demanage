import type { PublicUser } from './auth';

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export {};
