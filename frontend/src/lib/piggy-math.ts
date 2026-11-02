/** Meses de calendário até a data alvo (mínimo 1). */
export function monthsUntilTarget(targetDate: string, from = new Date(), autoDebitDay?: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!match) return 1;

  const toYear = Number(match[1]);
  const toMonth = Number(match[2]) - 1;
  const months =
    (toYear - from.getFullYear()) * 12 + (toMonth - from.getMonth()) + 1;
  if (autoDebitDay == null || months <= 0) return Math.max(1, months);

  const dueDay = (year: number, month: number) => Math.min(
    autoDebitDay,
    new Date(year, month + 1, 0).getDate(),
  );
  const missedCurrent = from.getDate() > dueDay(from.getFullYear(), from.getMonth()) ? 1 : 0;
  const beyondTarget = Number(match[3]) < dueDay(toYear, toMonth) ? 1 : 0;
  return Math.max(1, months - missedCurrent - beyondTarget);
}

export function piggyHasGoal(
  goalAmount: number | null | undefined,
): goalAmount is number {
  return goalAmount != null && goalAmount > 0;
}

export function computeMonthlyGoal(
  goalAmount: number,
  targetDate: string | null | undefined,
  balance = 0,
  from = new Date(),
  autoDebitDay?: number,
) {
  if (!Number.isFinite(goalAmount) || goalAmount <= 0 || !targetDate) {
    return 0;
  }
  const remainingCents = Math.max(0, Math.round(goalAmount * 100) - Math.round(balance * 100));
  if (!remainingCents) return 0;
  const months = monthsUntilTarget(targetDate, from, autoDebitDay);
  return Math.round(remainingCents / months) / 100;
}
