import { Router, Request, Response } from 'express';

import { customTagSelect } from '@/lib/custom-tag';
import { entryReceiptInclude } from '@/lib/entry-receipts';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

type ReceiptState = 'automatic' | 'received' | 'waiting';

function parseMonthKey(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return value;
}

function parseReceiptState(value: unknown): ReceiptState | null {
  if (value === 'automatic' || value === 'received' || value === 'waiting') {
    return value;
  }
  return null;
}

function monthBounds(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const monthIndex = month - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999)),
  };
}

router.post(
  '/:id/receipt-state',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const id = String(req.params.id);

      if (!userId) {
        return res.status(401).json({ error: 'Não autenticado' });
      }

      const month = parseMonthKey(req.body?.month);
      const state = parseReceiptState(req.body?.state);
      if (!month || !state) {
        return res
          .status(400)
          .json({ error: 'Estado de recebimento inválido' });
      }

      const result = await withUserWriteLockTransaction(userId, async (tx) => {
        const existing = await tx.entry.findFirst({
          where: { id, userId, archivedAt: null, systemOrigin: 'manual' },
          include: { customTag: { select: customTagSelect } },
        });

        if (!existing) return { status: 404, error: 'Entrada não encontrada' };

        const isMonthlySalary =
          existing.type === 'salario' && existing.frequency === 'mensal';
        const isOneTimeIncome = existing.frequency === 'unica';
        if (!isMonthlySalary && !isOneTimeIncome) {
          return {
            status: 400,
            error:
              'Confirmação manual é permitida apenas para salário mensal ou entrada avulsa',
          };
        }

        if (isOneTimeIncome && state === 'automatic') {
          return {
            status: 400,
            error: 'Entrada avulsa exige confirmação explícita de recebimento',
          };
        }

        if (isMonthlySalary) {
          const bounds = monthBounds(month);
          if (existing.startsAt && existing.startsAt > bounds.end) {
            return {
              status: 400,
              error: 'Esse salário ainda não começou no mês selecionado',
            };
          }
          if (existing.endsAt && existing.endsAt < bounds.start) {
            return {
              status: 400,
              error: 'Esse salário já terminou antes do mês selecionado',
            };
          }
        }

        let receivedAt: Date | null = null;
        if (state === 'received') {
          if (isOneTimeIncome) {
            const existingReceipt = await tx.entryReceipt.findFirst({
              where: { entryId: id },
            });
            if (existingReceipt && existingReceipt.month !== month) {
              return {
                status: 409,
                error: 'Essa entrada avulsa já tem um recebimento registrado',
              };
            }
          }
          const receipt = await tx.entryReceipt.upsert({
            where: { entryId_month: { entryId: id, month } },
            update: {},
            create: {
              entryId: id,
              month,
              amount: existing.amount,
              receivedAt: new Date(),
            },
          });
          receivedAt = receipt.receivedAt;
        } else {
          await tx.entryReceipt.deleteMany({ where: { entryId: id, month } });
        }

        if (isMonthlySalary) {
          await tx.entry.update({
            where: { id },
            data:
              state === 'received'
                ? {
                    receivedForMonth: month,
                    receiptHoldForMonth: null,
                    receivedAt,
                  }
                : state === 'waiting'
                  ? {
                      receivedForMonth: null,
                      receiptHoldForMonth: month,
                      receivedAt: null,
                    }
                  : {
                      receivedForMonth: null,
                      receiptHoldForMonth: null,
                      receivedAt: null,
                    },
          });
        }

        const entry = await tx.entry.findFirst({
          where: { id, userId, archivedAt: null, systemOrigin: 'manual' },
          include: {
            customTag: { select: customTagSelect },
            ...entryReceiptInclude,
          },
        });
        if (!entry) return { status: 404, error: 'Entrada não encontrada' };
        return { entry };
      });

      if ('error' in result) {
        return res.status(result.status ?? 500).json({ error: result.error });
      }
      return res.json(result.entry);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
