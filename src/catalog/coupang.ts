// 쿠팡 링크 만들기.
//
// 1) 일반 링크: 상품 ID가 있으면 상품 페이지, 없으면 쿠팡 검색 결과로 연결 (키 없이 동작)
// 2) 파트너스 링크: 쿠팡 파트너스 Open API로 일반 링크를 수수료 추적 링크로 바꾼다.
//    시크릿 키가 필요하므로 반드시 서버에서만 호출한다.

import { createHmac } from "node:crypto";
import type { Book } from "./books.ts";

/** 쿠팡 파트너스 링크를 쓰는 화면에는 이 문구를 반드시 표시해야 한다 */
export const COUPANG_PARTNERS_DISCLOSURE =
  "이 서비스는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";

const COUPANG = "https://www.coupang.com";

export function coupangProductUrl(productId: string, vendorItemId?: string): string {
  const url = new URL(`/vp/products/${encodeURIComponent(productId)}`, COUPANG);
  if (vendorItemId) url.searchParams.set("vendorItemId", vendorItemId);
  return url.toString();
}

export function coupangSearchUrl(query: string): string {
  const url = new URL("/np/search", COUPANG);
  url.searchParams.set("q", query);
  return url.toString();
}

export type LinkKind = "partners" | "product" | "search";

/** 내 실적으로 잡히는 링크인지. partners만 수수료가 붙는다 */
export function bookLinkKind(book: Book): LinkKind {
  const ref = book.coupang;
  if (ref?.partnersUrl) return "partners";
  if (ref?.productId) return "product";
  return "search";
}

/** 책 한 권의 쿠팡 링크. 내 파트너스 링크 → 상품 페이지 → 검색 결과 순 */
export function bookCoupangUrl(book: Book): string {
  const ref = book.coupang;
  if (ref?.partnersUrl) return ref.partnersUrl;
  if (ref?.productId) return coupangProductUrl(ref.productId, ref.vendorItemId);
  const fallback = book.isSeries ? `${book.title} 원서 세트` : `${book.title} ${book.author} 원서`;
  return coupangSearchUrl(ref?.query ?? fallback);
}

// ── 쿠팡 파트너스 Open API ────────────────────────────────

export interface PartnersCredentials {
  accessKey: string;
  secretKey: string;
}

export interface Deeplink {
  originalUrl: string;
  shortenUrl: string;
  landingUrl: string;
}

const PARTNERS_HOST = "https://api-gateway.coupang.com";
const DEEPLINK_PATH = "/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink";
/** 한 번 요청에 보낼 URL 수. 묶음 구매는 이 단위로 나눠 보낸다 */
const DEEPLINK_BATCH = 20;

/** yyMMdd'T'HHmmss'Z' (GMT) */
function signedDate(now: Date): string {
  return now.toISOString().slice(2, 19).replace(/[-:]/g, "") + "Z";
}

/** 쿠팡 파트너스 HMAC 인증 헤더 */
export function partnersAuthorization(
  method: string,
  pathWithQuery: string,
  creds: PartnersCredentials,
  now: Date = new Date(),
): string {
  const [path, query = ""] = pathWithQuery.split("?");
  const date = signedDate(now);
  const signature = createHmac("sha256", creds.secretKey)
    .update(date + method + path + query)
    .digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${creds.accessKey}, signed-date=${date}, signature=${signature}`;
}

/** 일반 쿠팡 링크들을 파트너스 링크로 바꾼다. 입력 순서대로 돌려준다 */
export async function createDeeplinks(
  urls: string[],
  creds: PartnersCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<Deeplink[]> {
  const out: Deeplink[] = [];
  for (let i = 0; i < urls.length; i += DEEPLINK_BATCH) {
    const batch = urls.slice(i, i + DEEPLINK_BATCH);
    const res = await fetchImpl(PARTNERS_HOST + DEEPLINK_PATH, {
      method: "POST",
      headers: {
        Authorization: partnersAuthorization("POST", DEEPLINK_PATH, creds),
        "Content-Type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify({ coupangUrls: batch }),
    });
    const body = (await res.json()) as { rCode?: string; rMessage?: string; data?: Deeplink[] };
    if (!res.ok || body.rCode !== "0" || !body.data) {
      throw new Error(`쿠팡 파트너스 링크 생성 실패 (${res.status}): ${body.rMessage ?? "알 수 없는 오류"}`);
    }
    out.push(...body.data);
  }
  return out;
}

export interface CoupangProduct {
  productId: number;
  productName: string;
  productPrice: number;
  productImage: string;
  /** 이미 파트너스 추적이 붙은 구매 링크 */
  productUrl: string;
  isRocket: boolean;
}

const SEARCH_PATH = "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search";

/** 쿠팡 검색 API는 keyword가 50자를 넘으면 거절한다 */
export const SEARCH_KEYWORD_MAX = 50;

/**
 * 책 검색어. "제목 저자 원서"가 50자를 넘으면 저자 → "원서" 순으로 빼고,
 * 제목만으로도 넘으면 단어 단위로 자른다. 매칭은 제목 기준이라 제목을 가장 오래 남긴다.
 */
export function bookSearchKeyword(title: string, author: string): string {
  const candidates = [`${title} ${author} 원서`, `${title} 원서`, title];
  const fit = candidates.find((k) => k.length <= SEARCH_KEYWORD_MAX);
  if (fit) return fit;
  let cut = "";
  for (const word of title.split(/\s+/)) {
    const next = cut ? `${cut} ${word}` : word;
    if (next.length > SEARCH_KEYWORD_MAX) break;
    cut = next;
  }
  return cut || title.slice(0, SEARCH_KEYWORD_MAX);
}

/**
 * 못 찾았을 때 차례로 다시 써 볼 검색어. 긴 검색어는 쿠팡이 엉뚱한 상품(곰인형 등)을
 * 섞어 주는데, 제목 앞부분만 넣으면 그 책이 위로 올라온다 ("Brown Bear Brown Bear").
 */
export function bookSearchKeywords(title: string, author: string): string[] {
  const plain = title.replace(/[^\p{L}\p{N}']+/gu, " ").trim();
  const words = plain.split(" ");
  const head = words.slice(0, Math.max(2, Math.ceil(words.length / 2))).join(" ");
  const tries = [bookSearchKeyword(title, author), plain, head].filter((k) => k.length <= SEARCH_KEYWORD_MAX);
  return [...new Set(tries)];
}

const ARTICLES = new Set(["the", "a", "an"]);
/** 영문 단어만 (관사·숫자 제외). 한글 설명이나 상품코드는 매칭에 쓰지 않는다 */
const titleWords = (s: string) =>
  (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !ARTICLES.has(w) && !/^\d+$/.test(w));

/**
 * 검색 결과에서 그 책 자체인 상품을 고른다. 번역본을 피하려고 영문 제목 기준.
 * - 제목 단어가 (거의) 다 들어 있어야 한다: "Polar Bear…"는 "Brown Bear…"가 아니다
 * - 상품명이 제목 첫 단어로 시작해야 한다: "Boo! from The Very Hungry Caterpillar" 같은 스핀오프 제외
 * - 그중 제목에 없는 단어가 가장 적은 상품
 * 맞는 게 없으면 null (틀린 링크보다 직접 붙여넣는 게 낫다).
 */
export function bestProductMatch<P extends { productName: string }>(title: string, products: P[]): P | null {
  const want = titleWords(title);
  const wantSet = new Set(want);
  if (wantSet.size === 0) return null;
  let best: P | null = null;
  let bestExtra = Infinity;
  for (const p of products) {
    const have = titleWords(p.productName);
    if (have[0] !== want[0]) continue;
    const haveSet = new Set(have);
    const coverage = [...wantSet].filter((w) => haveSet.has(w)).length / wantSet.size;
    if (coverage < 0.9) continue;
    const extra = [...haveSet].filter((w) => !wantSet.has(w)).length;
    if (extra < bestExtra) [best, bestExtra] = [p, extra];
  }
  return best;
}

/**
 * 쿠팡 파트너스 상품 검색. 쿠팡 웹페이지를 긁는 대신 이 API로 실제 상품 ID와
 * 구매 링크를 받아온다. 검색 API는 호출 횟수 제한이 빡빡하니 카탈로그 채울 때만 쓴다.
 */
export async function searchProducts(
  keyword: string,
  creds: PartnersCredentials,
  limit = 5,
  fetchImpl: typeof fetch = fetch,
): Promise<CoupangProduct[]> {
  const query = new URLSearchParams({ keyword, limit: String(limit) }).toString();
  const pathWithQuery = `${SEARCH_PATH}?${query}`;
  const res = await fetchImpl(PARTNERS_HOST + pathWithQuery, {
    headers: { Authorization: partnersAuthorization("GET", pathWithQuery, creds) },
  });
  const body = (await res.json()) as {
    rCode?: string;
    rMessage?: string;
    data?: { productData?: CoupangProduct[] };
  };
  if (!res.ok || body.rCode !== "0") {
    throw new Error(`쿠팡 상품 검색 실패 (${res.status}): ${body.rMessage ?? "알 수 없는 오류"}`);
  }
  return body.data?.productData ?? [];
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): PartnersCredentials | null {
  const accessKey = env.COUPANG_ACCESS_KEY;
  const secretKey = env.COUPANG_SECRET_KEY;
  return accessKey && secretKey ? { accessKey, secretKey } : null;
}
