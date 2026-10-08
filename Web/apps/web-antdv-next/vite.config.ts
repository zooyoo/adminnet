import { defineConfig } from '@vben/vite-config';
import { fileURLToPath } from 'node:url';

export default defineConfig(async () => {
  return {
    application: {
      vxeTableLazyImport: false,
    },
    vite: {
      build: {
        target: 'es2022',
        outDir: fileURLToPath(new URL('../../dist', import.meta.url)),
        emptyOutDir: true,
      },
      resolve: {
        // workspace 的不同 peer 依赖上下文必须共享同一套路由注入键。
        dedupe: ['vue-router'],
      },
      server: {
        proxy: {
          '/prod-api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/prod-api/, ''),
            target: 'http://localhost:5005',
            ws: true,
          },
        },
      },
    },
  };
});
