import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import type { AddressInfo } from 'node:net';
import { ensure, HttpError } from './support';

const runFile = promisify(execFile);
export const desktopPickerTimeoutMs = 15 * 60_000;
export const desktopReceiptLifetimeMs = 30 * 60_000;
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLocalDesktopRequest(req: FastifyRequest, listener: AddressInfo | string | null): boolean {
  if (!listener || typeof listener === 'string' || !loopback.has(listener.address)) return false;
  if (!loopback.has(req.raw.socket.remoteAddress ?? '')) return false;
  if (Object.keys(req.headers).some((key) => key === 'forwarded' || key === 'via' || key.startsWith('x-forwarded-'))) return false;
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(req.headers.host ?? '');
}

/** The browser supplies no path or command. Only the interactive Windows picker selects the target. */
export async function inspectWindowsApplication(signal: AbortSignal): Promise<unknown> {
  ensure(process.platform === 'win32', 422, 'Open ReleaseGate on your Windows PC to inspect a running desktop app.');
  const system = process.env.SystemRoot;
  ensure(system, 422, 'Windows PowerShell is unavailable on this installation.');
  const powershell = join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const inspector = resolve('scripts', 'inspect-windows-app.ps1');
  ensure(existsSync(powershell) && existsSync(inspector), 422, 'The Windows desktop inspector is missing from this installation.');
  // Only Windows desktop dependencies belong in the picker environment.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(?:SystemRoot|windir|SystemDrive|ComSpec|PATH|PATHEXT|USERPROFILE|HOMEDRIVE|HOMEPATH|LOCALAPPDATA|APPDATA|TEMP|TMP|ProgramFiles(?:\(x86\))?|ProgramW6432|ProgramData|SESSIONNAME|USERNAME|USERDOMAIN)$/i.test(key)));
  try {
    const { stdout } = await runFile(powershell, ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', inspector], {
      env, signal, windowsHide: true, timeout: desktopPickerTimeoutMs, maxBuffer: 256 * 1024, encoding: 'utf8',
    });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  } catch (err) {
    if (signal.aborted) throw new HttpError(409, 'The desktop inspection was cancelled.');
    if (err instanceof Error && 'killed' in err && err.killed)
      throw new HttpError(408, 'The desktop inspection timed out. Choose the application again.');
    if (err instanceof Error && 'code' in err && err.code === 1 && 'stdout' in err && typeof err.stdout === 'string') {
      // The bundled helper emits a fixed, user-facing JSON error for native picker failures.
      let failure: unknown;
      try { failure = JSON.parse(err.stdout.trim()).error; } catch { /* The helper did not start. */ }
      if (typeof failure === 'string' && failure.length > 0 && failure.length <= 256) throw new HttpError(422, failure);
    }
    throw new HttpError(422, 'The Windows inspector could not finish. Use the signed-in Windows desktop with the app open and try again.');
  }
}
