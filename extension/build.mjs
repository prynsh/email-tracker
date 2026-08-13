/**
 * esbuild script for the Gmail Email Tracker extension.
 * Compiles TypeScript → JS and copies static assets into dist/.
 *
 * Usage:
 *   node build.mjs          — single build
 *   node build.mjs --watch  — watch mode
 */

import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';

const watch = process.argv.includes('--watch');

// Clean dist/
if (existsSync('dist')) await rm('dist', { recursive: true });
await mkdir('dist/content', { recursive: true });
await mkdir('dist/popup', { recursive: true });

const sharedConfig = /** @type {import('esbuild').BuildOptions} */ ({
  bundle: true,
  target: 'chrome120',
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
});

const entryPoints = [
  {
    in: 'src/service-worker.ts',
    out: 'dist/service-worker',
  },
  {
    in: 'src/content/gmail-content.ts',
    out: 'dist/content/gmail-content',
  },
  {
    in: 'src/popup/popup.ts',
    out: 'dist/popup/popup',
  },
];

// Copy static public assets (manifest, HTML, CSS)
await cp('public', 'dist', { recursive: true });
console.log('✓ Copied public/ → dist/');

if (watch) {
  const ctx = await esbuild.context({
    ...sharedConfig,
    entryPoints: entryPoints.map((e) => ({ in: e.in, out: e.out })),
    outdir: '.',
    outExtension: { '.js': '.js' },
  });

  await ctx.watch();
  console.log('👀 Watching for changes…');
} else {
  await esbuild.build({
    ...sharedConfig,
    entryPoints: entryPoints.map((e) => ({ in: e.in, out: e.out })),
    outdir: '.',
    outExtension: { '.js': '.js' },
  });

  console.log('✅ Build complete → load the dist/ folder as an unpacked Chrome extension.');
}
