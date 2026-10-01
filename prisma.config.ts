import { defineConfig } from 'prisma/config';

// Generation and builds do not require credentials or database access.
// Run database/migrations through db:migrate, not Prisma db push/migrate:
// this auth-only schema intentionally excludes the application's RLS tables.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(process.env.MIGRATION_DATABASE_URL
    ? { datasource: { url: process.env.MIGRATION_DATABASE_URL } }
    : {}),
});
