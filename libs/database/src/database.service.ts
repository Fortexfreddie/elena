import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;

/**
 * PrismaClient singleton for NestJS (Prisma 7 Adapter Pattern).
 * Resolves the correct database URL based on PROCESS_TYPE:
 *   web    → SUPABASE_WEB_URL  (Transaction Pooler, port 6543, connection_limit=1)
 *   worker → SUPABASE_WORKER_URL (Direct, port 5432, connection_limit=5)
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly serviceLogger = new Logger(PrismaService.name);
    private pool: pg.Pool;

    constructor() {
        const processType = process.env['PROCESS_TYPE'] ?? 'web';
        const databaseUrl =
            processType === 'worker'
                ? process.env['SUPABASE_WORKER_URL']
                : process.env['SUPABASE_WEB_URL'];

        if (!databaseUrl) {
            throw new Error(
                `Database URL not set for PROCESS_TYPE=${processType}. ` +
                `Expected ${processType === 'worker' ? 'SUPABASE_WORKER_URL' : 'SUPABASE_WEB_URL'}`,
            );
        }

        // Prisma 7 requires a driver adapter for relational databases.
        const pool = new Pool({ connectionString: databaseUrl });
        const adapter = new PrismaPg(pool as any);

        super({ adapter });
        this.pool = pool;

        this.serviceLogger.log(
            `PrismaService initialized with pg adapter for PROCESS_TYPE=${processType}`,
        );
    }

    async onModuleInit(): Promise<void> {
        await this.$connect();
        this.serviceLogger.log('Connected to database via pg adapter');
    }

    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
        await this.pool.end();
        this.serviceLogger.log('Disconnected from database');
    }
}
