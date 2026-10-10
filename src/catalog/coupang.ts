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
  return coupangSearchUrl(ref?.query ?? `${book.title} ${book.author} 원서`);
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
