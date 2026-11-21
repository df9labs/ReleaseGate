import type { AppEnvironment } from './accounts';

export type Mail = { to: string; subject: string; text: string };
export type SendMail = (mail: Mail) => Promise<void>;

/** Sends through Resend when RESEND_API_KEY and MAIL_FROM are set. Returns undefined when mail is off. */
export function mailer(env: AppEnvironment, fetcher: typeof fetch = fetch): SendMail | undefined {
  const key = env.RESEND_API_KEY, from = env.MAIL_FROM;
  if (!key || !from) return undefined;
  return async ({ to, subject, text }) => {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Email delivery failed with status ' + response.status + '.');
  };
}
