// 구매: 한 권씩 사기 / 묶음 전체 사기.
//
// 쿠팡은 외부에서 여러 상품을 한 번에 장바구니에 담는 기능을 열어두지 않았다.
// 그래서 "전체 구매"는 한 권씩 쿠팡 페이지를 열어 담고 돌아오는 체크리스트로 만든다.
// (한 번에 여러 탭을 열면 브라우저 팝업 차단에 걸린다)

import type { Book } from "./books.ts";
import { bookCoupangUrl, bookLinkKind, type LinkKind } from "./coupang.ts";

export interface PurchaseItem {
  book: Book;
  url: string;
  /** partners가 아니면 내 실적으로 잡히지 않는다 */
  linkKind: LinkKind;
}

export interface PurchasePlan {
  items: PurchaseItem[];
  /** 이미 가진 책이라 뺀 것 */
  skipped: Book[];
  /** 가격을 아는 책들의 합. 모르는 책이 있으면 unknownPriceCount > 0 */
  knownTotalKrw: number;
  unknownPriceCount: number;
}

export function purchaseItem(book: Book): PurchaseItem {
  return { book, url: bookCoupangUrl(book), linkKind: bookLinkKind(book) };
}

export function buildPurchasePlan(
  books: Book[],
  opts: { owned?: ReadonlySet<string> } = {},
): PurchasePlan {
  const owned = opts.owned ?? new Set<string>();
  const items: PurchaseItem[] = [];
  const skipped: Book[] = [];
  let knownTotalKrw = 0;
  let unknownPriceCount = 0;

  for (const book of books) {
    if (owned.has(book.id)) {
      skipped.push(book);
      continue;
    }
    items.push(purchaseItem(book));
    if (book.priceKrw != null) knownTotalKrw += book.priceKrw;
    else unknownPriceCount++;
  }
  return { items, skipped, knownTotalKrw, unknownPriceCount };
}

/** 묶음 구매 체크리스트에서 다음에 열 책. 다 담았으면 null */
export function nextToBuy(plan: PurchasePlan, done: ReadonlySet<string>): PurchaseItem | null {
  return plan.items.find((i) => !done.has(i.book.id)) ?? null;
}

export function purchaseProgress(plan: PurchasePlan, done: ReadonlySet<string>) {
  const finished = plan.items.filter((i) => done.has(i.book.id)).length;
  return { done: finished, total: plan.items.length, complete: finished === plan.items.length };
}
