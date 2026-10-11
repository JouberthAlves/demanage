import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createApp } from '@/app';
import { AUTH_COOKIE_NAME, signAuthToken } from '@/lib/auth';
import { nextClosingOnOrAfter } from '@/lib/billing/calendar';
import { todayInSaoPaulo } from '@/lib/card-billing';
import { addDaysToKey, dayKeyOfDate, weekdayOfKey } from '@/lib/civil-date';
import {
  ExpenseSplitError,
  getCommittedByCard,
  replaceExpenseSplits,
  resolveAndValidateSplits,
} from '@/lib/expense-splits';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

async function createUser(name: string) {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replaceAll(' ', '-')}-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });
}

async function cleanupUser(userId: string) {
  const [expenses, entries] = await Promise.all([
    prisma.expense.findMany({ where: { userId }, select: { id: true } }),
    prisma.entry.findMany({ where: { userId }, select: { id: true } }),
  ]);
  const expenseIds = expenses.map(({ id }) => id);
  const entryIds = entries.map(({ id }) => id);

  await prisma.expensePayment.deleteMany({
    where: { expenseId: { in: expenseIds } },
  });
  await prisma.entryReceipt.deleteMany({
    where: { entryId: { in: entryIds } },
  });
  await prisma.expenseSplit.deleteMany({
    where: { expenseId: { in: expenseIds } },
  });
  await prisma.assetTransaction.deleteMany({ where: { userId } });
  await prisma.piggyTransaction.deleteMany({ where: { userId } });
  await prisma.expense.deleteMany({ where: { userId } });
  await prisma.entry.deleteMany({ where: { userId } });
  await prisma.card.deleteMany({ where: { userId } });
  await prisma.piggyBank.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

async function startApi(userId: string) {
  const app = createApp({ logRequests: false });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const cookie = `${AUTH_COOKIE_NAME}=${signAuthToken(userId, 0)}`;

  return {
    origin,
    cookie,
    async request(
      path: string,
      method: string,
      body?: unknown,
      requestOrigin = origin,
    ) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
          Cookie: cookie,
          Origin: requestOrigin,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data =
        response.status === 204 ? null : ((await response.json()) as unknown);
      return { response, data };
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test('invoice settlement is authorized, idempotent, immutable, and cannot be deleted', async () => {
  const user = await createUser('Invoice settlement test');
  const invoice = await prisma.expense.create({
    data: {
      userId: user.id,
      name: 'Card invoice',
      amount: 125.5,
      category: 'outro',
      frequency: 'unica',
      isInvoice: true,
      occurredAt: new Date('2026-09-30T12:00:00.000Z'),
      billingPeriodStart: new Date('2026-09-01T12:00:00.000Z'),
      billingPeriodEnd: new Date('2026-09-30T12:00:00.000Z'),
    },
  });
  const api = await startApi(user.id);

  try {
    const crossSite = await api.request(
      `/expenses/${invoice.id}/pay`,
      'POST',
      { month: '2026-09' },
      'https://attacker.invalid',
    );
    assert.equal(crossSite.response.status, 403);
    assert.equal(
      await prisma.expensePayment.count({ where: { expenseId: invoice.id } }),
      0,
    );

    const wrongCycle = await api.request(
      `/expenses/${invoice.id}/pay`,
      'POST',
      { month: '2026-08' },
    );
    assert.equal(wrongCycle.response.status, 400);

    const first = await api.request(`/expenses/${invoice.id}/pay`, 'POST', {
      month: '2026-09',
    });
    const second = await api.request(`/expenses/${invoice.id}/pay`, 'POST', {
      month: '2026-09',
    });
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    assert.equal((first.data as { payments: unknown[] }).payments.length, 1);
    assert.equal((second.data as { payments: unknown[] }).payments.length, 1);

    const payment = await prisma.expensePayment.findUniqueOrThrow({
      where: { expenseId_month: { expenseId: invoice.id, month: '2026-09' } },
    });
    assert.equal(Number(payment.amount), 125.5);
    assert.equal(
      (second.data as { payments: Array<{ paidAt: string }> }).payments[0]
        .paidAt,
      payment.paidAt.toISOString(),
    );

    const editInvoice = await api.request(`/expenses/${invoice.id}`, 'PATCH', {
      amount: 1,
    });
    assert.equal(editInvoice.response.status, 400);

    // Faturas não podem ser editadas nem excluídas pela rota genérica.
    const archive = await api.request(`/expenses/${invoice.id}`, 'DELETE');
    assert.equal(archive.response.status, 400);
    const kept = await prisma.expense.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { payments: true },
    });
    assert.equal(kept.archivedAt, null);
    assert.equal(kept.payments.length, 1);
  } finally {
    await api.close();
    await cleanupUser(user.id);
  }
});

test('archiving a card preserves mixed expense splits and closes its card share', async () => {
  const user = await createUser('Card archive test');
  const today = todayInSaoPaulo();
  const card = await prisma.card.create({
    data: {
      userId: user.id,
      name: 'Mixed purchase card',
      closingDay: 31,
      createdAt: today,
    },
  });
  const expense = await prisma.expense.create({
    data: {
      userId: user.id,
      name: 'Mixed purchase',
      amount: 100,
      category: 'outro',
      frequency: 'unica',
      occurredAt: today,
    },
  });
  await prisma.expenseSplit.createMany({
    data: [
      {
        expenseId: expense.id,
        kind: 'card',
        cardId: card.id,
        percent: 40,
        amount: 40,
      },
      {
        expenseId: expense.id,
        kind: 'pix',
        cardId: null,
        percent: 60,
        amount: 60,
      },
    ],
  });
  const api = await startApi(user.id);

  try {
    const response = await api.request(`/cards/${card.id}`, 'DELETE');
    assert.equal(response.response.status, 200);

    const [archivedCard, preservedExpense, invoice] = await Promise.all([
      prisma.card.findUniqueOrThrow({ where: { id: card.id } }),
      prisma.expense.findUniqueOrThrow({
        where: { id: expense.id },
        include: { splits: true },
      }),
      prisma.expense.findFirstOrThrow({
        where: { userId: user.id, isInvoice: true },
      }),
    ]);
    assert.ok(archivedCard.archivedAt);
    assert.equal(preservedExpense.archivedAt, null);
    assert.equal(preservedExpense.splits.length, 2);
    assert.equal(Number(invoice.amount), 40);
  } finally {
    await api.close();
    await cleanupUser(user.id);
  }
});

test('archiving a card closes a late purchase from the already invoiced cycle', async () => {
  const user = await createUser('Late card archive test');
  const today = todayInSaoPaulo();
  const closedThrough = new Date(today);
  closedThrough.setUTCDate(closedThrough.getUTCDate() - 1);
  const processedAt = new Date(closedThrough.getTime() + 1_000);
  const createdAt = new Date(processedAt.getTime() + 1_000);
  const card = await prisma.card.create({
    data: {
      userId: user.id,
      name: 'Late purchase card',
      closingDay: 5,
      lastInvoicedOn: closedThrough,
      lastBillingProcessedAt: processedAt,
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
    },
  });
  await prisma.expense.create({
    data: {
      userId: user.id,
      cardId: card.id,
      name: 'Late purchase',
      amount: 80,
      category: 'outro',
      frequency: 'unica',
      occurredAt: closedThrough,
      createdAt,
    },
  });
  const api = await startApi(user.id);

  try {
    const response = await api.request(`/cards/${card.id}`, 'DELETE');
    assert.equal(response.response.status, 200);
    const invoice = await prisma.expense.findFirstOrThrow({
      where: { userId: user.id, isInvoice: true },
    });
    assert.equal(Number(invoice.amount), 80);
    assert.match(invoice.notes ?? '', /compras retroativas/);
  } finally {
    await api.close();
    await cleanupUser(user.id);
  }
});

test('write lock prevents concurrent card purchases from exceeding the limit', async () => {
  const user = await createUser('Card limit race test');
  const card = await prisma.card.create({
    data: {
      userId: user.id,
      name: 'Limited card',
      limit: 100,
      closingDay: 31,
    },
  });
  const today = todayInSaoPaulo();

  try {
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        withUserWriteLockTransaction(user.id, async (tx) => {
          const resolved = await resolveAndValidateSplits({
            userId: user.id,
            totalAmount: 60,
            splits: [{ kind: 'card', cardId: card.id, percent: 100 }],
            cardId: undefined,
            frequency: 'unica',
            tx,
          });
          // A purchase dated today always lands in the card's open cycle,
          // whatever day of the month the test runs on.
          const created = await tx.expense.create({
            data: {
              userId: user.id,
              name: 'Card purchase',
              amount: 60,
              category: 'outro',
              frequency: 'unica',
              occurredAt: today,
              cardId: card.id,
            },
          });
          await replaceExpenseSplits({
            tx,
            expenseId: created.id,
            resolved,
          });
          return created.id;
        }),
      ),
    );

    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    assert.ok(rejection);
    assert.ok(rejection.reason instanceof ExpenseSplitError);
    assert.equal(
      await prisma.expense.count({
        where: { userId: user.id, isInvoice: false },
      }),
      1,
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('card commitment releases closed one-offs and ended schedules and reserves each weekly occurrence left in the cycle', async () => {
  const user = await createUser('Card commitment test');
  const today = todayInSaoPaulo();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const startsAt = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12),
  );
  const card = await prisma.card.create({
    data: {
      userId: user.id,
      name: 'Commitment card',
      limit: 500,
      closingDay: 31,
      lastInvoicedOn: today,
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
    },
  });

  try {
    await prisma.expense.createMany({
      data: [
        {
          userId: user.id,
          cardId: card.id,
          name: 'Already closed purchase',
          amount: 80,
          category: 'outro',
          frequency: 'unica',
          occurredAt: today,
          createdAt: new Date(Date.now() - 60_000),
        },
        {
          userId: user.id,
          cardId: card.id,
          name: 'Active weekly charge',
          amount: 25,
          category: 'outro',
          frequency: 'semanal',
          dueDay: 1,
          startsAt,
        },
        {
          userId: user.id,
          cardId: card.id,
          name: 'Ended subscription',
          amount: 90,
          category: 'outro',
          frequency: 'mensal',
          dueDay: 1,
          startsAt,
          endsAt: yesterday,
        },
        {
          userId: user.id,
          cardId: card.id,
          name: 'Historical invoice',
          amount: 100,
          category: 'outro',
          frequency: 'unica',
          isInvoice: true,
          occurredAt: today,
        },
      ],
    });

    // Expected weekly reservation, counted independently: every day after the
    // last closing (exclusive) up to the next one that falls on the weekday
    // of startsAt.
    const todayKey = dayKeyOfDate(today);
    const closingKey = nextClosingOnOrAfter(31, todayKey, todayKey);
    const startsWeekday = weekdayOfKey(dayKeyOfDate(startsAt));
    let weeklyCount = 0;
    for (
      let key = addDaysToKey(todayKey, 1);
      key <= closingKey;
      key = addDaysToKey(key, 1)
    ) {
      if (weekdayOfKey(key) === startsWeekday) weeklyCount += 1;
    }

    const committed = await getCommittedByCard({ userId: user.id });
    assert.equal(committed.get(card.id), 25 * weeklyCount);
  } finally {
    await cleanupUser(user.id);
  }
});

test('late one-offs reserve card limit for the next cycle', async () => {
  const user = await createUser('Late card limit test');
  const today = todayInSaoPaulo();
  const closedThrough = new Date(today);
  closedThrough.setUTCDate(closedThrough.getUTCDate() - 1);
  const processedAt = new Date(closedThrough.getTime() + 1_000);
  const card = await prisma.card.create({
    data: {
      userId: user.id,
      name: 'Late limit card',
      limit: 100,
      closingDay: 5,
      lastInvoicedOn: closedThrough,
      lastBillingProcessedAt: processedAt,
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
    },
  });

  try {
    await prisma.expense.create({
      data: {
        userId: user.id,
        cardId: card.id,
        name: 'Late purchase',
        amount: 80,
        category: 'outro',
        frequency: 'unica',
        occurredAt: closedThrough,
        createdAt: new Date(processedAt.getTime() + 1_000),
      },
    });

    const committed = await getCommittedByCard({ userId: user.id });
    assert.equal(committed.get(card.id), 80);

    // GET /cards exposes the same commitment (single source of truth).
    const api = await startApi(user.id);
    try {
      const listed = await api.request('/cards', 'GET');
      assert.equal(listed.response.status, 200);
      const apiCard = (
        listed.data as Array<{
          id: string;
          committed: number;
          available: number | null;
        }>
      ).find((item) => item.id === card.id);
      assert.equal(apiCard?.committed, 80);
      assert.equal(apiCard?.available, 20);
    } finally {
      await api.close();
    }

    // A weekly R$30 would charge up to R$150 per cycle: rejected even though a
    // single R$30 occurrence is above the R$20 left anyway; R$4 x 5 = 20 fits.
    await assert.rejects(
      () =>
        withUserWriteLockTransaction(user.id, (tx) =>
          resolveAndValidateSplits({
            userId: user.id,
            totalAmount: 4.01,
            splits: [{ kind: 'card', cardId: card.id, percent: 100 }],
            cardId: undefined,
            frequency: 'semanal',
            tx,
          }),
        ),
      ExpenseSplitError,
    );
    await withUserWriteLockTransaction(user.id, (tx) =>
      resolveAndValidateSplits({
        userId: user.id,
        totalAmount: 4,
        splits: [{ kind: 'card', cardId: card.id, percent: 100 }],
        cardId: undefined,
        frequency: 'semanal',
        tx,
      }),
    );
    await assert.rejects(
      () =>
        withUserWriteLockTransaction(user.id, (tx) =>
          resolveAndValidateSplits({
            userId: user.id,
            totalAmount: 80,
            splits: [{ kind: 'card', cardId: card.id, percent: 100 }],
            cardId: undefined,
            frequency: 'unica',
            tx,
          }),
        ),
      ExpenseSplitError,
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('generic ledger routes archive manual templates and reject internal mutations', async () => {
  const user = await createUser('Ledger immutability test');
  const expense = await prisma.expense.create({
    data: {
      userId: user.id,
      name: 'Paid monthly expense',
      amount: 99,
      category: 'outro',
      frequency: 'mensal',
      dueDay: 1,
    },
  });
  await prisma.expensePayment.create({
    data: {
      expenseId: expense.id,
      month: '2026-09',
      amount: 42,
      paidAt: new Date('2026-09-10T12:00:00.000Z'),
    },
  });
  const entry = await prisma.entry.create({
    data: {
      userId: user.id,
      name: 'Received freelance income',
      amount: 300,
      type: 'freelance',
      frequency: 'mensal',
    },
  });
  await prisma.entryReceipt.create({
    data: {
      entryId: entry.id,
      month: '2026-09',
      amount: 250,
      receivedAt: new Date('2026-09-12T12:00:00.000Z'),
    },
  });
  const systemExpense = await prisma.expense.create({
    data: {
      userId: user.id,
      name: 'Internal asset purchase',
      amount: 10,
      category: 'investimento',
      frequency: 'unica',
      occurredAt: todayInSaoPaulo(),
      systemOrigin: 'asset',
    },
  });
  const systemEntry = await prisma.entry.create({
    data: {
      userId: user.id,
      name: 'Internal asset sale',
      amount: 10,
      type: 'outro',
      frequency: 'unica',
      systemOrigin: 'asset',
    },
  });
  const api = await startApi(user.id);

  try {
    assert.equal(
      (await api.request(`/expenses/${expense.id}`, 'DELETE')).response.status,
      204,
    );
    assert.equal(
      (await api.request(`/entries/${entry.id}`, 'DELETE')).response.status,
      204,
    );
    assert.equal(
      (
        await api.request(`/expenses/${systemExpense.id}`, 'PATCH', {
          amount: 11,
        })
      ).response.status,
      400,
    );
    assert.equal(
      (await api.request(`/expenses/${systemExpense.id}`, 'DELETE')).response
        .status,
      400,
    );
    assert.equal(
      (
        await api.request(`/entries/${systemEntry.id}`, 'PATCH', {
          amount: 11,
        })
      ).response.status,
      400,
    );
    assert.equal(
      (await api.request(`/entries/${systemEntry.id}`, 'DELETE')).response
        .status,
      400,
    );

    const [archivedExpense, archivedEntry, untouchedExpense, untouchedEntry] =
      await Promise.all([
        prisma.expense.findUniqueOrThrow({
          where: { id: expense.id },
          include: { payments: true },
        }),
        prisma.entry.findUniqueOrThrow({
          where: { id: entry.id },
          include: { receipts: true },
        }),
        prisma.expense.findUniqueOrThrow({ where: { id: systemExpense.id } }),
        prisma.entry.findUniqueOrThrow({ where: { id: systemEntry.id } }),
      ]);
    assert.ok(archivedExpense.archivedAt);
    assert.equal(archivedExpense.payments.length, 1);
    assert.ok(archivedEntry.archivedAt);
    assert.equal(archivedEntry.receipts.length, 1);
    assert.equal(untouchedExpense.archivedAt, null);
    assert.equal(Number(untouchedExpense.amount), 10);
    assert.equal(untouchedEntry.archivedAt, null);
    assert.equal(Number(untouchedEntry.amount), 10);
  } finally {
    await api.close();
    await cleanupUser(user.id);
  }
});

test('salary accepts only Decimal(12,2) values and zero preserves receipt history', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Salary validation test',
      email: `salary-validation-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
      salary: 5_000,
    },
  });
  const salary = await prisma.entry.create({
    data: {
      userId: user.id,
      name: 'Salário',
      amount: 5_000,
      type: 'salario',
      frequency: 'mensal',
      receiveDay: 5,
    },
  });
  await prisma.entryReceipt.create({
    data: {
      entryId: salary.id,
      month: '2026-08',
      amount: 5_000,
      receivedAt: new Date('2026-08-05T12:00:00.000Z'),
    },
  });
  const api = await startApi(user.id);

  try {
    const invalid = await api.request('/auth/me', 'PATCH', {
      salary: '10000000000.00',
    });
    assert.equal(invalid.response.status, 400);

    const zero = await api.request('/auth/me', 'PATCH', { salary: 0 });
    assert.equal(zero.response.status, 200);
    const [updatedUser, updatedSalary] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.entry.findUniqueOrThrow({
        where: { id: salary.id },
        include: { receipts: true },
      }),
    ]);
    const today = todayInSaoPaulo();
    const lastActiveDay = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0, 12),
    );
    assert.equal(Number(updatedUser.salary), 0);
    assert.equal(Number(updatedSalary.amount), 0);
    assert.equal(
      updatedSalary.endsAt?.toISOString(),
      lastActiveDay.toISOString(),
    );
    assert.equal(updatedSalary.receipts.length, 1);
    assert.equal(Number(updatedSalary.receipts[0].amount), 5_000);
  } finally {
    await api.close();
    await cleanupUser(user.id);
  }
});

test('renaming a card expense without split rows keeps its card', async () => {
  const user = await createUser('Legacy card rename test');
  const card = await prisma.card.create({
    data: { userId: user.id, name: 'Legacy card', closingDay: 31 },
  });
  const expense = await prisma.expense.create({
    data: {
      userId: user.id,
      cardId: card.id,
      name: 'Legacy purchase',
      amount: 50,
      category: 'outro',
      frequency: 'unica',
      occurredAt: todayInSaoPaulo(),
    },
  });
  const api = await startApi(user.id);

  try {
    const rename = await api.request(`/expenses/${expense.id}`, 'PATCH', {
      name: 'Renamed purchase',
    });
    assert.equal(rename.response.status, 200);
    const stored = await prisma.expense.findUniqueOrThrow({
      where: { id: expense.id },
    });
    assert.equal(stored.name, 'Renamed purchase');
    assert.equal(stored.cardId, card.id);
  } finally {
    await api.close();
    await cleanupUser(user.id);
  }
});

test('http layer maps malformed input to 4xx and serializes entries consistently', async () => {
  const user = await createUser('Http errors test');
  const api = await startApi(user.id);

  try {
    const malformed = await fetch(`${api.origin}/entries`, {
      method: 'POST',
      headers: {
        Cookie: api.cookie,
        Origin: api.origin,
        'Content-Type': 'application/json',
      },
      body: '{not json',
    });
    assert.equal(malformed.status, 400);

    const tooLarge = await fetch(`${api.origin}/entries`, {
      method: 'POST',
      headers: {
        Cookie: api.cookie,
        Origin: api.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'x'.repeat(300_000) }),
    });
    assert.equal(tooLarge.status, 413);

    const noBody = await fetch(`${api.origin}/entries`, {
      method: 'POST',
      headers: { Cookie: api.cookie, Origin: api.origin },
    });
    assert.equal(noBody.status, 400);

    const created = await api.request('/entries', 'POST', {
      name: 'Freela',
      amount: '120.50',
      type: 'freelance',
      frequency: 'unica',
      date: '2026-01-15',
    });
    assert.equal(created.response.status, 201);
    const entry = created.data as { id: string; amount: unknown };
    assert.equal(entry.amount, 120.5);

    const patched = await api.request(`/entries/${entry.id}`, 'PATCH', {
      name: 'Freela renomeada',
    });
    assert.equal(patched.response.status, 200);
    assert.equal((patched.data as { amount: unknown }).amount, 120.5);

    const badRange = await api.request(
      '/market/history/BTC?from=2026-13-01&to=2026-13-02',
      'GET',
    );
    assert.equal(badRange.response.status, 400);
  } finally {
    await api.close();
    await cleanupUser(user.id);
  }
});

test('custom tags reject duplicates and unknown tags are a 400', async () => {
  const user = await createUser('Custom tag test');
  const api = await startApi(user.id);

  try {
    const first = await api.request('/custom-tags', 'POST', {
      scope: 'expense',
      name: 'Mercado',
      color: '#aabbcc',
    });
    assert.equal(first.response.status, 201);
    const duplicate = await api.request('/custom-tags', 'POST', {
      scope: 'expense',
      name: 'mercado',
      color: '#aabbcc',
    });
    assert.equal(duplicate.response.status, 409);

    const invalidTag = await api.request('/expenses', 'POST', {
      name: 'Compra',
      amount: 10,
      category: 'outro',
      frequency: 'mensal',
      dueDay: 5,
      startsAt: '2026-01-01',
      customTagId: randomUUID(),
    });
    assert.equal(invalidTag.response.status, 400);
  } finally {
    await api.close();
    await cleanupUser(user.id);
  }
});

test('piggy bank patch keeps stored monthly goal and rejects non-boolean flags', async () => {
  const user = await createUser('Piggy patch test');
  const bank = await prisma.piggyBank.create({
    data: {
      userId: user.id,
      name: 'Viagem',
      autoDebit: true,
      autoDebitDay: 5,
      monthlyGoal: 150,
    },
  });
  const api = await startApi(user.id);

  try {
    const rename = await api.request(`/piggy-banks/${bank.id}`, 'PATCH', {
      name: 'Viagem 2027',
    });
    assert.equal(rename.response.status, 200);
    assert.equal((rename.data as { monthlyGoal: number }).monthlyGoal, 150);

    const invalidFlag = await api.request(`/piggy-banks/${bank.id}`, 'PATCH', {
      autoDebit: 'nope',
    });
    assert.equal(invalidFlag.response.status, 400);
  } finally {
    await api.close();
    await prisma.piggyBank.deleteMany({ where: { userId: user.id } });
    await cleanupUser(user.id);
  }
});
