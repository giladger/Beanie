import { defineConfig } from 'vite';
import pkg from './package.json';

const env =
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

const gatewayHost = env.GATEWAY_HOST ?? 'decent:8080';
const gitCommit = env.GIT_COMMIT ?? 'dev';
const requestedVitePort = Number(env.VITE_PORT ?? 5173);
const vitePort = Number.isInteger(requestedVitePort) && requestedVitePort > 0 && requestedVitePort <= 65535
  ? requestedVitePort
  : 5173;

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_COMMIT__: JSON.stringify(gitCommit),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  server: {
    // Keep the development server private unless the developer deliberately
    // chooses an explicit `*:lan` script for an on-device workflow.
    host: '127.0.0.1',
    port: vitePort,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${gatewayHost}`,
        changeOrigin: true
      },
      '/ws': {
        target: `ws://${gatewayHost}`,
        ws: true,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '127.0.0.1',
    strictPort: true
  }
});
