#!/usr/bin/env node
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSkinDir, resolveViteOrigin } from './skin-paths.mjs';

const root = process.cwd();
const skinDir = resolveSkinDir();
const viteOrigin = resolveViteOrigin();
const gatewayOrigin = (process.env.BEANIE_GATEWAY ?? process.env.DECENT_GATEWAY ?? '').replace(
  /\/$/,
  ''
);

await mkdir(skinDir, { recursive: true });
await copyFile(path.join(root, 'public', 'manifest.json'), path.join(skinDir, 'manifest.json'));
await writeFile(path.join(skinDir, 'index.html'), devShimHtml(viteOrigin, gatewayOrigin));

console.log(`ok - installed Beanie dev shim in ${skinDir}`);
console.log(`ok - Decent will load Vite modules from ${viteOrigin}`);
if (gatewayOrigin) console.log(`ok - window.BEANIE_GATEWAY=${gatewayOrigin}`);

function devShimHtml(origin, gateway) {
  const gatewayScript = gateway
    ? `    <script>window.BEANIE_GATEWAY = ${JSON.stringify(gateway)};</script>\n`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Beanie Dev</title>
${gatewayScript}    <script type="module" src="${origin}/@vite/client"></script>
    <script type="module" src="${origin}/src/main.ts"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;
}
