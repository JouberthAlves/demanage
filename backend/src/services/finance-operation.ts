import { Prisma } from '@/generated/prisma/client';
import { badRequest } from '@/http/errors';
import { dayKeyOfDate, dayKeyToDate, todayKeyInSaoPaulo } from '@/lib/civil-date';
import { depositToPiggyBankInTransaction } from '@/lib/piggy/transactions';
import { validateFinancialDraft } from '@/mcp/finance-preview-validate';

import { resolveIncomeTagInTransaction } from './finance-tags';
import { createReceivedOneTimeIncomeInTransaction } from './received-income';

export type FinanceAction =
  | {
      kind: 'receive_income';
      amountCents: number;
      dateKey: string;
      description: string;
      tagName: string | null;
    }
  | {
      kind: 'receive_and_save';
      amountCents: number;
      dateKey: string;
      description: string;
      tagName: string | null;
      bankId: string;
    }
  | {
      kind: 'deposit_existing_cash';
      amountCents: number;
      dateKey: string;
      bankId: string;
      deductFromBalance: boolean;
      note: string | null;
    };

export type FinanceActionResult = {
  kind: FinanceAction['kind'];
  amountCents: number;
  entryId: string | null;
  receiptId: string | null;
  tagId: string | null;
  piggyTransactionId: string | null;
  expenseId: string | null;
};

/** Caller owns an atomic user-locked DB transaction. Never call nested transactions here. */
export async function runFinanceOperationInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  action: FinanceAction,
): Promise<FinanceActionResult> {
  const questions = validateFinancialDraft(action);
  if (questions.length > 0) {
    throw badRequest(questions.join(' '));
  }

  let entryId: string | null = null;
  let receiptId: string | null = null;
  let tagId: string | null = null;
  let piggyTransactionId: string | null = null;
  let expenseId: string | null = null;

  if (action.kind !== 'deposit_existing_cash') {
    if (action.tagName !== null) {
      const tag = await resolveIncomeTagInTransaction(tx, userId, action.tagName);
      tagId = tag.id;
    }
    const income = await createReceivedOneTimeIncomeInTransaction(tx, userId, {
      amountCents: action.amountCents,
      dateKey: action.dateKey,
      name: action.tagName ?? 'Entrada avulsa',
      notes: action.description,
      tagId,
    });
    entryId = income.entryId;
    receiptId = income.receiptId;
  }

  if (action.kind !== 'receive_income') {
    if (action.dateKey > todayKeyInSaoPaulo()) {
      throw badRequest('Depósito com data futura não permitido');
    }
    const targetBank = await tx.piggyBank.findFirst({
      where: { userId, id: action.bankId },
      select: { yieldEnabled: true, interestAccruedThrough: true },
    });
    if (targetBank && action.dateKey < todayKeyInSaoPaulo()) {
      const accruedThrough = targetBank.interestAccruedThrough
        ? dayKeyOfDate(targetBank.interestAccruedThrough)
        : null;
      if (targetBank.yieldEnabled || (accruedThrough !== null && action.dateKey <= accruedThrough)) {
        throw badRequest('Depósito retroativo não permitido nesse cofrinho com rendimento CDI já calculado');
      }
    }
    const deposit = await depositToPiggyBankInTransaction(tx, {
      userId,
      piggyBankId: action.bankId,
      amount: action.amountCents / 100,
      source: 'manual',
      date: dayKeyToDate(action.dateKey, 'noon'),
      note: action.kind === 'receive_and_save' ? action.description : action.note,
      deductFromBalance: action.kind === 'receive_and_save' || action.deductFromBalance,
    });
    const actualCents = new Prisma.Decimal(deposit.depositAmount).mul(100);
    if (!actualCents.equals(action.amountCents)) {
      throw badRequest('A meta do cofrinho não comporta o valor total. Confirme um novo valor.');
    }
    piggyTransactionId = deposit.transaction.id;
    expenseId = deposit.transaction.expenseId;
  }

  return {
    kind: action.kind,
    amountCents: action.amountCents,
    entryId,
    receiptId,
    tagId,
    piggyTransactionId,
    expenseId,
  };
}
