import { join } from 'node:path';
import { applyConfiguredAdminPassword } from '../server/apply-admin-password';

try {
  const { DATA_DIR, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } = process.env;
  if (!DATA_DIR || !DEMO_ADMIN_EMAIL || !DEMO_ADMIN_PASSWORD)
    throw new Error('Use the ReleaseGate Compose app service with DATA_DIR, DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD set.');
  const result = await applyConfiguredAdminPassword(join(DATA_DIR, 'releasegate.sqlite'), DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD);
  console.log(result === 'updated'
    ? 'Administrator password updated. Previous sessions for this account have been signed out.'
    : 'The configured password already matches the saved administrator login.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to update the administrator login.');
  process.exitCode = 1;
}
