import { isAxiosError } from 'axios';

type ApiErrorBody = { error?: unknown; code?: unknown };

function body(error: unknown): ApiErrorBody | undefined {
  if (!isAxiosError(error)) return undefined;
  const data: unknown = error.response?.data;
  return data && typeof data === 'object' ? (data as ApiErrorBody) : undefined;
}

/** User-facing message sent by the API, or the given fallback. */
export function getApiErrorMessage(error: unknown, fallback: string) {
  const message = body(error)?.error;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

export function getApiErrorCode(error: unknown) {
  const code = body(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function getApiErrorStatus(error: unknown) {
  return isAxiosError(error) ? error.response?.status : undefined;
}
