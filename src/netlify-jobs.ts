/** The regular build connects directly to Fastify. The Netlify build uses short requests for longer work. */
export const isNetlifyClient = import.meta.env?.MODE === 'netlify';
const jobsPath = '/api/hosting/jobs';
const pollIntervalMs = 1_000;

export function usesHostedJob(method: string, path: string) {
  if (method === 'GET') return /^\/api\/healthchecks\/[^/?#]+\/pdf$/.test(path);
  return method === 'POST' && (
    path === '/api/healthchecks' || path === '/api/healthchecks/discover-buttons' ||
    /^\/api\/bugs\/[^/?#]+\/analyses$/.test(path)
  );
}

export function checkHostedApiResponse(response: Response) {
  const mediaType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml')
    throw new Error('The hosting service returned a web page for an API request. Check the ReleaseGate API connection.');
  return response;
}

function waitForNextPoll(signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, pollIntervalMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Submission happens once. All subsequent requests read the result of that exact job. */
export async function hostedJobResponse(path: string, options: RequestInit): Promise<Response> {
  const method = options.method ?? 'GET';
  if (!usesHostedJob(method, path)) throw new Error('This operation does not use a hosting job.');
  if (options.body != null && typeof options.body !== 'string') throw new Error('Expected a JSON request body.');
  const settings: RequestInit = { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: options.signal };
  const submitted = checkHostedApiResponse(await fetch(jobsPath, {
    ...settings, method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, ...(options.body != null && { body: JSON.parse(options.body) }) }),
  }));
  if (!submitted.ok) return submitted;
  if (submitted.status !== 202) throw new Error('ReleaseGate returned an unexpected job acknowledgement.');
  const ticket = await submitted.json().catch(() => null);
  if (typeof ticket?.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(ticket.id))
    throw new Error('ReleaseGate returned an invalid job reference.');
  const headers = new Headers(options.headers);
  headers.delete('Content-Type');
  const resultPath = jobsPath + '/' + ticket.id;
  for (;;) {
    const result = checkHostedApiResponse(await fetch(resultPath, { ...settings, method: 'GET', headers }));
    if (result.status !== 202) return result;
    await result.body?.cancel();
    await waitForNextPoll(options.signal);
  }
}
