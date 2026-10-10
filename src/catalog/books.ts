// 추천 도서 카탈로그.
//
// 지수(AR·렉사일·IL) 값은 공개된 자료를 바탕으로 한 근사값이다(indicesVerified: false).
// 출시 전에 ARBookFind(arbookfind.com)와 Lexile Find a Book(hub.lexile.com)으로
// 한 권씩 확인하고 indicesVerified를 true로 바꿔야 한다.
// 쿠팡 상품 ID는 쿠팡 파트너스에서 실제 판매 페이지를 골라 채운다. 비어 있으면 검색 링크로 연결된다.

import type { BookIndices } from "../levels/index.ts";
import coupangLinks from "./coupang-links.json" with { type: "json" };

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
  title: string;
  author: string;
  /** 엄마가 읽어주는 그림책. 지수가 없어도 K-레벨 0(듣기)로 분류 */
  readAloud?: boolean;
  /** 시리즈 첫 권이면 시리즈명 */
  series?: string;
  awards?: AwardInfo[];
  themes?: string[];
  /** 원. 모르면 비워두고 쿠팡에서 확인 */
  priceKrw?: number;
  coupang?: CoupangRef;
  indicesVerified: boolean;
}

const CATALOG: Book[] = [
  // ── 읽어주기 그림책 (K-레벨 0) ─────────────────────────────
  { id: "very-hungry-caterpillar", title: "The Very Hungry Caterpillar", author: "Eric Carle", readAloud: true, themes: ["동물", "자연"], indicesVerified: false },
  { id: "brown-bear", title: "Brown Bear, Brown Bear, What Do You See?", author: "Bill Martin Jr.", readAloud: true, themes: ["동물", "색깔"], indicesVerified: false },
  { id: "bear-hunt", title: "We're Going on a Bear Hunt", author: "Michael Rosen", readAloud: true, themes: ["가족", "모험"], indicesVerified: false },
  { id: "goodnight-moon", title: "Goodnight Moon", author: "Margaret Wise Brown", readAloud: true, themes: ["잠자리"], indicesVerified: false },
  { id: "llama-red-pajama", title: "Llama Llama Red Pajama", author: "Anna Dewdney", readAloud: true, themes: ["잠자리", "가족"], indicesVerified: false },
  { id: "kissing-hand", title: "The Kissing Hand", author: "Audrey Penn", readAloud: true, themes: ["새 학기", "가족"], indicesVerified: false },
  { id: "where-the-wild-things-are", title: "Where the Wild Things Are", author: "Maurice Sendak", readAloud: true, ar: 3.4, lexile: "AD740L", awards: [{ award: "칼데콧", year: 1964, kind: "medal" }], themes: ["감정", "모험"], indicesVerified: false },
  { id: "snowy-day", title: "The Snowy Day", author: "Ezra Jack Keats", readAloud: true, ar: 2.5, lexile: "AD500L", awards: [{ award: "칼데콧", year: 1963, kind: "medal" }], themes: ["계절", "자연"], indicesVerified: false },
  { id: "owl-moon", title: "Owl Moon", author: "Jane Yolen", readAloud: true, awards: [{ award: "칼데콧", year: 1988, kind: "medal" }], themes: ["가족", "자연", "잠자리"], indicesVerified: false },
  { id: "officer-buckle", title: "Officer Buckle and Gloria", author: "Peggy Rathmann", readAloud: true, ar: 3.4, awards: [{ award: "칼데콧", year: 1996, kind: "medal" }], themes: ["유머", "동물", "새 학기"], indicesVerified: false },
  { id: "sophie-angry", title: "When Sophie Gets Angry—Really, Really Angry...", author: "Molly Bang", readAloud: true, awards: [{ award: "칼데콧", year: 2000, kind: "honor" }], themes: ["감정"], indicesVerified: false },
  { id: "knuffle-bunny", title: "Knuffle Bunny", author: "Mo Willems", readAloud: true, awards: [{ award: "칼데콧", year: 2005, kind: "honor" }], themes: ["가족", "유머"], indicesVerified: false },
  { id: "last-stop-market-street", title: "Last Stop on Market Street", author: "Matt de la Peña", readAloud: true, lexile: "AD610L", awards: [{ award: "뉴베리", year: 2016, kind: "medal" }, { award: "칼데콧", year: 2016, kind: "honor" }], themes: ["가족"], indicesVerified: false },

  // ── 리더스북 ──────────────────────────────────────────
  { id: "pigeon-bus", title: "Don't Let the Pigeon Drive the Bus!", author: "Mo Willems", ar: 0.9, awards: [{ award: "칼데콧", year: 2004, kind: "honor" }], themes: ["유머", "동물"], indicesVerified: false },
  { id: "bird-on-your-head", title: "There Is a Bird on Your Head!", author: "Mo Willems", series: "Elephant & Piggie", ar: 0.6, awards: [{ award: "가이젤", year: 2008, kind: "medal" }], themes: ["유머", "우정", "동물"], indicesVerified: false },
  { id: "ready-to-play-outside", title: "Are You Ready to Play Outside?", author: "Mo Willems", series: "Elephant & Piggie", ar: 0.5, awards: [{ award: "가이젤", year: 2009, kind: "medal" }], themes: ["우정", "계절"], indicesVerified: false },
  { id: "we-are-in-a-book", title: "We Are in a Book!", author: "Mo Willems", series: "Elephant & Piggie", ar: 0.9, awards: [{ award: "가이젤", year: 2011, kind: "honor" }], themes: ["유머", "우정"], indicesVerified: false },
  { id: "hi-fly-guy", title: "Hi! Fly Guy", author: "Tedd Arnold", series: "Fly Guy", ar: 1.5, awards: [{ award: "가이젤", year: 2006, kind: "honor" }], themes: ["유머", "동물"], indicesVerified: false },
  { id: "henry-and-mudge", title: "Henry and Mudge: The First Book", author: "Cynthia Rylant", series: "Henry and Mudge", ar: 2.1, themes: ["동물", "우정"], indicesVerified: false },
  { id: "frog-toad-friends", title: "Frog and Toad Are Friends", author: "Arnold Lobel", series: "Frog and Toad", ar: 2.9, lexile: "400L", awards: [{ award: "칼데콧", year: 1971, kind: "honor" }], themes: ["우정", "동물"], indicesVerified: false },
  { id: "frog-toad-together", title: "Frog and Toad Together", author: "Arnold Lobel", series: "Frog and Toad", ar: 2.7, awards: [{ award: "뉴베리", year: 1973, kind: "honor" }], themes: ["우정", "동물"], indicesVerified: false },

  // ── 얼리챕터북 ────────────────────────────────────────
  { id: "nate-the-great", title: "Nate the Great", author: "Marjorie Weinman Sharmat", series: "Nate the Great", ar: 2.0, themes: ["미스터리"], indicesVerified: false },
  { id: "dinosaurs-before-dark", title: "Dinosaurs Before Dark", author: "Mary Pope Osborne", series: "Magic Tree House", ar: 2.6, lexile: "510L", themes: ["공룡", "모험"], indicesVerified: false },
  { id: "mercy-watson", title: "Mercy Watson to the Rescue", author: "Kate DiCamillo", series: "Mercy Watson", ar: 2.6, lexile: "450L", awards: [{ award: "가이젤", year: 2006, kind: "honor" }], themes: ["유머", "동물"], indicesVerified: false },
  { id: "junie-b-jones", title: "Junie B. Jones and the Stupid Smelly Bus", author: "Barbara Park", series: "Junie B. Jones", ar: 2.9, lexile: "380L", themes: ["새 학기", "유머"], indicesVerified: false },
  { id: "dog-man", title: "Dog Man", author: "Dav Pilkey", series: "Dog Man", ar: 2.6, lexile: "GN390L", themes: ["유머", "영어 거부"], indicesVerified: false },

  // ── 챕터북 ───────────────────────────────────────────
  { id: "horrid-henry", title: "Horrid Henry", author: "Francesca Simon", series: "Horrid Henry", ar: 3.2, themes: ["유머", "가족", "영어 거부"], indicesVerified: false },
  { id: "absent-author", title: "The Absent Author", author: "Ron Roy", series: "A to Z Mysteries", ar: 3.4, themes: ["미스터리"], indicesVerified: false },
  { id: "sarah-plain-tall", title: "Sarah, Plain and Tall", author: "Patricia MacLachlan", ar: 3.4, lexile: "560L", interestLevel: "MG", awards: [{ award: "뉴베리", year: 1986, kind: "medal" }], themes: ["가족"], indicesVerified: false },
  { id: "new-kid", title: "New Kid", author: "Jerry Craft", ar: 3.4, lexile: "GN320L", interestLevel: "MG", awards: [{ award: "뉴베리", year: 2020, kind: "medal" }], themes: ["새 학기", "우정"], indicesVerified: false },
  { id: "one-and-only-ivan", title: "The One and Only Ivan", author: "Katherine Applegate", ar: 3.6, lexile: "570L", interestLevel: "MG", awards: [{ award: "뉴베리", year: 2013, kind: "medal" }], themes: ["동물", "우정"], indicesVerified: false },
  { id: "winn-dixie", title: "Because of Winn-Dixie", author: "Kate DiCamillo", ar: 3.9, lexile: "610L", interestLevel: "MG", awards: [{ award: "뉴베리", year: 2001, kind: "honor" }], themes: ["동물", "우정", "가족"], indicesVerified: false },

  // ── 소설 ─────────────────────────────────────────────
  { id: "charlottes-web", title: "Charlotte's Web", author: "E. B. White", ar: 4.4, lexile: "680L", interestLevel: "MG", awards: [{ award: "뉴베리", year: 1953, kind: "honor" }], themes: ["동물", "우정"], indicesVerified: false },
  { id: "holes", title: "Holes", author: "Louis Sachar", ar: 4.6, lexile: "660L", interestLevel: "MG", awards: [{ award: "뉴베리", year: 1999, kind: "medal" }], themes: ["모험", "미스터리"], indicesVerified: false },
  { id: "despereaux", title: "The Tale of Despereaux", author: "Kate DiCamillo", ar: 4.7, lexile: "670L", interestLevel: "MG", awards: [{ award: "뉴베리", year: 2004, kind: "medal" }], themes: ["모험", "동물"], indicesVerified: false },
  { id: "wonder", title: "Wonder", author: "R. J. Palacio", ar: 4.8, lexile: "790L", interestLevel: "MG", themes: ["우정", "새 학기", "감정"], indicesVerified: false },
  { id: "matilda", title: "Matilda", author: "Roald Dahl", ar: 5.0, lexile: "840L", interestLevel: "MG", themes: ["유머", "가족"], indicesVerified: false },
  { id: "wimpy-kid", title: "Diary of a Wimpy Kid", author: "Jeff Kinney", series: "Diary of a Wimpy Kid", ar: 5.2, lexile: "950L", interestLevel: "MG", themes: ["유머", "새 학기", "영어 거부"], indicesVerified: false },
  { id: "harry-potter-1", title: "Harry Potter and the Sorcerer's Stone", author: "J. K. Rowling", series: "Harry Potter", ar: 5.5, lexile: "880L", interestLevel: "MG", themes: ["모험", "판타지"], indicesVerified: false },
  { id: "hatchet", title: "Hatchet", author: "Gary Paulsen", ar: 5.7, lexile: "1020L", interestLevel: "MG", awards: [{ award: "뉴베리", year: 1988, kind: "honor" }], themes: ["모험", "자연"], indicesVerified: false },
  { id: "the-giver", title: "The Giver", author: "Lois Lowry", ar: 5.7, lexile: "760L", interestLevel: "UG", awards: [{ award: "뉴베리", year: 1994, kind: "medal" }], themes: ["판타지"], indicesVerified: false },
];

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
