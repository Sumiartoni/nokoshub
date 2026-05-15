import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function remoteTrigger() {
    const baseUrl = process.env.REMOTE_SYNC_URL;
    const adminApiKey = process.env.ADMIN_API_KEY;

    if (!baseUrl || !adminApiKey) {
        throw new Error('Isi REMOTE_SYNC_URL dan ADMIN_API_KEY di environment sebelum menjalankan test-remote.ts');
    }

    try {
        const res = await axios.post(baseUrl, {}, {
            headers: {
                'x-admin-key': adminApiKey
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
