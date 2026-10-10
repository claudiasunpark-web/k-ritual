// 내 쿠팡 파트너스 API 키로 카탈로그 책들의 구매 링크를 채운다.
//
//   COUPANG_ACCESS_KEY=... COUPANG_SECRET_KEY=... node scripts/fill-coupang-links.ts
//   (--dry-run: 파일에 쓰지 않고 결과만 출력)
//
// 이미 링크가 있는 책은 건너뛴다. 검색 API는 호출 횟수 제한이 있어 중간에 막히면
// 그때까지 찾은 링크를 저장하고 멈춘다. 나중에 다시 돌리면 남은 책부터 이어간다.
// 자동 매칭은 틀릴 수 있다(다른 판본·한국어 번역본). matchedName을 보고 꼭 확인할 것.

import { readFileSync, writeFileSync } from "node:fs";
import { BOOKS } from "../src/catalog/books.ts";
import { credentialsFromEnv, searchProducts, type CoupangProduct } from "../src/catalog/coupang.ts";

const FILE = new URL("../src/catalog/coupang-links.json", import.meta.url);
const dryRun = process.argv.includes("--dry-run");

const creds = credentialsFromEnv();
if (!creds) {
  console.error("COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY 환경변수가 필요해요 (쿠팡 파트너스 > 추가기능 > Open API).");
  process.exit(1);
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** 제목 단어가 상품명에 많이 들어 있는 상품. 번역본을 피하려고 영문 제목 기준으로 고른다 */
function bestMatch(title: string, products: CoupangProduct[]): CoupangProduct | null {
  const want = new Set(words(title));
  let best: CoupangProduct | null = null;
  let bestScore = 0;
  for (const p of products) {
    const have = new Set(words(p.productName));
    const score = [...want].filter((w) => have.has(w)).length / want.size;
    if (score > bestScore) [best, bestScore] = [p, score];
  }
  return bestScore >= 0.6 ? best : null;
}

const links = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Record<string, unknown>>;
const todo = BOOKS.filter((b) => !b.coupang?.partnersUrl);
console.log(`링크 없는 책 ${todo.length}권`);

let found = 0;
for (const book of todo) {
  let products: CoupangProduct[];
  try {
    products = await searchProducts(`${book.title} ${book.author} 원서`, creds, 10);
  } catch (err) {
    console.error(`중단: ${(err as Error).message}`);
    break;
  }
  const match = bestMatch(book.title, products);
  if (!match) {
    console.log(`  ✗ ${book.title}: 맞는 상품을 못 찾음, 직접 링크를 붙여넣어 주세요`);
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
}

if (!dryRun && found > 0) {
  writeFileSync(FILE, JSON.stringify(links, null, 2) + "\n");
  console.log(`${found}권 저장: src/catalog/coupang-links.json`);
}
