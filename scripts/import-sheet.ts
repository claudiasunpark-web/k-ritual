// 구글 시트에서 카탈로그를 가져와 data/books.csv, data/series.csv를 바꾼다.
//
//   node scripts/import-sheet.ts <낱권 시트 주소...> <시리즈 시트 주소>
//
// 마지막 주소가 시리즈 시트이고, 그 앞은 모두 낱권 시트다(낱권 시트가 여러 장이면 합친다).
// 주소는 브라우저 주소창의 구글 시트 링크 그대로 넣으면 된다(탭마다 #gid=가 다르다).
// 시트는 '링크가 있는 모든 사용자: 뷰어'로 공유돼 있어야 한다.
// 내려받은 CSV 파일 경로를 넣어도 된다.
//
// 틀린 칸이 하나라도 있으면 아무것도 바꾸지 않고 고칠 곳을 알려준다.

import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvRecords, stringifyCsv } from "../src/catalog/csv.ts";
import { BOOK_COLUMNS, validateCatalog } from "../src/catalog/sheet.ts";

/** 구글 시트 편집 링크 → CSV 내보내기 링크 */
export function sheetCsvUrl(input: string): string {
  const m = /docs\.google\.com\/spreadsheets\/d\/([\w-]+)/.exec(input);
  if (!m) return input;
  const gid = /[#&?]gid=(\d+)/.exec(input)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

async function read(source: string): Promise<string> {
  if (!/^https?:\/\//.test(source)) return readFileSync(source, "utf8");
  const res = await fetch(sheetCsvUrl(source));
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith("<")) {
    throw new Error(`시트를 읽지 못했어요 (${res.status}). 공유 설정이 '링크가 있는 모든 사용자'인지 확인해 주세요: ${source}`);
  }
  return text;
}

const sources = process.argv.slice(2);
if (sources.length < 2) {
  console.error("사용법: node scripts/import-sheet.ts <낱권 시트 주소...> <시리즈 시트 주소>");
  process.exit(1);
}
const seriesSrc = sources.pop()!;

/** 낱권 시트 여러 장을 머리글 하나로 합친다 */
function mergeCsv(parts: string[]): string {
  const [first, ...rest] = parts.map((p) => p.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd());
  return [first, ...rest.map((p) => p.slice(p.indexOf("\n") + 1))].join("\n") + "\n";
}

const [seriesCsv, ...bookParts] = await Promise.all([read(seriesSrc), ...sources.map(read)]);
const dir = new URL("../data/", import.meta.url);
const booksCsv = keepCovers(mergeCsv(bookParts), readFileSync(new URL("books.csv", dir), "utf8"));

/**
 * 표지 주소는 자동 수집(fetch-series-openlibrary)이 채우는 값이라 시트에 없어도 된다.
 * 시트의 '표지' 칸이 비어 있으면 지금 data/books.csv에 있던 표지를 id로 찾아 그대로 둔다.
 */
function keepCovers(sheetCsv: string, currentCsv: string): string {
  const covers = new Map(parseCsvRecords(currentCsv).map((r) => [r["id"], r["표지"] ?? ""]));
  const rows = parseCsvRecords(sheetCsv);
  for (const r of rows) {
    if (!r["표지"] && covers.get(r["id"])) r["표지"] = covers.get(r["id"])!;
  }
  const header = [...new Set([...BOOK_COLUMNS, ...Object.keys(rows[0] ?? {}), "표지"])];
  return stringifyCsv(header, rows);
}
const { books, problems } = validateCatalog(booksCsv, seriesCsv);
if (problems.length) {
  console.error(`시트에 고칠 곳이 ${problems.length}개 있어요. 아무것도 바꾸지 않았어요.`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

writeFileSync(new URL("books.csv", dir), booksCsv);
writeFileSync(new URL("series.csv", dir), seriesCsv);
const series = books.filter((b) => b.isSeries).length;
const approx = books.filter((b) => !b.indicesVerified).length;
console.log(`가져왔어요: 낱권 ${books.length - series}권, 시리즈 ${series}개 (지수 근사값 ${approx}개)`);
console.log("페이지에 반영하려면 npm run build");
