import { isAxiosError } from 'axios';

// Do not hammer the API (especially when rate-limited) or keep the UI stalled
// through React Query's default three automatic retries.
export function shouldRetryReadRequest(failureCount: number, error: unknown) {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status != null && status < 500) return false;
  }
  return failureCount < 1;
}
