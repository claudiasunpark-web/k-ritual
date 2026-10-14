// Open Library에서 낱권의 짧은 줄거리(영문)와 주제(subject)를 가져와 data/book-info.json에 저장한다.
//
//   NODE_USE_ENV_PROXY=1 node scripts/fetch-book-info.ts [--limit 50]
//
// 시트와 따로 관리하는 보조 데이터라 시트를 다시 올릴 필요가 없다. 이미 받은 책은 건너뛰므로
// 중간에 멈춰도 다시 돌리면 남은 책부터 이어간다. 제목이 충분히 닮은 결과만 쓴다.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { BOOKS } from "../src/catalog/books.ts";
import type { BookInfo } from "../src/catalog/book-info.ts";

const FILE = new URL("../data/book-info.json", import.meta.url);
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const CONCURRENCY = 4;

const info: Record<string, BookInfo> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const todo = BOOKS.filter((b) => !b.isSeries && !(b.id in info)).slice(0, LIMIT);
console.log(`가져올 책 ${todo.length}권 (이미 ${Object.keys(info).length}권)`);

const words = (s: string) => s.toLowerCase().replace(/\(.*$/, "").match(/[a-z0-9]+/g) ?? [];
const STOP = new Set(["the", "a", "an", "and", "of"]);

function similarity(want: string, got: string): number {
  const w = new Set(words(want).filter((x) => !STOP.has(x)));
  const g = new Set(words(got));
  if (!w.size) return 0;
  return [...w].filter((x) => g.has(x)).length / w.size;
}

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "secret-book-club/0.1 (catalog enrichment)" } });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return null;
}

/** 설명 첫 문단만, 링크·출처 표기·다른 언어 설명은 뺀다 */
export function cleanSummary(raw: unknown): string | undefined {
  let text = typeof raw === "string" ? raw : (raw as { value?: string } | null)?.value;
  if (!text) return undefined;
  text = text.split(/\r?\n\s*(?:-{3,}|#{2,}|\*{3,})/)[0];
  text = text.split(/\r?\n\s*\r?\n/)[0];
  text = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[[^\]]*\]\[\d+\]/g, "")
    .replace(/\(\s*(?:source|from)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 20) return undefined;
  if (text.length > 280) {
    const cut = text.slice(0, 280);
    const end = cut.lastIndexOf(". ");
    text = end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
  }
  return text;
}

async function fetchOne(b: (typeof todo)[number]): Promise<BookInfo> {
  const q = new URLSearchParams({ title: b.title.replace(/\(.*$/, ""), author: b.author, fields: "key,title,subject", limit: "5" });
  const search = await getJson(`https://openlibrary.org/search.json?${q}`);
  const docs: { key: string; title: string; subject?: string[] }[] = search?.docs ?? [];
  const best = docs
    .map((d) => ({ d, s: similarity(b.title, d.title) }))
    .sort((x, y) => y.s - x.s)[0];
  if (!best || best.s < 0.6) return { found: false };
  const work = await getJson(`https://openlibrary.org${best.d.key}.json`);
  return {
    found: true,
    olKey: best.d.key,
    summary: cleanSummary(work?.description),
    subjects: (best.d.subject ?? work?.subjects ?? []).slice(0, 40),
  };
}

let done = 0;
const queue = [...todo];
async function worker() {
  while (queue.length) {
    const b = queue.shift()!;
    info[b.id] = await fetchOne(b);
    if (++done % 50 === 0) {
      writeFileSync(FILE, JSON.stringify(info, null, 1) + "\n");
      console.log(`${done}/${todo.length}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(FILE, JSON.stringify(info, null, 1) + "\n");
const vals = Object.values(info);
console.log(`완료: ${vals.filter((v) => v.found).length}권 찾음, 줄거리 ${vals.filter((v) => v.summary).length}권, 못 찾음 ${vals.filter((v) => !v.found).length}권`);
