import { defineConfig } from 'prisma/config';

import 'dotenv/config';

// `prisma generate` and `prisma validate` never open a connection, so they must
// work without DATABASE_URL (CI and the Docker build run them without one).
// Commands that do connect (migrate, db *) read the URL here and Prisma reports
// a clear error when it is missing. Do not use env() here: it throws at load time.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
    // Used only by `migrate diff --from-migrations` (CI drift gate). Never the app DB.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
