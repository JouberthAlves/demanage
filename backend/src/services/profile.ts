import type { Prisma } from '@/generated/prisma/client';
import { badRequest } from '@/http/errors';
import {
  parseAmount,
  parseDayOfMonth,
  parseRequiredText,
} from '@/http/parsers';
import { parsePatchNote } from '@/http/request';
import { todayInSaoPaulo } from '@/lib/card-billing';
import { prisma } from '@/lib/prisma';
import { MAX_MONEY_AMOUNT } from '@/lib/validate';

const SALARY_ENTRY = {
  type: 'salario',
  frequency: 'mensal',
  name: 'Salário',
} as const;

/** Salário "canônico" do usuário: o mais antigo, para resultado determinístico. */
function findSalaryEntry(
  db: Pick<Prisma.TransactionClient, 'entry'>,
  userId: string,
) {
  return db.entry.findFirst({
    where: { userId, ...SALARY_ENTRY },
    orderBy: { createdAt: 'asc' },
  });
}

export async function salaryReceiveDayOf(userId: string) {
  const entry = await findSalaryEntry(prisma, userId);
  return entry?.receiveDay ?? null;
}

export type UpdateProfileInput = {
  name?: string;
  salary?: number;
  notes?: string | null;
  salaryReceiveDay?: number | null;
};

export function parseUpdateProfile(
  body: Record<string, unknown>,
): UpdateProfileInput {
  return {
    salary:
      body.salary === undefined
        ? undefined
        : parseAmount(body.salary, {
            allowZero: true,
            message: `Salário inválido (máximo R$ ${MAX_MONEY_AMOUNT.toFixed(2)})`,
          }),
    salaryReceiveDay: parseDayOfMonth(
      body.salaryReceiveDay,
      'Dia de recebimento do salário inválido (1-31)',
    ),
    name:
      body.name === undefined
        ? undefined
        : parseRequiredText(body.name, 100, 'Nome não pode ser vazio'),
    notes: parsePatchNote(body.notes),
  };
}

/** Último dia do mês anterior (meio-dia UTC): fim da vigência do salário zerado. */
export function lastDayOfPreviousMonth(today: Date) {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0, 12));
}

/**
 * Atualiza o perfil e mantém a entrada de salário mensal em sincronia:
 * salário > 0 cria/atualiza a entrada (exige dia de recebimento); salário 0
 * encerra a vigência preservando o histórico de recebimentos.
 */
export function updateProfile(userId: string, input: UpdateProfileInput) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.salary !== undefined ? { salary: input.salary } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    const shouldSyncSalaryEntry =
      input.salary !== undefined || input.salaryReceiveDay !== undefined;
    if (!shouldSyncSalaryEntry) return user;

    const salaryEntry = await findSalaryEntry(tx, userId);
    const nextSalary =
      input.salary !== undefined ? input.salary : Number(user.salary);
    const nextReceiveDay =
      input.salaryReceiveDay !== undefined
        ? input.salaryReceiveDay
        : (salaryEntry?.receiveDay ?? null);

    if (nextSalary > 0) {
      if (nextReceiveDay == null) {
        throw badRequest('Informe o dia em que recebe o salário (1-31)');
      }
      if (salaryEntry) {
        await tx.entry.update({
          where: { id: salaryEntry.id },
          data: {
            amount: nextSalary,
            receiveDay: nextReceiveDay,
            endsAt: null,
          },
        });
      } else {
        await tx.entry.create({
          data: {
            userId,
            ...SALARY_ENTRY,
            amount: nextSalary,
            receiveDay: nextReceiveDay,
            endsAt: null,
          },
        });
      }
    } else if (salaryEntry) {
      await tx.entry.update({
        where: { id: salaryEntry.id },
        data: {
          amount: 0,
          endsAt: lastDayOfPreviousMonth(todayInSaoPaulo()),
        },
      });
    }

    return user;
  });
}
