import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_STATIC_DEMO=1 genera una maqueta estática sin API (solo para revisión visual).
const staticDemo = process.env.VITE_STATIC_DEMO === '1';

export default defineConfig({
  plugins: [react()],
  base: staticDemo ? './' : '/',
  build: { outDir: staticDemo ? 'dist/static-demo' : 'dist/client', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
