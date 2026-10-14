// 추천 도서 카탈로그. 책 목록은 data/books.csv(낱권)와 data/series.csv(시리즈)에 있고
// 구글 시트에서 고친 뒤 scripts/import-sheet.ts로 가져온다. 형식은 docs/catalog-sheet.md 참고.
//
// 지수확인이 N인 AR·렉사일·IL·레벨 값은 근사값이다. 화면에 "근사"로 표시되며,
// ARBookFind(arbookfind.com) 등으로 확인한 뒤 Y로 바꾼다.
// 쿠팡 링크가 비어 있으면 쿠팡 검색 결과로 연결된다.

import { readFileSync } from "node:fs";
import type { BookIndices } from "../levels/index.ts";
import coupangLinks from "./coupang-links.json" with { type: "json" };
import { loadCatalog } from "./sheet.ts";

export type Award = "칼데콧" | "뉴베리" | "가이젤";

export interface AwardInfo {
  award: Award;
  year: number;
  /** 대상(메달)인지 아너(우수작)인지 */
  kind: "medal" | "honor";
}

export interface CoupangRef {
  /**
   * 내 쿠팡 파트너스 계정으로 만든 링크(https://link.coupang.com/a/...).
   * 이 링크로 사야 내 실적으로 잡힌다. 있으면 다른 값보다 우선한다.
   */
  partnersUrl?: string;
  /** coupang.com/vp/products/{productId} */
  productId?: string;
  vendorItemId?: string;
  /** 자동으로 찾은 쿠팡 상품명. 맞는 판본인지 사람이 확인하는 용도 */
  matchedName?: string;
  /** 상품 ID가 없을 때 쓸 검색어. 없으면 제목+저자로 만든다 */
  query?: string;
}

export interface Book extends BookIndices {
  id: string;
  /** 시리즈 항목이면 시리즈명 */
  title: string;
  author: string;
  /** 그림책, 리더스북, 얼리챕터북, 챕터북, 소설, 그래픽노블 등 */
  format?: string;
  /** 엄마가 읽어주는 그림책. 지수가 없어도 K-레벨 0(듣기)로 분류 */
  readAloud?: boolean;
  /** 낱권이 속한 시리즈명 */
  series?: string;
  /** 시리즈 항목(여러 권 묶음)인지. ar은 AR최소, arMax는 AR최대 */
  isSeries?: boolean;
  arMax?: number;
  bookCount?: number;
  /** 시리즈 항목: 낱권이 카탈로그에 따로 있는지 */
  hasChildren?: boolean;
  /** 낱권: 속한 시리즈 항목 id와 시리즈 총 권수 */
  seriesId?: string;
  seriesCount?: number;
  /** 낱권 레벨을 시리즈 AR로 추정했는지 */
  levelFromSeries?: boolean;
  /** AR이 없을 때 사람이 정한 K-레벨 */
  manualLevel?: number;
  /** 상황별 묶음 이름들 (잠자리, 새 학기 …) */
  situations?: string[];
  memo?: string;
  awards?: AwardInfo[];
  themes?: string[];
  /** 원. 모르면 비워두고 쿠팡에서 확인 */
  priceKrw?: number;
  coupang?: CoupangRef;
  indicesVerified: boolean;
}

const DATA_DIR = new URL("../../data/", import.meta.url);
const CATALOG = loadCatalog(
  readFileSync(new URL("books.csv", DATA_DIR), "utf8"),
  readFileSync(new URL("series.csv", DATA_DIR), "utf8"),
);

/**
 * coupang-links.json(파트너스 링크·상품 ID·가격)을 카탈로그에 합친다.
 * 링크는 이 파일에서만 관리한다: 직접 붙여넣거나 scripts/fill-coupang-links.ts로 채운다.
 */
type LinkEntry = CoupangRef & { priceKrw?: number };
const LINKS = coupangLinks as Record<string, LinkEntry>;

export const BOOKS: readonly Book[] = CATALOG.map((book) => {
  const entry = LINKS[book.id];
  if (!entry) return book;
  const { priceKrw, ...ref } = entry;
  return { ...book, priceKrw: priceKrw ?? book.priceKrw, coupang: { ...book.coupang, ...ref } };
});

export function getBook(id: string): Book {
  const book = BOOKS.find((b) => b.id === id);
  if (!book) throw new RangeError(`카탈로그에 없는 책이에요: ${id}`);
  return book;
}
