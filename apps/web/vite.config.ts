import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  build: {
    rollupOptions: {
      // The app, the API explorer (Swagger UI), and the HR simulation used to demonstrate integrations.
      input: { main: page('index.html'), explorer: page('api-explorer.html'), demoHr: page('demo-hr.html') },
    },
  },
});
