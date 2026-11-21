import { randomUUID } from 'node:crypto';

const base = new URL(process.env.RELEASEGATE_BASE_URL || 'http://127.0.0.1:' + (process.env.PORT || 4310));
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
  !['http:', 'https:'].includes(base.protocol) ||
  base.username ||
  base.password
) {
  throw new Error('The demo sender requires a loopback ReleaseGate URL.');
}
let cookie = '';
const senderKey = process.env.DF9_INTAKE_KEY;
async function post(path, body, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    redirect: 'error',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('ReleaseGate returned HTTP ' + response.status + ' for ' + path);
  return response;
}
try {
  if (!senderKey) {
    if (!process.env.DEMO_ADMIN_PASSWORD)
      throw new Error('Start ReleaseGate with run.cmd or configure its local demo account first.');
    const login = await post('/api/auth/login', {
      email: process.env.DEMO_ADMIN_EMAIL || 'admin@releasegate.local',
      password: process.env.DEMO_ADMIN_PASSWORD,
    });
    cookie = (login.headers.getSetCookie()[0] || '').split(';')[0];
    if (!cookie) throw new Error('Local sign-in did not issue a session.');
  }
  const requestKey = process.env.DF9_DEMO_REQUEST_ID || randomUUID();
  const headers = { 'Idempotency-Key': requestKey };
  if (senderKey) headers.Authorization = 'Bearer ' + senderKey;
  const response = await post(
    '/api/reports',
    {
      title: 'Client card does not expand',
      description: 'A client card in the local preview stays collapsed after activation.',
      affected_module: 'Dashboard',
      environment: 'preview',
      severity: 'medium',
      expected_behavior: 'The selected card opens and its neighbour keeps its state.',
      actual_behavior: 'The card remains closed.',
      evidence: 'Local disclosure fixture, before activation and after activation.',
      source: 'local_demo_sender',
    },
    headers,
  );
  let { bug } = await response.json();
  if (cookie && bug.status === 'new')
    ({ bug } = await (await post('/api/bugs/' + encodeURIComponent(bug.id) + '/analyses', {})).json());
  console.log(
    bug.bug_number + ' · ' + bug.status + '\n' + new URL('/bugs/' + encodeURIComponent(bug.id), base).href,
  );
} finally {
  if (cookie) await post('/api/auth/logout', {});
}
