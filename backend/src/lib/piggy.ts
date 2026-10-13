/**
 * Compatibility shim. Implementation lives in lib/piggy/*:
 *   ledger.ts (the one balance function) · model.ts (goal maths, parsing,
 *   serializers) · auto-debit.ts (pure cycles) · transactions.ts (deposit /
 *   withdraw) · auto-debit-run.ts · interest.ts (pure) · interest-run.ts.
 * Pure callers should import the pure modules directly (no DB client load).
 */
export {
  currentAutoDebitCycle,
  hasAutoDebitInCycle,
} from '@/lib/piggy/auto-debit';
export {
  processPiggyAutoDebits,
  runPiggyAutoDebits,
} from '@/lib/piggy/auto-debit-run';
export {
  balanceDecimalFromTransactions,
  balanceFromTransactions,
} from '@/lib/piggy/ledger';
export {
  computeMonthlyGoal,
  monthsUntilTarget,
  parseAutoDebitDay,
  parseOptionalTargetDate,
  parseTargetDate,
  piggyGoalAmount,
  serializePiggyBank,
  serializePiggyTransaction,
} from '@/lib/piggy/model';
export {
  depositToPiggyBank,
  withdrawFromPiggyBank,
} from '@/lib/piggy/transactions';
