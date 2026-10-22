import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'electron-updater', 'js-yaml'], sourcemap: true });
await build({ entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true });
await build({ entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome136', sourcemap: true });
for (const file of ['index.html', 'styles.css']) await copyFile(`src/renderer/${file}`, `dist/${file}`);
console.log('Built Tangent desktop shell.');
