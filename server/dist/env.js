import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const candidateEnvFiles = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'server/.env'),
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '../.env')
];

for (const envPath of candidateEnvFiles) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

dotenv.config();

if (process.env.NODE_ENV === 'production' && !(process.env.JWT_SECRET || '').trim()) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci360-realtime-production-fallback-secret-2026-key';
}
