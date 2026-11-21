import { pathToFileURL } from 'node:url';
import { buildApp } from './app';
export { buildApp };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildApp();
  const address = await app.listen({
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 4310),
  });
  console.log('ReleaseGate is ready at ' + address);
  process.once('SIGTERM', () => {
    void app.close();
  });
  process.once('SIGINT', () => {
    void app.close();
  });
}
