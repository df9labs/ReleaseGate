import type { FastifyInstance, FastifyRequest } from 'fastify';
import { cookieName } from './auth';
import { digest, ensure, fields, uid } from './support';

export const hostingJobLimits = {
  running: 4,
  runningPerSession: 2,
  tickets: 64,
  ticketsPerSession: 16,
  requestBytes: 128 * 1024,
  envelopeOverhead: 1024,
  resultBytes: 8 * 1024 * 1024,
  totalResultBytes: 32 * 1024 * 1024,
  retentionMs: 5 * 60_000,
} as const;

type Result = { status: number; bytes: Buffer; type: string; disposition?: string };
type Ticket = { session: string; result?: Result; expiry?: NodeJS.Timeout };
const unavailable: Result = {
  status: 503, type: 'application/json; charset=utf-8',
  bytes: Buffer.from(JSON.stringify({ message: 'The job result is unavailable. Check the saved records before starting another job.' })),
};

function jobInput(input: unknown) {
  const envelope = fields(input);
  ensure(Object.keys(envelope).every(key => ['method', 'path', 'body'].includes(key)), 422, 'Invalid job fields.');
  const { method, path, body } = envelope;
  ensure(typeof path === 'string' && (
    (method === 'POST' && (path === '/api/healthchecks' || path === '/api/healthchecks/discover-buttons' ||
      /^\/api\/bugs\/[\w-]{1,128}\/analyses$/.test(path))) ||
    (method === 'GET' && /^\/api\/healthchecks\/[\w-]{1,128}\/pdf$/.test(path))
  ), 422, 'This operation is unavailable as a background job.');
  ensure(body === undefined || method === 'POST', 422, 'A download job cannot have a request body.');
  const payload = body === undefined ? undefined : JSON.stringify(fields(body));
  ensure(!payload || Buffer.byteLength(payload) <= hostingJobLimits.requestBytes, 413, 'The job request is too large.');
  return { method, path, payload };
}

/** Keep long requests on the existing backend while the hosting proxy handles short polls. */
export function registerHostingJobs(app: FastifyInstance, requireUser: (req: FastifyRequest, admin: boolean | 'scan' | 'own') => unknown) {
  const tickets = new Map<string, Ticket>();
  const executing = new Set<Promise<void>>();

  function sessionKey(req: FastifyRequest) {
    // Each original operation repeats its own authorisation when the job runs.
    requireUser(req, 'own');
    return digest(req.cookies[cookieName]!);
  }

  app.post('/api/hosting/jobs', { bodyLimit: hostingJobLimits.requestBytes + hostingJobLimits.envelopeOverhead }, (req, reply) => {
    const session = sessionKey(req);
    const { method, path, payload } = jobInput(req.body);
    let ownTickets = 0, ownRunning = 0, running = 0, retainedBytes = 0;
    for (const item of tickets.values()) {
      if (item.session === session) {
        ownTickets++;
        if (!item.result) ownRunning++;
      }
      if (item.result) retainedBytes += item.result.bytes.length;
      else running++;
    }
    // Reserve the maximum result size before starting. A new job cannot evict a valid ticket.
    ensure(running < hostingJobLimits.running && ownRunning < hostingJobLimits.runningPerSession &&
      tickets.size < hostingJobLimits.tickets && ownTickets < hostingJobLimits.ticketsPerSession &&
      retainedBytes + (running + 1) * hostingJobLimits.resultBytes <= hostingJobLimits.totalResultBytes,
      429, 'Background jobs are at capacity. Try again after the current jobs or their download windows finish.');
    const id = uid();
    const ticket: Ticket = { session };
    tickets.set(id, ticket);
    const task = (async () => {
      try {
        const response = await app.inject({
          method, url: path, payload,
          cookies: { [cookieName]: req.cookies[cookieName]! },
          headers: {
            ...(req.headers.origin && { origin: req.headers.origin }),
            ...(req.headers.host && { host: req.headers.host }),
            ...(payload && { 'content-type': 'application/json' }),
          },
        });
        const disposition = response.headers['content-disposition'];
        ticket.result = response.rawPayload.length <= hostingJobLimits.resultBytes ? {
          status: response.statusCode,
          type: String(response.headers['content-type'] ?? 'application/octet-stream'),
          bytes: response.rawPayload,
          ...(typeof disposition === 'string' && { disposition }),
        } : unavailable;
      } catch {
        ticket.result = unavailable;
      }
      ticket.expiry = setTimeout(() => tickets.delete(id), hostingJobLimits.retentionMs);
      ticket.expiry.unref();
    })();
    executing.add(task);
    void task.finally(() => executing.delete(task));
    return reply.code(202).header('Cache-Control', 'no-store').send({ id });
  });

  app.get<{ Params: { id: string } }>('/api/hosting/jobs/:id', (req, reply) => {
    const session = sessionKey(req);
    const ticket = tickets.get(req.params.id);
    ensure(ticket && ticket.session === session, 404, 'This job is unavailable. Check the saved records before starting another job.');
    reply.header('Cache-Control', 'no-store');
    if (!ticket.result) return reply.code(202).send({ pending: true });
    const { status, type, bytes, disposition } = ticket.result;
    if (disposition) reply.header('Content-Disposition', disposition);
    return reply.code(status).type(type).send(bytes);
  });

  app.addHook('onClose', async () => {
    await Promise.all(executing);
    for (const ticket of tickets.values()) clearTimeout(ticket.expiry);
    tickets.clear();
  });
}
