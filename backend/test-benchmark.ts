import { prisma } from './src/database/prisma.client';
import { serviceService } from './src/modules/services/service.service';
import logger from './src/utils/logger';

async function runBenchmark() {
    logger.info("Starting local sync benchmark to replicate Koyeb hang...");
    const startTime = Date.now();
    try {
        const res = await serviceService.syncFromProvider();
        const duration = (Date.now() - startTime) / 1000;
        logger.info(`Done in ${duration}s. Result: ${JSON.stringify(res)}`);
    } catch (e: any) {
        logger.error({ err: e }, "Benchmark failed");
    } finally {
        await prisma.$disconnect();
    }
}

runBenchmark().catch(console.error);
