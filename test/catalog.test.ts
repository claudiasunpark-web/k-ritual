import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOKS,
  allCollections,
  bookCoupangUrl,
  bookLevel,
  buildPurchasePlan,
  collectionBooks,
  collectionsByKind,
  getCollection,
  nextToBuy,
  partnersAuthorization,
  purchaseProgress,
  searchProducts,
  type Book,
} from "../src/catalog/index.ts";

test("카탈로그 id가 겹치지 않는다", () => {
  assert.equal(new Set(BOOKS.map((b) => b.id)).size, BOOKS.length);
});

test("네 종류 묶음이 모두 있고 모든 책 id가 유효하다", () => {
  for (const kind of ["situation", "theme", "level", "award"] as const) {
    assert.ok(collectionsByKind(kind).length > 0, kind);
  }
  for (const c of allCollections()) assert.doesNotThrow(() => collectionBooks(c), c.id);
});

test("읽어주기 그림책은 레벨 0(듣기)", () => {
  const book = BOOKS.find((b) => b.id === "where-the-wild-things-are")!;
  assert.equal(bookLevel(book).level.level, 0);
  assert.equal(bookLevel(book).mode, "listen");
  assert.deepEqual(bookLevel(book).warnings, []);
  assert.ok(getCollection("level-0").bookIds.includes(book.id));
});

test("문학상 묶음은 최근 수상작부터", () => {
  const ids = getCollection("award-뉴베리").bookIds;
  assert.equal(ids[0], "new-kid");
  assert.equal(ids.at(-1), "charlottes-web");
});

const base: Book = { id: "x", title: "Charlotte's Web", author: "E. B. White", indicesVerified: false };

test("쿠팡 링크: 내 파트너스 링크 → 상품 → 검색 순", () => {
  assert.equal(
    bookCoupangUrl(base),
    "https://www.coupang.com/np/search?q=Charlotte%27s+Web+E.+B.+White+%EC%9B%90%EC%84%9C",
  );
  assert.equal(
    bookCoupangUrl({ ...base, coupang: { productId: "123", vendorItemId: "9" } }),
    "https://www.coupang.com/vp/products/123?vendorItemId=9",
  );
  assert.equal(
    bookCoupangUrl({ ...base, coupang: { productId: "123", partnersUrl: "https://link.coupang.com/a/abc" } }),
    "https://link.coupang.com/a/abc",
  );
});

test("묶음 구매: 가진 책 빼고, 가격 합산, 체크리스트 진행", () => {
  const books: Book[] = [
    { ...base, id: "a", priceKrw: 10000, coupang: { partnersUrl: "https://link.coupang.com/a/1" } },
    { ...base, id: "b", priceKrw: 8000 },
    { ...base, id: "c" },
  ];
  const plan = buildPurchasePlan(books, { owned: new Set(["b"]) });
  assert.deepEqual(plan.items.map((i) => i.book.id), ["a", "c"]);
  assert.deepEqual(plan.items.map((i) => i.linkKind), ["partners", "search"]);
  assert.equal(plan.skipped[0].id, "b");
  assert.equal(plan.knownTotalKrw, 10000);
  assert.equal(plan.unknownPriceCount, 1);

  const done = new Set<string>();
  assert.equal(nextToBuy(plan, done)?.book.id, "a");
  done.add("a");
  assert.equal(nextToBuy(plan, done)?.book.id, "c");
  done.add("c");
  assert.equal(nextToBuy(plan, done), null);
  assert.deepEqual(purchaseProgress(plan, done), { done: 2, total: 2, complete: true });
});

test("파트너스 HMAC 헤더 형식", () => {
  const h = partnersAuthorization(
    "GET",
    "/v2/x?keyword=a",
    { accessKey: "AK", secretKey: "SK" },
    new Date("2026-10-10T01:02:03Z"),
  );
  assert.match(h, /^CEA algorithm=HmacSHA256, access-key=AK, signed-date=261010T010203Z, signature=[0-9a-f]{64}$/);
});

test("파트너스 상품 검색 응답 해석", async () => {
  let calledUrl = "";
  const fakeFetch = (async (url: string) => {
    calledUrl = url;
    return new Response(
      JSON.stringify({ rCode: "0", data: { productData: [{ productId: 1, productName: "Charlotte's Web", productPrice: 9000, productImage: "", productUrl: "https://link.coupang.com/re/x", isRocket: true }] } }),
    );
  }) as typeof fetch;
  const products = await searchProducts("charlotte", { accessKey: "a", secretKey: "b" }, 5, fakeFetch);
  assert.equal(products[0].productUrl, "https://link.coupang.com/re/x");
  assert.ok(calledUrl.endsWith("/products/search?keyword=charlotte&limit=5"));
});
