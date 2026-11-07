import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { auditExtension } from './audit/extension'

function createBaseClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  return new PrismaClient({
    adapter,
    // The customer-portal password hash must never leak through `include: { retailer: true }` etc.
    // Code that needs it (portal login, staff credential management) must `select` it explicitly.
    omit: { retailer: { portalPasswordHash: true } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

type Client = ReturnType<typeof createBaseClient>

// Every write is audited (lib/audit/extension.ts). The extension adds no new API, so the exported type
// stays the plain client type that existing code (and `Prisma.TransactionClient` helpers) was written against.
function createClient(): Client {
  return createBaseClient().$extends(auditExtension) as unknown as Client
}

const globalForPrisma = globalThis as unknown as { prisma: Client }

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
