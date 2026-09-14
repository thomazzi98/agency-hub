import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.VITE_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    // Proxying keeps the session cookie same-origin in development, exactly as it
    // is in production behind Caddy — so no CORS or SameSite special-casing.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
