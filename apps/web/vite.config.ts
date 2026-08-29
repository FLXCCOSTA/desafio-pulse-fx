import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Em desenvolvimento a API responde noutra porta. O proxy mantém a mesma
    // origem para o navegador, o que faz o cookie de sessão funcionar sem
    // afrouxar SameSite — afrouxar seria trocar segurança por conveniência.
    proxy: {
      '/api': { target: 'http://localhost:3333', changeOrigin: false },
    },
  },
  build: {
    sourcemap: true,
    // Aviso já em 500 kB: um painel de sete cards não tem motivo para crescer.
    chunkSizeWarningLimit: 500,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
  },
});
