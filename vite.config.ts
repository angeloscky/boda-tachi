import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `vite build --mode static` (o VITE_STATIC_DEMO=1) genera una maqueta estática sin API, solo para revisión visual.
export default defineConfig(({ mode }) => {
  const staticDemo = mode === 'static' || process.env.VITE_STATIC_DEMO === '1';
  return {
    plugins: [react()],
    base: staticDemo ? './' : '/',
    define: staticDemo ? { 'import.meta.env.VITE_STATIC_DEMO': JSON.stringify('1') } : {},
    build: { outDir: staticDemo ? 'dist/static-demo' : 'dist/client', emptyOutDir: true },
    server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  };
});
