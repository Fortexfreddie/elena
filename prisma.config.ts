import { defineConfig } from 'prisma/config';
import 'dotenv/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Prisma CLI (prisma generate/migrate/db push) uses this URL.
    // In .env.example, we define SUPABASE_DATABASE_URL (which maps to the direct worker URL)
    // for use with the CLI.
    url: process.env['SUPABASE_DATABASE_URL'],
  },
});