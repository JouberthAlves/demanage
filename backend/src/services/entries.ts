import type {
  CustomTag,
  Entry,
  EntryFrequency,
  EntryReceipt,
  EntryType,
  Prisma,
} from '@/generated/prisma/client';
import { badRequest, conflict, notFound } from '@/http/errors';
import {
  parseAmount,
  parseMonthKey,
  parseOptionalId,
  parseRequiredText,
} from '@/http/parsers';
import { parseOptionalNote, parsePatchNote } from '@/http/request';
import {
  dayKeyInSaoPaulo,
  dayKeyToDate,
  monthKey,
  parseDayKey,
  todayKeyInSaoPaulo,
} from '@/lib/civil-date';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import { isValidEntryType, isValidFrequency } from '@/lib/validate';

import { customTagSelect, resolveCustomTagId } from './custom-tags';
import { monthBounds } from './months';
import { resolveSchedule, type ScheduleBody } from './schedule';

const SALARY_PROFILE_MESSAGE = 'O salário é gerenciado pela aba Perfil';
const SALARY_CREATE_MESSAGE = 'O salário é cadastrado pela aba Perfil';
const CUSTOM_TAG_TYPE_MESSAGE = 'Tipos personalizados devem usar type=outro';
const NOT_FOUND_MESSAGE = 'Entrada não encontrada';
const CONFLICT_MESSAGE =
  'Entrada alterada por outra operação; atualize e tente novamente';

export const entryInclude = {
  customTag: { select: customTagSelect },
  receipts: {
    orderBy: [{ receivedAt: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.EntryInclude;

type EntryRow = Entry & {
  customTag?: Pick<CustomTag, 'id' | 'name' | 'color'> | null;
  receipts?: EntryReceipt[];
};

/** Resposta única de entradas: valores monetários sempre como número. */
export function serializeEntry(entry: EntryRow) {
  return {
    ...entry,
    amount: Number(entry.amount),
    ...(entry.receipts
      ? {
          receipts: entry.receipts.map((receipt) => ({
            ...receipt,
            amount: Number(receipt.amount),
          })),
        }
      : {}),
  };
}

// ---------------------------------------------------------------- parsing

export type CreateEntryInput = {
  name: string;
  notes: string | null;
  amount: number;
  type: EntryType;
  frequency: EntryFrequency;
  customTagId: string | null;
  schedule: ScheduleBody;
};

export type UpdateEntryInput = {
  name?: string;
  notes?: string | null;
  amount?: number;
  type?: EntryType;
  frequency?: EntryFrequency;
  customTagId?: string | null;
  schedule: ScheduleBody;
};

function scheduleBodyOf(body: Record<string, unknown>): ScheduleBody {
  return {
    day: body.receiveDay,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    date: body.date,
  };
}

function parseTagId(value: unknown) {
  return parseOptionalId(value, 'Tipo personalizado inválido');
}

function validateNoteLength(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 500) {
    throw badRequest('Descrição deve ter no máximo 500 caracteres');
  }
}

export function parseCreateEntry(
  body: Record<string, unknown>,
): CreateEntryInput {
  const { name, amount, type, frequency } = body;
  validateNoteLength(body.notes);

  const trimmedName = parseRequiredText(
    name,
    100,
    'Campos obrigatórios: name, amount, type, frequency',
  );
  if (amount == null || !type || !frequency) {
    throw badRequest('Campos obrigatórios: name, amount, type, frequency');
  }

  const parsedAmount = parseAmount(amount);
  if (!isValidEntryType(type)) throw badRequest('Tipo inválido');
  if (type === 'salario') throw badRequest(SALARY_CREATE_MESSAGE);
  if (!isValidFrequency(frequency)) throw badRequest('Frequência inválida');

  return {
    name: trimmedName,
    notes: parseOptionalNote(body.notes),
    amount: parsedAmount,
    type: type as EntryType,
    frequency: frequency as EntryFrequency,
    customTagId: parseTagId(body.customTagId) ?? null,
    schedule: scheduleBodyOf(body),
  };
}

export function parseUpdateEntry(
  body: Record<string, unknown>,
): UpdateEntryInput {
  const { name, amount, type, frequency } = body;
  validateNoteLength(body.notes);

  if (type !== undefined && !isValidEntryType(type)) {
    throw badRequest('Tipo inválido');
  }
  if (type === 'salario') throw badRequest(SALARY_CREATE_MESSAGE);
  if (frequency !== undefined && !isValidFrequency(frequency)) {
    throw badRequest('Frequência inválida');
  }

  return {
    name:
      name === undefined
        ? undefined
        : parseRequiredText(name, 100, 'Nome inválido'),
    notes: parsePatchNote(body.notes),
    amount: amount === undefined ? undefined : parseAmount(amount),
    type: type as EntryType | undefined,
    frequency: frequency as EntryFrequency | undefined,
    customTagId: parseTagId(body.customTagId),
    schedule: scheduleBodyOf(body),
  };
}

export type ReceiptState = 'automatic' | 'received' | 'waiting';

export function parseReceiptStateBody(body: Record<string, unknown>): {
  month: string;
  state: ReceiptState;
  receivedOn?: string;
  expectedUpdatedAt?: string;
} {
  const month = parseMonthKey(body.month);
  const state = body.state;
  if (
    !month ||
    (state !== 'automatic' && state !== 'received' && state !== 'waiting')
  ) {
    throw badRequest('Estado de recebimento inválido');
  }
  const receivedOn = body.receivedOn;
  const expectedUpdatedAt = body.expectedUpdatedAt;
  if (receivedOn !== undefined) {
    if (
      state !== 'received' ||
      typeof receivedOn !== 'string' ||
      !parseDayKey(receivedOn) ||
      monthKey(receivedOn) !== month ||
      receivedOn > todayKeyInSaoPaulo()
    ) {
      throw badRequest('Data efetiva do recebimento inválida');
    }
  }
  if (expectedUpdatedAt !== undefined) {
    if (
      typeof expectedUpdatedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
        expectedUpdatedAt,
      ) ||
      Number.isNaN(Date.parse(expectedUpdatedAt)) ||
      new Date(expectedUpdatedAt).toISOString() !== expectedUpdatedAt
    ) {
      throw badRequest('Versão de entrada inválida');
    }
  }
  return {
    month,
    state,
    ...(receivedOn !== undefined ? { receivedOn } : {}),
    ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
  };
}

// -------------------------------------------------------------- operations

export function listEntries(userId: string) {
  return prisma.entry.findMany({
    where: { userId, archivedAt: null, systemOrigin: 'manual' },
    include: entryInclude,
    orderBy: { createdAt: 'desc' },
  });
}

export async function createEntry(userId: string, input: CreateEntryInput) {
  const schedule = resolveSchedule({
    kind: 'income',
    frequency: input.frequency,
    body: input.schedule,
  });
  const customTagId = await resolveCustomTagId(prisma, {
    userId,
    scope: 'income',
    customTagId: input.customTagId,
  });
  if (customTagId && input.type !== 'outro') {
    throw badRequest(CUSTOM_TAG_TYPE_MESSAGE);
  }

  return prisma.entry.create({
    data: {
      userId,
      name: input.name,
      notes: input.notes,
      amount: input.amount,
      type: input.type,
      frequency: input.frequency,
      date: schedule.date ?? null,
      receiveDay: schedule.day ?? null,
      startsAt: schedule.startsAt ?? null,
      endsAt: schedule.endsAt ?? null,
      customTagId,
    },
    include: entryInclude,
  });
}

/** A recorded one-off receipt cannot be turned into a second recurring obligation. */
export function assertEntryFrequencyTransition(
  previous: EntryFrequency,
  next: EntryFrequency,
  hasRecordedReceipt: boolean,
) {
  if (previous === 'unica' && next !== 'unica' && hasRecordedReceipt) {
    throw conflict(
      'Entrada avulsa com recebimento registrado não pode virar recorrente; crie uma nova entrada',
    );
  }
}

export async function updateEntry(
  userId: string,
  id: string,
  input: UpdateEntryInput,
) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const existing = await tx.entry.findFirst({ where: { id, userId } });
    if (!existing) throw notFound(NOT_FOUND_MESSAGE);
    if (existing.type === 'salario') throw badRequest(SALARY_PROFILE_MESSAGE);
    if (existing.archivedAt) throw notFound(NOT_FOUND_MESSAGE);
    if (existing.systemOrigin !== 'manual') {
      throw badRequest(
        'Movimentações de cofrinho ou ativos não podem ser editadas aqui',
      );
    }

    const resolvedTagId =
      input.customTagId === undefined
        ? undefined
        : await resolveCustomTagId(tx, {
            userId,
            scope: 'income',
            customTagId: input.customTagId,
          });

    const nextType = input.type ?? existing.type;
    const nextFrequency = input.frequency ?? existing.frequency;
    if (existing.frequency === 'unica' && nextFrequency !== 'unica') {
      const receipt = await tx.entryReceipt.findFirst({
        where: { entryId: id },
        select: { id: true },
      });
      assertEntryFrequencyTransition(
        existing.frequency,
        nextFrequency,
        receipt !== null,
      );
    }
    const nextCustomTagId =
      resolvedTagId !== undefined ? resolvedTagId : existing.customTagId;
    if (nextCustomTagId && nextType !== 'outro') {
      throw badRequest(CUSTOM_TAG_TYPE_MESSAGE);
    }

    const schedule = resolveSchedule({
      kind: 'income',
      frequency: nextFrequency,
      body: input.schedule,
      existing: {
        day: existing.receiveDay,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        date: existing.date,
      },
    });

    // updatedAt como guarda otimista contra escritores fora do lock do usuário.
    const { count } = await tx.entry.updateMany({
      where: { id, userId, updatedAt: existing.updatedAt },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.frequency !== undefined
          ? { frequency: input.frequency }
          : {}),
        ...(schedule.date !== undefined ? { date: schedule.date } : {}),
        ...(schedule.day !== undefined ? { receiveDay: schedule.day } : {}),
        ...(schedule.startsAt !== undefined
          ? { startsAt: schedule.startsAt }
          : {}),
        ...(schedule.endsAt !== undefined ? { endsAt: schedule.endsAt } : {}),
        ...(resolvedTagId !== undefined ? { customTagId: resolvedTagId } : {}),
      },
    });
    if (count === 0) throw conflict(CONFLICT_MESSAGE);

    return tx.entry.findUniqueOrThrow({ where: { id }, include: entryInclude });
  });
}

export async function archiveEntry(userId: string, id: string) {
  await withUserWriteLockTransaction(userId, async (tx) => {
    const existing = await tx.entry.findFirst({
      where: { id, userId, archivedAt: null },
    });
    if (!existing) throw notFound(NOT_FOUND_MESSAGE);
    if (existing.systemOrigin !== 'manual') {
      throw badRequest(
        'Movimentações de cofrinho ou ativos não podem ser excluídas aqui',
      );
    }
    if (existing.type === 'salario') throw badRequest(SALARY_PROFILE_MESSAGE);

    await tx.entry.update({ where: { id }, data: { archivedAt: new Date() } });
  });
}

export async function setReceiptState(
  userId: string,
  id: string,
  month: string,
  state: ReceiptState,
  options: { receivedOn?: string; expectedUpdatedAt?: string } = {},
) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const existing = await tx.entry.findFirst({
      where: { id, userId, archivedAt: null, systemOrigin: 'manual' },
    });
    if (!existing) throw notFound(NOT_FOUND_MESSAGE);

    const isMonthlySalary =
      existing.type === 'salario' && existing.frequency === 'mensal';
    const isOneTimeIncome = existing.frequency === 'unica';
    if (!isMonthlySalary && !isOneTimeIncome) {
      throw badRequest(
        'Confirmação manual é permitida apenas para salário mensal ou entrada avulsa',
      );
    }
    if (isOneTimeIncome && state === 'automatic') {
      throw badRequest(
        'Entrada avulsa exige confirmação explícita de recebimento',
      );
    }

    let oneOffReceipt: EntryReceipt | null = null;
    if (isOneTimeIncome) {
      if (
        !options.expectedUpdatedAt ||
        Number.isNaN(Date.parse(options.expectedUpdatedAt))
      ) {
        throw badRequest(
          'Atualize as entradas antes de confirmar o recebimento',
        );
      }
      if (
        state === 'received' &&
        (!options.receivedOn ||
          !parseDayKey(options.receivedOn) ||
          monthKey(options.receivedOn) !== month ||
          options.receivedOn > todayKeyInSaoPaulo())
      ) {
        throw badRequest('Informe a data efetiva do recebimento');
      }
      if (state !== 'received' && options.receivedOn !== undefined) {
        throw badRequest('Data efetiva não é permitida nesta operação');
      }
      oneOffReceipt = await tx.entryReceipt.findFirst({
        where: { entryId: id },
      });
      if (existing.updatedAt.toISOString() !== options.expectedUpdatedAt) {
        // A retried confirmation is safe only when it already has the exact
        // recorded effect. A stale request cannot recreate an undone receipt.
        if (
          state === 'received' &&
          oneOffReceipt?.month === month &&
          dayKeyInSaoPaulo(oneOffReceipt.receivedAt) === options.receivedOn
        ) {
          return tx.entry.findFirstOrThrow({
            where: { id, userId, archivedAt: null, systemOrigin: 'manual' },
            include: entryInclude,
          });
        }
        if (state === 'waiting' && !oneOffReceipt) {
          return tx.entry.findFirstOrThrow({
            where: { id, userId, archivedAt: null, systemOrigin: 'manual' },
            include: entryInclude,
          });
        }
        throw conflict(CONFLICT_MESSAGE);
      }
      if (
        oneOffReceipt &&
        (oneOffReceipt.month !== month ||
          (state === 'received' &&
            dayKeyInSaoPaulo(oneOffReceipt.receivedAt) !== options.receivedOn))
      ) {
        throw conflict('Essa entrada avulsa já tem um recebimento registrado');
      }
    } else if (
      options.receivedOn !== undefined ||
      options.expectedUpdatedAt !== undefined
    ) {
      throw badRequest(
        'Data e versão explícitas são reservadas às entradas avulsas',
      );
    }

    if (isMonthlySalary) {
      const bounds = monthBounds(month);
      if (existing.startsAt && existing.startsAt > bounds.end) {
        throw badRequest('Esse salário ainda não começou no mês selecionado');
      }
      if (existing.endsAt && existing.endsAt < bounds.start) {
        throw badRequest('Esse salário já terminou antes do mês selecionado');
      }
    }

    let receivedAt: Date | null = null;
    if (state === 'received') {
      const receipt = await tx.entryReceipt.upsert({
        where: { entryId_month: { entryId: id, month } },
        update: {},
        create: {
          entryId: id,
          month,
          amount: existing.amount,
          receivedAt: isOneTimeIncome
            ? dayKeyToDate(options.receivedOn!, 'noon')
            : new Date(),
        },
      });
      receivedAt = receipt.receivedAt;
    } else {
      await tx.entryReceipt.deleteMany({ where: { entryId: id, month } });
    }

    if (isMonthlySalary) {
      await tx.entry.update({
        where: { id },
        data: salaryReceiptFields(state, month, receivedAt),
      });
    } else if (
      (state === 'received' && !oneOffReceipt) ||
      (state === 'waiting' && oneOffReceipt)
    ) {
      // Monotonic optimistic version: protects against stale requests, including
      // replay after undo, even when two transactions execute within one ms.
      const nextUpdatedAt = new Date(
        Math.max(Date.now(), existing.updatedAt.getTime() + 1),
      );
      const { count } = await tx.entry.updateMany({
        where: { id, userId, updatedAt: existing.updatedAt },
        data: { updatedAt: nextUpdatedAt },
      });
      if (count !== 1) throw conflict(CONFLICT_MESSAGE);
    }

    return tx.entry.findFirstOrThrow({
      where: { id, userId, archivedAt: null, systemOrigin: 'manual' },
      include: entryInclude,
    });
  });
}

/** Campos denormalizados do salário mensal para cada estado de recebimento. */
export function salaryReceiptFields(
  state: ReceiptState,
  month: string,
  receivedAt: Date | null,
) {
  if (state === 'received') {
    return { receivedForMonth: month, receiptHoldForMonth: null, receivedAt };
  }
  if (state === 'waiting') {
    return {
      receivedForMonth: null,
      receiptHoldForMonth: month,
      receivedAt: null,
    };
  }
  return {
    receivedForMonth: null,
    receiptHoldForMonth: null,
    receivedAt: null,
  };
}
