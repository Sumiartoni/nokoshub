import crypto from 'node:crypto';

const password = process.argv[2];

if (!password) {
    console.error('Usage: ts-node src/scripts/hash-backoffice-password.ts <password>');
    process.exit(1);
}

const salt = crypto.randomBytes(16).toString('base64url');
const iterations = 210000;
const key = crypto
    .pbkdf2Sync(password, salt, iterations, 32, 'sha256')
    .toString('base64url');

console.log(`pbkdf2$sha256$${iterations}$${salt}$${key}`);
