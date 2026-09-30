import { APP_URL, NODE_ENV } from '@/utils/var';

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

function normalizedHttpOrigin(value: string) {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isAllowedBrowserOrigin(
  value: string,
  appUrl = APP_URL,
  nodeEnv = NODE_ENV,
) {
  const origin = normalizedHttpOrigin(value);
  if (!origin) return false;

  let appOrigin: string | null = null;
  if (appUrl) {
    try {
      appOrigin = new URL(appUrl).origin;
    } catch {
      appOrigin = null;
    }
  }

  if (origin === appOrigin) return true;
  if (nodeEnv === 'production') return false;

  const hostname = new URL(origin).hostname;
  return (
    isLoopbackHostname(hostname) ||
    isPrivateIpv4Hostname(hostname) ||
    hostname.endsWith('.local')
  );
}
