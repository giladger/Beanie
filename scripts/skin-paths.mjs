import os from 'node:os';
import path from 'node:path';

export const defaultSkinDir = path.join(
  os.homedir(),
  'Library/Containers/net.tadel.reaprime/Data/Documents/web-ui/beanie'
);

export function resolveSkinDir() {
  return process.env.DECENT_SKIN_DIR
    ? path.resolve(process.env.DECENT_SKIN_DIR)
    : defaultSkinDir;
}

export function resolveViteOrigin() {
  return (process.env.VITE_DEV_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
}
