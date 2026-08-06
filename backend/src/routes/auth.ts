import { Router } from 'express';

import {
  clearAuthCookie,
  comparePassword,
  getSalaryReceiveDay,
  hashPassword,
  setAuthCookie,
  signAuthToken,
  toPublicUser,
} from '@/lib/auth';
import { parseReceiveDay } from '@/lib/entry-schedule';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const authRoutes = Router();

authRoutes.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body as {
      name?: string;
      email?: string;
      password?: string;
    };

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, email, password',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'A senha deve ter pelo menos 6 caracteres',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
      },
    });

    const token = signAuthToken(user.id);
    setAuthCookie(res, token, req);

    return res.status(201).json({ user: toPublicUser(user, null) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao registrar' });
  }
});

authRoutes.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email?.trim() || !password) {
      return res.status(400).json({
        error: 'Campos obrigatórios: email, password',
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }

    const valid = await comparePassword(password, user.passwordHash);

    if (!valid) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }

    const token = signAuthToken(user.id);
    setAuthCookie(res, token, req);
    const salaryReceiveDay = await getSalaryReceiveDay(user.id);

    return res.json({ user: toPublicUser(user, salaryReceiveDay) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao entrar' });
  }
});

authRoutes.post('/auth/logout', (req, res) => {
  clearAuthCookie(res, req);
  return res.json({ ok: true });
});

authRoutes.get('/auth/me', requireAuth, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const salaryReceiveDay = await getSalaryReceiveDay(userId);
  return res.json({
    user: {
      ...req.user,
      salaryReceiveDay,
    },
  });
});

authRoutes.patch('/auth/me', requireAuth, async (req, res) => {
  try {
    const { name, salary, notes, salaryReceiveDay } = req.body as {
      name?: string;
      salary?: number | string;
      notes?: string | null;
      salaryReceiveDay?: number | string | null;
    };

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'Nome não pode ser vazio' });
    }

    let salaryValue: number | undefined;
    if (salary !== undefined) {
      salaryValue = typeof salary === 'string' ? Number(salary) : salary;
      if (!Number.isFinite(salaryValue) || salaryValue < 0) {
        return res.status(400).json({ error: 'Salário inválido' });
      }
    }

    let receiveDayValue: number | null | undefined;
    if (salaryReceiveDay !== undefined) {
      try {
        receiveDayValue = parseReceiveDay(salaryReceiveDay);
      } catch {
        return res.status(400).json({
          error: 'Dia de recebimento do salário inválido (1-31)',
        });
      }
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const user = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(salaryValue !== undefined ? { salary: salaryValue } : {}),
          ...(notes !== undefined
            ? { notes: notes?.trim() ? notes.trim() : null }
            : {}),
        },
      });

      const shouldSyncSalaryEntry =
        salaryValue !== undefined || receiveDayValue !== undefined;

      if (shouldSyncSalaryEntry) {
        const salaryEntry = await tx.entry.findFirst({
          where: {
            userId,
            type: 'salario',
            frequency: 'mensal',
            name: 'Salário',
          },
        });

        const nextSalary =
          salaryValue !== undefined
            ? salaryValue
            : Number(updatedUser.salary);
        const nextReceiveDay =
          receiveDayValue !== undefined
            ? receiveDayValue
            : (salaryEntry?.receiveDay ?? null);

        if (nextSalary > 0) {
          if (nextReceiveDay == null) {
            throw new Error('MISSING_SALARY_RECEIVE_DAY');
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
                name: 'Salário',
                amount: nextSalary,
                type: 'salario',
                frequency: 'mensal',
                receiveDay: nextReceiveDay,
                endsAt: null,
              },
            });
          }
        } else if (salaryEntry) {
          await tx.entry.delete({ where: { id: salaryEntry.id } });
        }
      }

      return updatedUser;
    });

    const nextSalaryReceiveDay = await getSalaryReceiveDay(userId);
    return res.json({ user: toPublicUser(user, nextSalaryReceiveDay) });
  } catch (error) {
    if (error instanceof Error && error.message === 'MISSING_SALARY_RECEIVE_DAY') {
      return res.status(400).json({
        error: 'Informe o dia em que recebe o salário (1-31)',
      });
    }
    console.error(error);
    return res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
});

export default authRoutes;
