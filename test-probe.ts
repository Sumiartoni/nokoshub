import axios from 'axios';
import { config } from './src/app/config';

async function probe() {
    const key = config.RUMAHOTP_API_KEY;
    const targets = [
        { name: 'Header Auth, /services', url: 'https://www.rumahotp.com/api/services', headers: { 'x-apikey': key } },
        { name: 'Query Auth, /services', url: `https://www.rumahotp.com/api/services?api_key=${key}`, headers: {} },
        { name: 'Header Auth, /service', url: 'https://www.rumahotp.com/api/service', headers: { 'x-apikey': key } },
        { name: 'Query Auth, /service', url: `https://www.rumahotp.com/api/service?api_key=${key}`, headers: {} }
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
