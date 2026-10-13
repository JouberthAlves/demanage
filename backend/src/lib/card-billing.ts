/**
 * Compatibility shim. The implementation lives in lib/billing/*:
 *   calendar.ts (closing dates) · charges.ts (pure occurrence/amount maths)
 *   plan.ts (pure cycle planner) · run.ts (DB loop) · serialize.ts
 * Pure callers should import lib/billing/* or lib/civil-date directly so they
 * never load the database client.
 */
export { listDueClosingDates } from '@/lib/billing/calendar';
export {
  chargeAmountForClosing,
  chargesTotalForClosing,
  lateOneOffsTotalForClosing,
  splitShareFor,
} from '@/lib/billing/charges';
export { processUserCardBilling } from '@/lib/billing/run';
export { serializeCard } from '@/lib/billing/serialize';
export {
  dayKeyInSaoPaulo as dateKeyInSaoPaulo,
  todayInSaoPaulo,
} from '@/lib/civil-date';
