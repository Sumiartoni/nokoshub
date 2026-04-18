import { serviceService } from './src/modules/services/service.service';
import { prisma } from './src/database/prisma.client';

async function testSync() {
    console.log('Testing full database sync...');
    try {
        const result = await serviceService.syncFromProvider();
        console.log('Sync Result:', result);

        const services = await prisma.service.findMany({ take: 5 });
        console.log('Services in DB:', services);

        const prices = await prisma.price.findMany({ take: 5 });
        console.log('Prices in DB:', prices);

    } catch (e) {
        console.error('Error during sync:', e);
    } finally {
        await prisma.$disconnect();
    }
}

testSync().catch(console.error);
