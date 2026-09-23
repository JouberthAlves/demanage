import { PrismaPg } from '@prisma/adapter-pg';

import '@/config/env';
import { PrismaClient } from '@/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('[deManage] Missing required env: DATABASE_URL');
}

const adapter = new PrismaPg({
  connectionString,
  connectionTimeoutMillis: 5_000,
});

export const prisma = new PrismaClient({ adapter });
