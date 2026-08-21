export type Asset = 'BTC' | 'USD';
export type AssetTransactionType = 'BUY' | 'SELL' | 'MANUAL_ADJUSTMENT';

export type AssetQuote = {
  valueBrl: string;
  stale: boolean;
  provider: string;
  asOf: string;
};

export type AssetPosition = {
  asset: Asset;
  quantity: string;
  knownQuantity: string;
  unknownQuantity: string;
  investedBrl: string;
  averageCostBrl: string | null;
  feesBrl: string;
  realizedPnlBrl: string;
  realizedCostBasisBrl: string;
  pnlComplete: boolean;
  quoteBrl: string;
  marketValueBrl: string;
  unrealizedPnlBrl: string;
  totalPnlBrl: string;
  totalPnlPercent: string | null;
  quote: AssetQuote;
};

export type AssetsSummary = {
  BTC: AssetPosition;
  USD: AssetPosition;
};

export type AssetTransaction = {
  id: string;
  asset: Asset;
  type: AssetTransactionType;
  quantity: string;
  cashAmountBrl: string;
  feeAmountBrl: string;
  feePercent: string | null;
  costBasisKnown: boolean;
  date: string;
  note: string | null;
  expenseId: string | null;
  entryId: string | null;
  createdAt: string;
};

export type MarketPoint = {
  date: string;
  value: string;
};

export type MarketSeries = {
  provider: string;
  stale: boolean;
  points: MarketPoint[];
};

export type PatrimonySettings = {
  baseDate: string;
  openingCashBrl: string;
};

export type PatrimonySummary = {
  patrimonyBrl: string;
  cashBrl: string;
  piggyBrl: string;
  btcBrl: string;
  usdBrl: string;
  cdiBrl: string;
  ipcaBrl: string;
  versusCdiBrl: string;
  versusCdiPercent: string | null;
  versusIpcaBrl: string;
  versusIpcaPercent: string | null;
};

export type PatrimonyHistoryPoint = {
  date: string;
  patrimonyBrl: string;
  cashBrl: string;
  piggyBrl: string;
  btcBrl: string;
  usdBrl: string;
  cdiBrl: string;
  ipcaBrl: string;
};

export type PatrimonyHistory = {
  settings: PatrimonySettings;
  summary: PatrimonySummary;
  stale: {
    btc: boolean;
    usd: boolean;
    cdi: boolean;
    ipca: boolean;
  };
  history: PatrimonyHistoryPoint[];
};
