#!/usr/bin/env node
/** dist/ 의 내부 링크와 앵커가 실제로 존재하는지 확인합니다. node scripts/check-links.mjs */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

const htmlFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.html')) htmlFiles.push(p);
  }
})(dist);

const idsOf = new Map();
for (const f of htmlFiles) {
  const html = readFileSync(f, 'utf8');
  idsOf.set(f, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
}

let broken = 0;
for (const f of htmlFiles) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="(?!https?:|data:|mailto:|tel:)([^"]+)"/g)) {
    const raw = m[1];
    if (raw.startsWith('#')) {
      if (!idsOf.get(f).has(decodeURIComponent(raw.slice(1)))) {
        console.log(`  ✗ ${f.replace(dist, '')} → ${raw} (앵커 없음)`);
        broken += 1;
      }
      continue;
    }
    const [path, hash] = raw.split('#');
    const target = resolve(dirname(f), decodeURIComponent(path));
    if (!existsSync(target)) {
      console.log(`  ✗ ${f.replace(dist, '')} → ${raw} (파일 없음)`);
      broken += 1;
    } else if (hash && target.endsWith('.html')) {
      const ids = idsOf.get(target);
      if (ids && !ids.has(decodeURIComponent(hash))) {
        console.log(`  ✗ ${f.replace(dist, '')} → ${raw} (앵커 없음)`);
        broken += 1;
      }
    }
  }
}

console.log(
  broken
    ? `\n${broken}개 깨진 링크`
    : `내부 링크 정상 (HTML ${htmlFiles.length}개 검사)`,
);
process.exit(broken ? 1 : 0);
