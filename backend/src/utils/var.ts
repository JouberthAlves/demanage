import '@/config/env';

export const NODE_ENV = process.env.NODE_ENV;
export const API_PORT = process.env.API_PORT;
export const APP_URL = process.env.APP_URL;

export const JWT_SECRET = process.env.JWT_SECRET ?? 'demanage-dev-secret';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
