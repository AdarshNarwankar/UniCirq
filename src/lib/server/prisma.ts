import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { pool } from './db';

const clients = globalThis as unknown as { unicirqAuthPrisma?: PrismaClient };

// Share the restricted runtime pool; never construct this with the migration URL.
// Lazy initialization keeps builds safe when hosted resources are not configured.
export function authPrisma() {
  return clients.unicirqAuthPrisma ??= new PrismaClient({
    adapter: new PrismaPg(pool()),
    log: [],
  });
}
