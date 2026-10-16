import { parseDayKey } from '@/lib/civil-date';

/** Deterministic guardrail: structured AI inputs cannot invent missing money intent. */
export function validateFinancialDraft(draft: Record<string, unknown>): string[] {
  const questions: string[] = [];
  const kind = draft.kind;
  if (
    kind !== 'receive_income' &&
    kind !== 'deposit_existing_cash' &&
    kind !== 'receive_and_save'
  ) {
    return ['Você quer registrar uma entrada, transferir dinheiro existente para um cofrinho ou receber e guardar?'];
  }
  if (
    !Number.isSafeInteger(draft.amountCents) ||
    (draft.amountCents as number) <= 0 ||
    (draft.amountCents as number) > 999_999_999_999
  ) {
    questions.push('Qual é o valor exato em reais?');
  }
  if (!parseDayKey(draft.dateKey)) {
    questions.push('Qual é a data da movimentação?');
  }

  if (kind === 'receive_income' || kind === 'receive_and_save') {
    if (
      typeof draft.description !== 'string' ||
      !draft.description.trim() ||
      draft.description.length > 500
    ) {
      questions.push('Qual descrição você quer registrar na entrada?');
    }
    if (
      draft.tagName !== null &&
      (typeof draft.tagName !== 'string' ||
        !draft.tagName.trim() ||
        draft.tagName.length > 100)
    ) {
      questions.push('Qual é a tag da entrada? Você também pode pedir explicitamente sem tag.');
    }
  }

  if (kind === 'deposit_existing_cash' || kind === 'receive_and_save') {
    const hasBankId = typeof draft.bankId === 'string' && draft.bankId.trim();
    const hasBankName = typeof draft.bankName === 'string' && draft.bankName.trim();
    if (!hasBankId && !hasBankName) {
      questions.push('Em qual cofrinho você quer guardar o valor?');
    }
  }
  if (
    kind === 'receive_income' &&
    ((typeof draft.bankId === 'string' && draft.bankId.trim()) ||
      (typeof draft.bankName === 'string' && draft.bankName.trim()))
  ) {
    questions.push('Você quer apenas registrar a entrada ou também guardar esse dinheiro no cofrinho informado?');
  }
  if (
    kind === 'receive_and_save' &&
    draft.deductFromBalance !== undefined &&
    draft.deductFromBalance !== true
  ) {
    questions.push('Para receber e guardar, o valor precisa sair do saldo principal. Confirma esse desconto?');
  }
  if (kind === 'deposit_existing_cash' && typeof draft.deductFromBalance !== 'boolean') {
    questions.push('Deseja descontar esse valor do saldo principal ou apenas registrá-lo no cofrinho?');
  }

  return questions;
}
