// 내 쿠팡 파트너스 API 키로 카탈로그 책들의 구매 링크를 채운다.
//
//   npm run fill-coupang -- --limit 5 --dry-run   # 5권만 시험 (파일에 안 씀)
//   npm run fill-coupang                          # 전체 (시간당 40회 속도로 천천히)
//   npm run fill-coupang -- --per-hour 30         # 더 천천히
//   npm run fill-coupang -- --retry-missing       # 예전에 못 찾은 책도 다시
//
// 키는 프로젝트 폴더의 .env.local 파일(깃에 올라가지 않음)이나 환경변수에서 읽는다:
//   COUPANG_ACCESS_KEY=...
//   COUPANG_SECRET_KEY=...
//
// 이미 링크가 있는 책은 건너뛴다. 검색 API는 시간당 호출 횟수 제한이 있고 3번 넘기면
// 파트너스 이용이 막히므로, 호출 사이를 일정하게 띄워 한도 아래로만 부른다.
// 찾은 링크는 10권마다 저장하니 중간에 꺼도(Ctrl+C) 다시 돌리면 남은 책부터 이어간다.
// 자동 매칭은 틀릴 수 있다(다른 판본·한국어 번역본). matchedName을 보고 꼭 확인할 것.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { BOOKS } from "../src/catalog/books.ts";
import { bestProductMatch, bookSearchKeywords, credentialsFromEnv, searchProducts, type CoupangProduct } from "../src/catalog/coupang.ts";

const FILE = new URL("../src/catalog/coupang-links.json", import.meta.url);
const dryRun = process.argv.includes("--dry-run");
const argNumber = (name: string, fallback: number) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const limit = argNumber("--limit", Infinity);
/** 실제 한도는 문서에 없다. 2026-10 실행에서 50여 회 만에 막혀서 넉넉히 40으로 */
const perHour = argNumber("--per-hour", 40);
const gapMs = Math.ceil(3_600_000 / perHour);

const creds = credentialsFromEnv();
if (!creds) {
  console.error("COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY 환경변수가 필요해요 (쿠팡 파트너스 > 추가기능 > Open API).");
  process.exit(1);
}

const links = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Record<string, unknown>>;
// 못 찾은 책은 기억해 두고 다음 실행에서 건너뛴다 (검색어 2~3개를 또 쓰면 시간당 한도만 깎인다).
// 다시 찾아보려면 --retry-missing
const MISSING_FILE = new URL("../data/coupang-not-found.json", import.meta.url);
const missing = (existsSync(MISSING_FILE) ? JSON.parse(readFileSync(MISSING_FILE, "utf8")) : {}) as Record<string, string>;
const retryMissing = process.argv.includes("--retry-missing");
const todo = BOOKS.filter((b) => !b.coupang?.partnersUrl && (retryMissing || !missing[b.id])).slice(0, limit);
console.log(`이번에 찾을 책 ${todo.length}권 (검색 ${gapMs / 1000}초에 1번, 시간당 ${perHour}번)`);

let found = 0;
let saved = 0;
function save() {
  if (dryRun || found === saved) return;
  writeFileSync(FILE, JSON.stringify(links, null, 2) + "\n");
  saved = found;
  console.log(`  … 지금까지 ${found}권 저장`);
}

let lastCall = 0;
async function search(keyword: string): Promise<CoupangProduct[]> {
  const wait = lastCall + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  // 쿠팡 서버 쪽 일시 오류(5xx)는 10분 쉬고 최대 3번 다시. 횟수 제한(429) 같은 건 바로 멈춘다
  for (let attempt = 1; ; attempt++) {
    try {
      return await searchProducts(keyword, creds!, 10);
    } catch (err) {
      if (attempt > 3 || !/검색 실패 \(5\d\d\)/.test((err as Error).message)) throw err;
      console.error(`  … 쿠팡 서버 일시 오류, 10분 뒤 다시 (${attempt}/3): ${(err as Error).message}`);
      await sleep(600_000);
      lastCall = Date.now();
    }
  }
}

let stopped = false;
for (const book of todo) {
  // 못 찾으면 더 짧은 검색어로 다시 (호출 횟수가 늘어나니 찾으면 바로 멈춘다)
  let match: CoupangProduct | null = null;
  for (const keyword of bookSearchKeywords(book.title, book.author)) {
    try {
      match = bestProductMatch(book.title, await search(keyword), { series: book.isSeries });
    } catch (err) {
      console.error(`중단: ${(err as Error).message}`);
      stopped = true;
      break;
    }
    if (match) break;
  }
  if (stopped) break;
  if (!match) {
    console.log(`  ✗ ${book.title}: 맞는 상품을 못 찾음, 직접 링크를 붙여넣어 주세요`);
    missing[book.id] = new Date().toISOString().slice(0, 10);
    if (!dryRun) writeFileSync(MISSING_FILE, JSON.stringify(missing, null, 2) + "\n");
    continue;
  }
  links[book.id] = {
    partnersUrl: match.productUrl,
    productId: String(match.productId),
    priceKrw: match.productPrice,
    matchedName: match.productName,
  };
  found++;
  console.log(`  ✓ ${book.title} → ${match.productName} (${match.productPrice.toLocaleString()}원)`);
  if (found % 10 === 0) save();
}

save();
if (!dryRun) console.log(`끝: 이번에 ${found}권 저장 (src/catalog/coupang-links.json)`);
