import axios from 'axios';

import { API_URL } from '@/utils/var';

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// These answer 401 for wrong credentials, which is not an expired session.
const SESSION_EXEMPT_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/recover-password',
  '/auth/recovery-code',
];

let unauthorizedHandler: (() => void) | null = null;

/** Registered by the auth store so the API layer does not import it. */
export function onSessionExpired(handler: () => void) {
  unauthorizedHandler = handler;
}

api.interceptors.response.use(undefined, (error: unknown) => {
  if (
    axios.isAxiosError(error) &&
    error.response?.status === 401 &&
    !SESSION_EXEMPT_PATHS.some((path) => error.config?.url?.startsWith(path))
  ) {
    unauthorizedHandler?.();
  }
  return Promise.reject(error);
});
