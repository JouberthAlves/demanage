import { normalizePtBrDecimal, parsePtBrDecimal, toPtBrDecimalInput } from '@/lib/decimal-input';
import { formatBrlInputValue, parseCurrencyInput } from '@/lib/format';
import type { PiggyBankPayload } from '@/lib/piggy-api';
import { piggyHasGoal } from '@/lib/piggy-math';
import type { PiggyBank } from '@/types/finance';

export type PiggyFormState = {
  name: string;
  goalAmount: string;
  targetDate: string;
  autoDebit: boolean;
  autoDebitDay: string;
  monthlyDebitAmount: string;
  isEmergency: boolean;
  yieldEnabled: boolean;
  cdiPercent: string;
};

export const EMPTY_PIGGY_FORM: PiggyFormState = {
  name: '',
  goalAmount: '',
  targetDate: '',
  autoDebit: false,
  autoDebitDay: '1',
  monthlyDebitAmount: '',
  isEmergency: false,
  yieldEnabled: false,
  cdiPercent: '100',
};

export const MAX_CDI_PERCENT = 1000;

export function formFromBank(bank: PiggyBank | null): PiggyFormState {
  if (!bank) return EMPTY_PIGGY_FORM;
  return {
    name: bank.name,
    goalAmount: piggyHasGoal(bank.goalAmount)
      ? formatBrlInputValue(bank.goalAmount)
      : '',
    targetDate: bank.targetDate ?? '',
    autoDebit: bank.autoDebit,
    autoDebitDay: String(bank.autoDebitDay || 1),
    monthlyDebitAmount:
      bank.monthlyGoal > 0 ? formatBrlInputValue(bank.monthlyGoal) : '',
    isEmergency: bank.isEmergency,
    yieldEnabled: bank.yieldEnabled,
    cdiPercent: toPtBrDecimalInput(bank.cdiPercent || 100),
  };
}

export type PiggyPayloadResult =
  | { ok: true; payload: PiggyBankPayload }
  | { ok: false; error: string };

/**
 * Validates the form and builds the API payload.
 * `suggestedMonthly` is the monthly goal derived from goal + target date
 * (0 when there is none); it is used as the auto-debit amount when present.
 */
export function buildPiggyPayload(
  form: PiggyFormState,
  suggestedMonthly: number,
): PiggyPayloadResult {
  if (!form.name.trim()) {
    return { ok: false, error: 'Informe o nome do cofre' };
  }

  const goalAmount = form.goalAmount
    ? parseCurrencyInput(form.goalAmount)
    : null;
  if (form.goalAmount && (!goalAmount || goalAmount <= 0)) {
    return { ok: false, error: 'A meta precisa ser maior que zero' };
  }

  const autoDebitDay = Number(form.autoDebitDay);
  if (
    form.autoDebit &&
    (!Number.isInteger(autoDebitDay) || autoDebitDay < 1 || autoDebitDay > 31)
  ) {
    return { ok: false, error: 'Informe o dia do débito automático (1 a 31)' };
  }

  let monthlyGoal = suggestedMonthly;
  if (form.autoDebit && monthlyGoal <= 0) {
    monthlyGoal = parseCurrencyInput(form.monthlyDebitAmount);
    if (!monthlyGoal || monthlyGoal <= 0) {
      return { ok: false, error: 'Informe o valor do débito automático' };
    }
  }

  let cdiPercent = 0;
  if (form.yieldEnabled) {
    const parsed = parsePtBrDecimal(form.cdiPercent);
    if (parsed == null || parsed <= 0 || parsed > MAX_CDI_PERCENT) {
      return {
        ok: false,
        error: `Informe um % do CDI maior que 0 e até ${MAX_CDI_PERCENT}`,
      };
    }
    cdiPercent = Number(normalizePtBrDecimal(form.cdiPercent));
  }

  return {
    ok: true,
    payload: {
      name: form.name.trim().slice(0, 50),
      goalAmount,
      targetDate: form.targetDate || null,
      monthlyGoal: form.autoDebit ? monthlyGoal : 0,
      autoDebit: form.autoDebit,
      autoDebitDay: form.autoDebit ? autoDebitDay : 1,
      isEmergency: form.isEmergency,
      yieldEnabled: form.yieldEnabled,
      cdiPercent,
    },
  };
}
