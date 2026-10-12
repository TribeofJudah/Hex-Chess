/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vitest is configured in-process (no separate vitest.config.ts) so the
// React plugin applies to .tsx tests as well. CI runs single-fork for
// deterministic output.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Local multiplayer (t67): `npm run dev` proxies /room to `wrangler dev`,
  // so the same-host fallback in roomSocketUrl reaches the local worker.
  server: {
    proxy: {
      '/room': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
    pool: 'forks',
    maxWorkers: 1,
  },
})
