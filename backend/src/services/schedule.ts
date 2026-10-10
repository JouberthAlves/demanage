import { badRequest } from '@/http/errors';
import { parseDayOfMonth, parseOptionalIsoDate } from '@/http/parsers';
import { parseUniqueDate } from '@/lib/validate';

export type ScheduleKind = 'income' | 'expense';

const MESSAGES = {
  income: {
    dayRequired: 'Informe o dia em que recebe (1-31)',
    dayInvalid: 'Dia de recebimento inválido (1-31)',
    startRequired: 'Informe o mês em que recebe',
    startInvalid: 'Mês de recebimento inválido',
    endBeforeStart: 'Data de término deve ser após o primeiro recebimento',
    dateRequired: 'Informe a data da entrada única',
  },
  expense: {
    dayRequired: 'Informe o dia em que será descontado (1-31)',
    dayInvalid: 'Dia de desconto inválido (1-31)',
    startRequired: 'Informe o mês em que será descontado',
    startInvalid: 'Mês de desconto inválido',
    endBeforeStart: 'Data de término deve ser após o primeiro desconto',
    dateRequired: 'Informe uma data válida para a despesa avulsa',
  },
} as const;

const END_INVALID = 'Data de término inválida';

/** Campos de agenda como chegam no corpo da requisição. */
export type ScheduleBody = {
  day: unknown;
  startsAt: unknown;
  endsAt: unknown;
  date: unknown;
};

/** Agenda já persistida (PATCH). */
export type ExistingSchedule = {
  day: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  date: Date | null;
};

/**
 * `undefined` = não alterar; `null` = limpar. Em criação nunca há `undefined`.
 */
export type ResolvedSchedule = {
  day: number | null | undefined;
  startsAt: Date | null | undefined;
  endsAt: Date | null | undefined;
  date: Date | null | undefined;
};

/**
 * Valida e resolve a agenda de uma entrada/despesa (criação ou edição).
 * `frequency` é a frequência **efetiva** (corpo ou valor existente).
 *
 * - `unica`: exige data civil; limpa dia/início/fim.
 * - recorrente: exige dia (1-31) e mês de início, fim opcional e >= início;
 *   limpa a data avulsa.
 */
export function resolveSchedule(args: {
  kind: ScheduleKind;
  frequency: string;
  body: ScheduleBody;
  existing?: ExistingSchedule;
}): ResolvedSchedule {
  const { kind, frequency, body, existing } = args;
  const messages = MESSAGES[kind];

  if (frequency === 'unica') {
    let date: Date | null | undefined;
    if (existing && body.date === undefined) {
      if (!existing.date) throw badRequest(messages.dateRequired);
      date = undefined;
    } else {
      date = parseUniqueDate(body.date);
      if (!date) throw badRequest(messages.dateRequired);
    }
    return { day: null, startsAt: null, endsAt: null, date };
  }

  let day: number | null | undefined;
  if (!existing || body.day !== undefined) {
    const parsed = parseDayOfMonth(body.day, messages.dayInvalid);
    if (parsed == null) throw badRequest(messages.dayRequired);
    day = parsed;
  } else if (existing.day == null) {
    throw badRequest(messages.dayRequired);
  }

  let startsAt: Date | null | undefined;
  if (!existing || body.startsAt !== undefined) {
    const parsed = parseOptionalIsoDate(body.startsAt, messages.startInvalid);
    if (parsed == null) throw badRequest(messages.startRequired);
    startsAt = parsed;
  } else if (existing.startsAt == null) {
    throw badRequest(messages.startRequired);
  }

  let endsAt: Date | null | undefined;
  if (body.endsAt !== undefined) {
    endsAt = parseOptionalIsoDate(body.endsAt, END_INVALID);
  } else if (!existing) {
    endsAt = null;
  }

  const effectiveStart = startsAt !== undefined ? startsAt : existing?.startsAt;
  const effectiveEnd = endsAt !== undefined ? endsAt : existing?.endsAt;
  if (
    effectiveStart &&
    effectiveEnd &&
    effectiveEnd.getTime() < effectiveStart.getTime()
  ) {
    throw badRequest(messages.endBeforeStart);
  }

  return { day, startsAt, endsAt, date: null };
}
