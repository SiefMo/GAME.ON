import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
export default defineConfig({
  base: process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/',
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          motion: ['framer-motion'],
          socket: ['socket.io-client']
        }
      }
    }
  },
  server: {
    host: true,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true, changeOrigin: true }
    }
  }
});
