/** Primeiro e último instante (UTC) do mês `YYYY-MM`. */
export function monthBounds(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const monthIndex = month - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999)),
  };
}
