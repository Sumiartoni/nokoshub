import axios from 'axios';
import { config } from './src/app/config';

async function testV1() {
    console.log('Testing V1 API format...');
    // API Basic: https://www.rumahotp.com/api/
    // Endpoint: /service?api_key=...

    try {
        const url = `https://www.rumahotp.com/api/service?api_key=${config.RUMAHOTP_API_KEY}`;
        console.log(`Calling: ${url}`);
        const res = await axios.get(url);

        console.log(`STATUS: ${res.status}`);
        if (typeof res.data === 'string') {
            console.log(`DATA STRING: ${res.data.substring(0, 100)}...`);
        } else {
            console.log(`DATA TYPE: ${typeof res.data}`);
            console.log(`DATA LENGTH: ${Array.isArray(res.data) ? res.data.length : Object.keys(res.data).length}`);
            const sample = Array.isArray(res.data) ? res.data[0] : Object.values(res.data)[0];
            console.log(`SAMPLE:`, sample);
        }
    } catch (e: any) {
        console.error('ERROR:', e.message);
        if (e.response) {
            console.error('RESPONSE STATUS:', e.response.status);
            console.error('RESPONSE DATA:', typeof e.response.data === 'string' ? e.response.data.substring(0, 100) : e.response.data);
        }
    }
}

testV1().catch(console.error);
