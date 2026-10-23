import axios, { type InternalAxiosRequestConfig } from 'axios';

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
let readSessionRevision: (() => number) | null = null;

type SessionTaggedRequestConfig = InternalAxiosRequestConfig & {
  __demanageSessionRevision?: number;
};

/** Registered by the auth store so the API layer does not import it. */
export function onSessionExpired(
  handler: () => void,
  getSessionRevision: () => number,
) {
  unauthorizedHandler = handler;
  readSessionRevision = getSessionRevision;
}

api.interceptors.request.use((config) => {
  if (readSessionRevision) {
    (config as SessionTaggedRequestConfig).__demanageSessionRevision =
      readSessionRevision();
  }
  return config;
});

api.interceptors.response.use(undefined, (error: unknown) => {
  const requestRevision = (error as { config?: SessionTaggedRequestConfig })
    ?.config?.__demanageSessionRevision;
  if (
    axios.isAxiosError(error) &&
    error.response?.status === 401 &&
    !SESSION_EXEMPT_PATHS.some((path) => error.config?.url?.startsWith(path)) &&
    typeof requestRevision === 'number' &&
    requestRevision === readSessionRevision?.()
  ) {
    unauthorizedHandler?.();
  }
  return Promise.reject(error);
});
