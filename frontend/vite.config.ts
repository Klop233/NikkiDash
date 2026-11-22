import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'node:path';

export default defineConfig({
  plugins: [preact()],
  base: './',
  resolve: {
    alias: [
      { find: 'preact/jsx-dev-runtime', replacement: path.resolve(__dirname, 'node_modules/preact/jsx-runtime/dist/jsxRuntime.mjs') },
      { find: 'preact/jsx-runtime', replacement: path.resolve(__dirname, 'node_modules/preact/jsx-runtime/dist/jsxRuntime.mjs') },
      { find: 'preact/hooks', replacement: path.resolve(__dirname, 'node_modules/preact/hooks/dist/hooks.mjs') },
      { find: 'preact/test-utils', replacement: path.resolve(__dirname, 'node_modules/preact/test-utils/dist/testUtils.mjs') },
      { find: 'preact/compat', replacement: path.resolve(__dirname, 'node_modules/preact/compat/dist/compat.mjs') },
      { find: /^preact$/, replacement: path.resolve(__dirname, 'node_modules/preact/dist/preact.mjs') },
      { find: '@testing-library/preact', replacement: path.resolve(__dirname, 'node_modules/@testing-library/preact') }
    ]
  },
  build: {
    outDir: path.resolve(__dirname, '../package/nikki-dash/files/www/nikki-dash'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    assetsInlineLimit: 4096
  },
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(__dirname, '..')]
    },
    proxy: {
      '/ubus': {
        target: process.env.NIKKI_DASH_TARGET || 'http://127.0.0.1:18080',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'happy-dom',
    include: ['../tests/**/*.test.{ts,tsx}'],
    globals: true
  }
});
