import { createHash, randomUUID } from 'node:crypto';

export type Fields = Record<string, unknown>;
export const uid = randomUUID;
export const now = () => new Date().toISOString();
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class HttpError extends Error {
  readonly statusCode: number;
  constructor(code: number, message: string) {
    super(message);
    this.statusCode = code;
  }
}

export function ensure(ok: unknown, status: number, message: string): asserts ok {
  if (!ok) throw new HttpError(status, message);
}

export function fields(input: unknown): Fields {
  ensure(input && typeof input === 'object' && !Array.isArray(input), 400, 'Expected a JSON object.');
  return input as Fields;
}

export function textField(obj: Fields, key: string, required = false, maximum = 16_000) {
  const raw = obj[key];
  if (raw === undefined && !required) return '';
  ensure(
    typeof raw === 'string' && raw.length <= maximum,
    422,
    `Invalid ${key} (maximum ${maximum} characters).`,
  );
  const value = raw.trim();
  ensure(!required || value, 422, `Enter ${key.replaceAll('_', ' ')}.`);
  return value;
}

export function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  ensure(
    options.some((option) => option === value),
    422,
    `Choose a valid ${label}.`,
  );
  return value as T;
}

export function strings(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  ensure(
    Array.isArray(value) && value.every((v) => typeof v === 'string' && v.length <= 16_000),
    422,
    `Invalid ${label}.`,
  );
  return value.map((v) => v.trim()).filter(Boolean);
}

export function httpUrl(value: string) {
  if (!value) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(422, 'Enter an absolute HTTP or HTTPS URL.');
  }
  ensure(
    ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password,
    422,
    'Enter an HTTP or HTTPS URL without credentials.',
  );
  return value;
}
