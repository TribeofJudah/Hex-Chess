/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vitest is configured in-process (no separate vitest.config.ts) so the
// React plugin applies to .tsx tests as well. CI runs single-fork for
// deterministic output.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
    pool: 'forks',
    maxForks: 1,
  },
})
