import { Prisma } from '@/generated/prisma/client';
import { todayKeyInSaoPaulo } from '@/lib/civil-date';
import { balanceDecimalFromTransactions } from '@/lib/piggy/ledger';
import { type FinanceAction } from '@/services/finance-operation';
import { getMcpIntentSecret } from '@/utils/var';

import {
  createSignedFinanceIntent,
  type FinanceIntentIdentity,
  verifySignedFinanceIntent,
} from './finance-intent';
import { validateFinancialDraft } from './finance-preview-validate';

type PreviewOptions = {
  /** Tests may supply a secret; otherwise this must come from server configuration. */
  secret?: string;
  nowMs?: number;
};

export type FinancePreview =
  | { status: 'clarification_required'; questions: string[] }
  | {
      status: 'ready';
      intentToken: string;
      summary: string;
      effects: { cashDeltaCents: number; piggyDeltaCents: number };
    };

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function clarify(question: string): FinancePreview {
  return { status: 'clarification_required', questions: [question] };
}

/** Accent-sensitive exact name matching, case-insensitive and Unicode normalized. */
function normalizedBankName(name: string) {
  return name.trim().normalize('NFKC').toLocaleLowerCase('pt-BR');
}

function normalizedText(value: string) {
  return value.trim().normalize('NFC');
}

function isCleanText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    normalizedText(value).length > 0 &&
    normalizedText(value).length <= max &&
    !/\p{C}/u.test(value)
  );
}

function isCanonicalAction(value: Record<string, unknown>): value is FinanceAction {
  const keys: Record<FinanceAction['kind'], string[]> = {
    receive_income: ['kind', 'amountCents', 'dateKey', 'description', 'tagName'],
    receive_and_save: ['kind', 'amountCents', 'dateKey', 'description', 'tagName', 'bankId'],
    deposit_existing_cash: ['kind', 'amountCents', 'dateKey', 'bankId', 'deductFromBalance', 'note'],
  };
  const kind = value.kind;
  if (kind !== 'receive_income' && kind !== 'receive_and_save' && kind !== 'deposit_existing_cash') {
    return false;
  }
  if (
    Object.keys(value).length !== keys[kind].length ||
    !Object.keys(value).every((key) => keys[kind].includes(key)) ||
    validateFinancialDraft(value).length > 0
  ) {
    return false;
  }
  if (kind !== 'deposit_existing_cash') {
    if (!isCleanText(value.description, 500) || normalizedText(value.description) !== value.description) {
      return false;
    }
    if (
      value.tagName !== null &&
      (!isCleanText(value.tagName, 100) || normalizedText(value.tagName) !== value.tagName)
    ) {
      return false;
    }
  } else if (
    value.note !== null &&
    (!isCleanText(value.note, 500) || normalizedText(value.note) !== value.note)
  ) {
    return false;
  }
  return kind === 'receive_income' ||
    (typeof value.bankId === 'string' && value.bankId.length > 0 && value.bankId.length <= 128);
}

/** Execution must persist this nonce under a unique key to prevent replay. */
export function verifyIntentWithNonce(
  token: string,
  identity: FinanceIntentIdentity,
  options: PreviewOptions = {},
): { nonce: string; action: FinanceAction } {
  const { nonce, action } = verifySignedFinanceIntent(
    token,
    identity,
    options.secret ?? getMcpIntentSecret(),
    options.nowMs,
  );
  if (!isCanonicalAction(action)) throw new Error('Ação do intent financeiro inválida');
  return { nonce, action };
}

/** Verify signature, owner, client, age and the exact, typed canonical action. */
export function verifyIntent(
  token: string,
  identity: FinanceIntentIdentity,
  options: PreviewOptions = {},
): FinanceAction {
  return verifyIntentWithNonce(token, identity, options).action;
}

type BankRow = {
  id: string;
  name: string;
  archivedAt: Date | null;
  goalAmount: Prisma.Decimal | null;
  transactions: Array<{ type: string; amount: Prisma.Decimal }>;
};

async function findBankForPreview(
  userId: string,
  draft: Record<string, unknown>,
): Promise<{ bank: BankRow } | { question: string }> {
  // Dynamic import ensures incomplete/invalid previews do not even open a DB connection.
  const { prisma } = await import('@/lib/prisma');
  let selectedId = typeof draft.bankId === 'string' ? draft.bankId.trim() : '';
  if (!selectedId) {
    const name = normalizedBankName(draft.bankName as string);
    const banks = await prisma.piggyBank.findMany({
      where: { userId },
      select: { id: true, name: true },
    });
    const matches = banks.filter((bank) => normalizedBankName(bank.name) === name);
    if (matches.length === 0) {
      return { question: 'Cofrinho não encontrado na sua conta. Qual cofrinho deseja utilizar?' };
    }
    if (matches.length > 1) {
      return { question: 'Existem cofrinhos com esse mesmo nome. Confirme o cofrinho exato pelo identificador.' };
    }
    selectedId = matches[0].id;
  }
  // Only load the ledger for the single resolved bank, not all banks belonging
  // to a user who may have many years of transactions.
  const bank = await prisma.piggyBank.findFirst({
    where: { id: selectedId, userId },
    select: {
      id: true, name: true, archivedAt: true, goalAmount: true,
      transactions: { select: { type: true, amount: true } },
    },
  });
  if (!bank) {
    return { question: 'Cofrinho não encontrado na sua conta. Qual cofrinho deseja utilizar?' };
  }
  if (bank.archivedAt) {
    return { question: 'Esse cofrinho está arquivado e não aceita depósitos. Qual cofrinho deseja utilizar?' };
  }
  return { bank };
}

function normalizeAction(draft: Record<string, unknown>, bankId?: string): FinanceAction {
  const base = {
    amountCents: draft.amountCents as number,
    dateKey: draft.dateKey as string,
  };
  if (draft.kind === 'receive_income') {
    return {
      ...base,
      kind: 'receive_income',
      description: normalizedText(draft.description as string),
      tagName: draft.tagName === null ? null : normalizedText(draft.tagName as string),
    };
  }
  if (draft.kind === 'receive_and_save') {
    return {
      ...base,
      kind: 'receive_and_save',
      description: normalizedText(draft.description as string),
      tagName: draft.tagName === null ? null : normalizedText(draft.tagName as string),
      bankId: bankId!,
    };
  }
  return {
    ...base,
    kind: 'deposit_existing_cash',
    bankId: bankId!,
    deductFromBalance: draft.deductFromBalance as boolean,
    note: draft.note == null ? null : normalizedText(draft.note as string),
  };
}

/**
 * Read-only financial preview: never mutates tag, ledger or bank state.
 * The later execution path MUST re-check bank ownership, balance and goal.
 */
export async function previewFinanceOperation(
  identity: FinanceIntentIdentity,
  draft: Record<string, unknown>,
  options: PreviewOptions = {},
): Promise<FinancePreview> {
  if (!identity.userId || !identity.clientId) throw new Error('Identidade MCP inválida');
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return clarify('Que operação financeira você deseja realizar?');
  }
  const questions = validateFinancialDraft(draft);
  if (
    draft.kind === 'deposit_existing_cash' &&
    typeof draft.dateKey === 'string' &&
    draft.dateKey > todayKeyInSaoPaulo()
  ) {
    questions.push('A data do depósito está no futuro. Em qual data deseja registrar o movimento?');
  }
  if (
    (draft.kind === 'receive_income' || draft.kind === 'receive_and_save') &&
    isCleanText(draft.description, 500) === false
  ) {
    questions.push('A descrição deve ser um texto de até 500 caracteres, sem caracteres de controle.');
  }
  if (
    (draft.kind === 'receive_income' || draft.kind === 'receive_and_save') &&
    draft.tagName !== null && !isCleanText(draft.tagName, 100)
  ) {
    questions.push('Qual tag válida você deseja utilizar, ou prefere explicitamente sem tag?');
  }
  if (
    draft.kind === 'deposit_existing_cash' &&
    draft.note !== undefined && draft.note !== null &&
    !isCleanText(draft.note, 500)
  ) {
    questions.push('Confirme a nota do depósito (máximo de 500 caracteres), ou remova a nota.');
  }
  if (questions.length > 0) return { status: 'clarification_required', questions };

  let bank: BankRow | null = null;
  if (draft.kind !== 'receive_income') {
    const matched = await findBankForPreview(identity.userId, draft);
    if ('question' in matched) return clarify(matched.question);
    bank = matched.bank;
    const balance = balanceDecimalFromTransactions(bank.transactions);
    if (bank.goalAmount != null) {
      const remainingCents = bank.goalAmount.minus(balance).mul(100);
      if (remainingCents.lte(0)) {
        return clarify('A meta desse cofrinho já está completa. Deseja escolher outro cofrinho?');
      }
      if (remainingCents.lt(draft.amountCents as number)) {
        return clarify('A meta do cofrinho não comporta o valor inteiro. Qual valor deseja guardar?');
      }
    }
  }

  const action = normalizeAction(draft, bank?.id);
  if (!isCanonicalAction(action)) return clarify('Confirme os dados dessa operação financeira.');
  const amountCents = action.amountCents;
  const isIncome = action.kind !== 'deposit_existing_cash';
  const isDeposit = action.kind !== 'receive_income';
  const deduct = action.kind === 'receive_and_save' ||
    (action.kind === 'deposit_existing_cash' && action.deductFromBalance);
  const effects = {
    cashDeltaCents: (isIncome ? amountCents : 0) - (deduct ? amountCents : 0),
    piggyDeltaCents: isDeposit ? amountCents : 0,
  };
  const money = moneyFormatter.format(amountCents / 100);
  const summary = action.kind === 'receive_income'
    ? 'Registrar entrada recebida de ' + money + ' em ' + action.dateKey + ', sem movimento em cofrinho.'
    : action.kind === 'receive_and_save'
      ? 'Receber ' + money + ' e guardar integralmente no cofrinho ' + bank!.name +
        ': entrada +' + money + ', saldo -' + money + ', cofrinho +' + money + '.'
      : 'Guardar ' + money + ' no cofrinho ' + bank!.name +
        (deduct ? ', descontando esse valor do saldo principal.' : ', sem descontar do saldo principal.');
  const { token } = createSignedFinanceIntent(
    identity,
    action,
    options.secret ?? getMcpIntentSecret(),
    options.nowMs,
  );
  return { status: 'ready', intentToken: token, summary, effects };
}
