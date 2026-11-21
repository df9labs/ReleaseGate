import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const port = process.env.PORT || loadEnv(mode, process.cwd(), 'PORT').PORT || '4310';
  return {
    plugins: [react()],
    build: { outDir: 'dist/client' },
    server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:' + port } },
  };
});
