const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const DEFAULT_API_URL = 'http://localhost:8888';

if (import.meta.env.PROD && !configuredApiUrl?.trim()) {
  throw new Error(
    '[deManage] VITE_API_URL is required in production builds. Set it in the frontend env.',
  );
}

function isLoopbackHostname(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function isPrivateIpv4Hostname(hostname: string) {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function resolveApiUrl(value: string) {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return value.replace(/\/$/, '');
  }

  try {
    const url = new URL(value);
    const pageHostname = window.location.hostname;
    const pageIsLan =
      isPrivateIpv4Hostname(pageHostname) || pageHostname.endsWith('.local');

    if (isLoopbackHostname(url.hostname) && pageIsLan) {
      url.hostname = pageHostname;
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/$/, '');
  }
}

export const API_URL = resolveApiUrl(
  configuredApiUrl?.trim() || DEFAULT_API_URL,
);
