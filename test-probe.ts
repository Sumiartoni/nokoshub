import axios from 'axios';
import { config } from './src/app/config';

async function probe() {
    const key = config.HERO_SMS_API_KEY;
    const targets = [
        { name: 'Bearer Auth, /services', url: `${config.HERO_SMS_BASE_URL}/services`, headers: { Authorization: `Bearer ${key}` } },
        { name: 'X-API-Key Auth, /services', url: `${config.HERO_SMS_BASE_URL}/services`, headers: { 'X-API-Key': key } },
        { name: 'Query Auth, /services', url: `${config.HERO_SMS_BASE_URL}/services?api_key=${key}`, headers: {} },
        { name: 'Query Auth, /balance', url: `${config.HERO_SMS_BASE_URL}/balance?api_key=${key}`, headers: {} }
    ];

    for (const t of targets) {
        try {
            console.log(`\nTesting: ${t.name}`);
            const res = await axios.get(t.url, { headers: t.headers, timeout: 5000 });
            console.log(`STATUS: ${res.status}`);
            const dataStr = JSON.stringify(res.data).substring(0, 150);
            console.log(`DATA: ${dataStr}...`);
        } catch (err: any) {
            console.log(`ERROR: ${err.response?.status} - ${err.message}`);
        }
    }
}

probe().catch(console.error);
