/** Meses de calendário até a data alvo (mínimo 1). */
export function monthsUntilTarget(targetDate: string, from = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!match) return 1;

  const toYear = Number(match[1]);
  const toMonth = Number(match[2]) - 1;
  const months =
    (toYear - from.getFullYear()) * 12 + (toMonth - from.getMonth());
  return Math.max(1, months);
}

export function computeMonthlyGoal(goalAmount: number, targetDate: string) {
  if (!Number.isFinite(goalAmount) || goalAmount <= 0 || !targetDate) {
    return 0;
  }
  const months = monthsUntilTarget(targetDate);
  return Math.round((goalAmount / months) * 100) / 100;
}
