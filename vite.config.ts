import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  server: {
    host: true,
    port: Number(process.env.VITE_PORT ?? 5173),
    // NO_HMR=1 : pas de rechargement automatique (tests automatisés)
    hmr: process.env.NO_HMR ? false : undefined,
    proxy: {
      '/socket.io': {
        target: `http://localhost:${SERVER_PORT}`,
        ws: true,
      },
    },
  },
  preview: {
    host: true,
  },
});
