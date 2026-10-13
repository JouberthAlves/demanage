import { Prisma } from '@/generated/prisma/client';

import { MarketDataError } from '../types';

/** Mercado Bitcoin BTC ticker (BRL fallback). */

export const MERCADO_BITCOIN_TICKER_URL =
  'https://www.mercadobitcoin.net/api/BTC/ticker/';

export function parseMercadoBitcoinTicker(data: {
  ticker?: { last?: string };
}): string {
  const value = Number(data.ticker?.last);
  if (!Number.isFinite(value) || value <= 0) {
    throw new MarketDataError('Cotação BTC inválida');
  }
  return new Prisma.Decimal(data.ticker!.last!).toFixed();
}
