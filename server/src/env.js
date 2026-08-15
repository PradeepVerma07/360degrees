import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });


if (process.env.NODE_ENV === 'production' && !(process.env.JWT_SECRET || '').trim())
  throw new Error('JWT_SECRET is required when NODE_ENV=production');
