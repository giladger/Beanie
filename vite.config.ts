import { defineConfig } from 'vite';
import pkg from './package.json';

const env =
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

const gatewayHost = env.GATEWAY_HOST ?? 'localhost:8080';
const gitCommit = env.GIT_COMMIT ?? 'dev';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_COMMIT__: JSON.stringify(gitCommit),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  server: {
    cors: true,
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
  }
});
