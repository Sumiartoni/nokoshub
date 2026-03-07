import axios from 'axios';
import logger from './src/utils/logger';

async function remoteTrigger() {
    try {
        const res = await axios.post('https://likely-bette-ann-mkrrm-24e1aebd.koyeb.app/api/admin/sync', {}, {
            headers: {
                'x-admin-key': 'NokosHub2026_AdminKey!'
            },
            timeout: 60000 // Wait up to 60s
        });
        console.log("SUCCESS:", JSON.stringify(res.data, null, 2));
    } catch (err: any) {
        console.error("ERROR:");
        if (err.response) {
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err.message);
        }
    }
}

remoteTrigger();
