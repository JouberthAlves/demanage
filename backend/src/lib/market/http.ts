import { readBoundedJson } from '@/lib/external-json';

import { MarketDataError, PROVIDER_COOLDOWN_MS } from './types';

/**
 * The one HTTP entry point for market providers: timeout, per-host cooldown
 * after 429/503, HTML (captive portal) detection and a response size cap
 * (readBoundedJson). Providers never call fetch directly.
 */

const cooldownUntil = new Map<string, number>();

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function isCoolingDown(url: string, now = Date.now()) {
  return now < (cooldownUntil.get(hostOf(url)) ?? 0);
}

export function markCooldown(url: string, now = Date.now()) {
  cooldownUntil.set(hostOf(url), now + PROVIDER_COOLDOWN_MS);
}

/** Test hook. */
export function resetProviderCooldowns() {
  cooldownUntil.clear();
}

function tlsCauseCode(error: unknown): string {
  const cause =
    error instanceof Error && 'cause' in error ? error.cause : error;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return String(cause.code);
  }
  return '';
}

export type GetJsonOptions<T> = {
  timeoutMs?: number;
  maxBytes?: number;
  /** When set, a 404 resolves to this value instead of an error. */
  onNotFound?: T;
};

export async function getJson<T>(
  url: string,
  options: GetJsonOptions<T> = {},
): Promise<T> {
  if (isCoolingDown(url)) {
    throw new MarketDataError('Provider em cooldown');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'deManage/1.0' },
    });
    if (response.status === 404 && 'onNotFound' in options) {
      await response.body?.cancel();
      return options.onNotFound as T;
    }
    if (!response.ok) {
      if (response.status === 429 || response.status === 503) {
        markCooldown(url);
      }
      await response.body?.cancel();
      throw new MarketDataError(`Provider respondeu ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      await response.body?.cancel();
      throw new MarketDataError('Provider bloqueado pela rede');
    }
    return await readBoundedJson<T>(response, options.maxBytes);
  } catch (error) {
    if (error instanceof MarketDataError) throw error;
    const code = tlsCauseCode(error);
    if (
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ) {
      throw new MarketDataError(
        'A rede corporativa interceptou o HTTPS deste provider',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
