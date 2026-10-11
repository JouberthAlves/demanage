/** Compatibility shim; see lib/piggy/interest.ts (pure) and interest-run.ts. */
export {
  accrueCdiInterest,
  calculateCdiInterest,
  lastCompletedWeekday,
  splitCdiHistoryRange,
} from '@/lib/piggy/interest';
export { catchUpPiggyInterest } from '@/lib/piggy/interest-run';
