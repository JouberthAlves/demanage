/** "MM-DD" -> "DD/MM" */
export function formatAxisDate(value: string) {
  const [month, day] = value.split('-');
  if (!month || !day) return value;
  return `${day}/${month}`;
}

export function formatAxisValue(value: number) {
  const abs = Math.abs(value);
  if (abs < 1000) {
    return new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: abs < 10 ? 2 : 0,
    }).format(value);
  }
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  })
    .format(value)
    .toLowerCase();
}

export function paddedYDomain(values: number[]): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return [0, 1];
  }

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  const pad = span === 0 ? Math.max(Math.abs(max) * 0.04, 0.01) : span * 0.16;

  return [min - pad * 0.45, max + pad];
}
