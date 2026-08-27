import { defineConfig } from 'vite';
import pkg from './package.json';

const env =
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

const gatewayHost = env.GATEWAY_HOST ?? 'decent:8080';
const gatewayHostname = gatewayHost.replace(/:\d+$/, '');
const gitCommit = env.GIT_COMMIT ?? 'dev';
const requestedVitePort = Number(env.VITE_PORT ?? 5173);
const vitePort = Number.isInteger(requestedVitePort) && requestedVitePort > 0 && requestedVitePort <= 65535
  ? requestedVitePort
  : 5173;
const loopbackDevOrigin = /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

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
    // Decent serves the dev shim from its own hostname while the shim loads
    // source modules from Vite. Keep Vite's loopback policy and allow only that
    // known cross-origin host instead of exposing source to arbitrary origins.
    // Decaid 0.8.2 serves each skin generation from a fresh random port (3000
    // only redirects there), so allow the gateway's hostname on any port.
    cors: {
      origin: [
        loopbackDevOrigin,
        new RegExp(`^https?://${gatewayHostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?::\\d+)?$`)
      ]
    },
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
