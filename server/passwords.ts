import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ensure } from './support';

const scrypt = promisify(scryptCallback);

export function passwordValue(value: unknown) {
  ensure(typeof value === 'string' && value.length >= 8 && value.length <= 128, 422,
    'Use a password between 8 and 128 characters.');
  return value;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const bytes = (await scrypt(password, salt, 64)) as Buffer;
  return salt + '.' + bytes.toString('hex');
}

export async function matchesPassword(password: string, stored: string) {
  const [salt, encoded] = stored.split('.');
  const bytes = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(bytes, Buffer.from(encoded, 'hex'));
}
