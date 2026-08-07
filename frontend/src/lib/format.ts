const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
});

const monthFormatter = new Intl.DateTimeFormat('pt-BR', {
  month: 'short',
  year: '2-digit',
});

export function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return currencyFormatter.format(0);
  return currencyFormatter.format(value);
}

/** Valores grandes em cards/KPIs (evita quebrar layout). */
export function formatCurrencyCompact(value: number) {
  if (!Number.isFinite(value)) return currencyFormatter.format(0);
  if (Math.abs(value) < 1_000_000) {
    return currencyFormatter.format(value);
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 100) {
    return `${(value * 100).toLocaleString('pt-BR', {
      notation: 'compact',
      maximumFractionDigits: 1,
    })}%`;
  }
  return percentFormatter.format(value);
}

/** Escala tipográfica para valores monetários longos em cards. */
export function moneyValueClass(formatted: string) {
  const length = formatted.length;
  if (length > 18) return 'text-sm sm:text-base';
  if (length > 14) return 'text-base sm:text-lg';
  if (length > 11) return 'text-lg sm:text-xl';
  return 'text-2xl';
}

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return monthFormatter.format(new Date(year, month - 1, 1));
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function getFirstName(name: string) {
  const first = name.trim().split(/\s+/).filter(Boolean)[0];
  return first || 'bem-vindo';
}

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Exibe número como `1.234,56` para inputs monetários. */
export function formatBrlInputValue(value: number) {
  if (!Number.isFinite(value)) return '';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Máscara BRL enquanto digita (centavos). */
export function maskBrlInput(raw: string) {
  // Até 12 dígitos em centavos (= Decimal(12,2) / R$ 9.999.999.999,99)
  const digits = raw.replace(/\D/g, '').slice(0, 12);
  if (!digits) return '';
  return formatBrlInputValue(Number(digits) / 100);
}

export function parseCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  if (!digits) return 0;
  return Number(digits) / 100;
}

/** Converte `MM/AA` no último instante do mês de validade. */
export function parseCardExpiryInput(value: string): Date | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 4) return null;

  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2, 4));
  if (month < 1 || month > 12) return null;

  return new Date(year, month, 0, 23, 59, 59, 999);
}

export function maskCardExpiryInput(raw: string) {
  return applyCardExpiryInput(raw).value;
}

/** Máscara MM/AA; marca erro se o mês for > 12 ou 00. */
export function applyCardExpiryInput(raw: string): {
  value: string;
  error?: string;
} {
  const digits = raw.replace(/\D/g, '').slice(0, 4);

  if (digits.length >= 2) {
    const month = Number(digits.slice(0, 2));
    if (month > 12) {
      return {
        value: digits.slice(0, 1),
        error: 'Mês inválido. Não é possível usar um mês maior que 12',
      };
    }
    if (month < 1) {
      return {
        value: digits.slice(0, 1),
        error: 'Mês inválido. Use um valor entre 01 e 12',
      };
    }
  }

  if (digits.length <= 2) {
    return { value: digits };
  }

  return { value: `${digits.slice(0, 2)}/${digits.slice(2)}` };
}

export function formatCardExpiry(expiresAt?: string | null) {
  if (!expiresAt) return '';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${year}`;
}

export function isCardExpired(expiresAt?: string | null) {
  if (!expiresAt) return false;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
}

/** Digita no máx. 2 dígitos (dia 1–31). */
export function maskClosingDayInput(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 2);
  if (!digits) return '';

  // Impede "00" / "0" como dia válido na digitação completa
  if (digits.length === 2 && Number(digits) < 1) return '';
  if (digits.length === 2 && Number(digits) > 31) return digits.slice(0, 1);

  return digits;
}

/** Completa `5` → `05`; valida 01–31. */
export function normalizeClosingDayInput(value: string) {
  const digits = maskClosingDayInput(value);
  if (!digits) return '';

  const day = Number(digits);
  if (!Number.isInteger(day) || day < 1 || day > 31) return '';

  return String(day).padStart(2, '0');
}
