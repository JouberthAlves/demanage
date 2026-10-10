import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

import '@/config/env';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('[deManage] Missing required env: DATABASE_URL');
}

const adapter = new PrismaPg({
  connectionString,
  connectionTimeoutMillis: 5_000,
});

export const prisma = new PrismaClient({ adapter });
