// 시리즈의 낱권 제목들을 data/books.csv에 덧붙인다. 이미 있는 제목은 건너뛰고, 기존 행은 시리즈를 연결만 한다.
//
//   node scripts/add-series-books.ts "Magic Tree House" < titles.txt
//
// 한 줄에 제목 하나. "제목 | 저자"처럼 저자를 따로 줄 수 있다(없으면 시리즈 저자).

import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvRecords, stringifyCsv } from "../src/catalog/csv.ts";
import { BOOK_COLUMNS, slugify } from "../src/catalog/sheet.ts";

const seriesName = process.argv[2];
if (!seriesName) {
  console.error('사용법: node scripts/add-series-books.ts "<시리즈명>" < 제목목록.txt');
  process.exit(1);
}

const dir = new URL("../data/", import.meta.url);
const books = parseCsvRecords(readFileSync(new URL("books.csv", dir), "utf8"));
const series = parseCsvRecords(readFileSync(new URL("series.csv", dir), "utf8")).find((r) => r["시리즈명"] === seriesName);
if (!series) {
  console.error(`시리즈 시트에 "${seriesName}"이 없어요`);
  process.exit(1);
}

const norm = (t: string) => t.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
const byTitle = new Map(books.map((r) => [norm(r["제목"]), r]));
const ids = new Set(books.map((r) => r["id"]));

let added = 0;
let linked = 0;
const lines = readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
for (const line of lines) {
  const [title, author] = line.split("|").map((s) => s.trim());
  const existing = byTitle.get(norm(title));
  if (existing) {
    if (!existing["시리즈"]) {
      existing["시리즈"] = seriesName;
      linked++;
    }
    continue;
  }
  let id = slugify(title);
  if (ids.has(id)) id = `${slugify(seriesName)}-${id}`;
  ids.add(id);
  const row: Record<string, string> = Object.fromEntries(BOOK_COLUMNS.map((c) => [c, ""]));
  Object.assign(row, { id, 제목: title, 저자: author || series["저자"], 시리즈: seriesName, 지수확인: "N" });
  books.push(row);
  byTitle.set(norm(title), row);
  added++;
}

// 시트에 있는 추가 열(표지 등)도 그대로 둔다
const header = [...new Set([...BOOK_COLUMNS, ...Object.keys(books[0] ?? {})])];
writeFileSync(new URL("books.csv", dir), stringifyCsv(header, books));
console.log(`${seriesName}: ${added}권 추가, 기존 ${linked}권 연결`);
