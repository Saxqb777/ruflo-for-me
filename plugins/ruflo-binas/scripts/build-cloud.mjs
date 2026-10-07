// Vercel build: copy the static floor (web/, demo/) into dist-cloud/ with the page at its root.
// The api/ functions deploy on their own; this only shapes the static output.
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-cloud');
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'web'), join(OUT, 'web'), { recursive: true });
cpSync(join(ROOT, 'demo'), join(OUT, 'demo'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), readFileSync(join(ROOT, 'web', 'index.html'), 'utf8'));
writeFileSync(join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /api/\n');
process.stdout.write(`built dist-cloud (web, demo, index.html)\n`);
