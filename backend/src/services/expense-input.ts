import type {
  ExpenseCategory,
  ExpenseFrequency,
} from '@/generated/prisma/client';
import { badRequest } from '@/http/errors';
import {
  parseAmount,
  parseMonthKey,
  parseOptionalId,
  parseRequiredText,
} from '@/http/parsers';
import { parseOptionalNote, parsePatchNote } from '@/http/request';
import { isValidExpenseCategory, isValidFrequency } from '@/lib/validate';

import type { ScheduleBody } from './schedule';

/** Corpo comum de despesa já tipado; `cardId`/`splits` seguem para o lib de splits. */
type CardFields = { cardId: unknown; splits: unknown };

export type CreateExpenseInput = CardFields & {
  name: string;
  amount: number;
  category: ExpenseCategory;
  frequency: ExpenseFrequency;
  notes: string | null;
  customTagId: string | null;
  schedule: ScheduleBody;
};

export type UpdateExpenseInput = CardFields & {
  name?: string;
  amount?: number;
  category?: ExpenseCategory;
  frequency?: ExpenseFrequency;
  notes?: string | null;
  customTagId?: string | null;
  schedule: ScheduleBody;
};

function scheduleBodyOf(body: Record<string, unknown>): ScheduleBody {
  return {
    day: body.dueDay,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    date: body.date,
  };
}

function checkCardId(value: unknown) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw badRequest('Cartão inválido');
  }
  return value;
}

function parseTagId(value: unknown) {
  return parseOptionalId(value, 'Tipo personalizado inválido');
}

export function parseCreateExpense(
  body: Record<string, unknown>,
): CreateExpenseInput {
  const { name, amount, category } = body;
  const requiredMessage = 'Campos obrigatórios: name, amount, category';

  const trimmedName = parseRequiredText(name, 100, requiredMessage);
  if (amount == null || !category) throw badRequest(requiredMessage);

  const parsedAmount = parseAmount(amount);
  if (!isValidExpenseCategory(category)) throw badRequest('Categoria inválida');
  if (category === 'cofrinho' || category === 'investimento') {
    throw badRequest(
      'Investimentos são lançados pelas abas Cofrinho ou Moedas',
    );
  }

  const frequency = body.frequency ?? 'mensal';
  if (!isValidFrequency(frequency)) throw badRequest('Frequência inválida');

  return {
    name: trimmedName,
    amount: parsedAmount,
    category: category as ExpenseCategory,
    frequency: frequency as ExpenseFrequency,
    notes: parseOptionalNote(body.notes),
    customTagId: parseTagId(body.customTagId) ?? null,
    cardId: checkCardId(body.cardId),
    splits: body.splits,
    schedule: scheduleBodyOf(body),
  };
}

export function parseUpdateExpense(
  body: Record<string, unknown>,
): UpdateExpenseInput {
  const { name, amount, category, frequency } = body;

  if (category !== undefined && !isValidExpenseCategory(category)) {
    throw badRequest('Categoria inválida');
  }
  if (frequency !== undefined && !isValidFrequency(frequency)) {
    throw badRequest('Frequência inválida');
  }

  return {
    name:
      name === undefined
        ? undefined
        : parseRequiredText(name, 100, 'Nome inválido'),
    amount: amount === undefined ? undefined : parseAmount(amount),
    category: category as ExpenseCategory | undefined,
    frequency: frequency as ExpenseFrequency | undefined,
    notes: parsePatchNote(body.notes),
    customTagId: parseTagId(body.customTagId),
    cardId: checkCardId(body.cardId),
    splits: body.splits,
    schedule: scheduleBodyOf(body),
  };
}

export function parsePayExpenseBody(body: Record<string, unknown>): string {
  const month = parseMonthKey(body.month);
  if (!month) throw badRequest('Mês de pagamento inválido');
  return month;
}
