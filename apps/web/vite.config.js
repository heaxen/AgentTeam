import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 开发时页面在 5173，接口在 packages/server 的 4317：/api 转发过去。
    // 生产构建由 packages/server 同源托管，不需要这个代理。
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setup-tests.js'],
    include: ['src/**/*.test.{js,jsx}'],
    passWithNoTests: true,
  },
});
