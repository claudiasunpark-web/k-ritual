// 구글 시트(CSV) 한 줄 → 카탈로그 항목.
// 시트를 고치는 사람이 실수해도 어디가 틀렸는지 알 수 있게, 틀린 칸을 모두 모아 한국어로 알려준다.

import { estimateLevel, parseLexile, type InterestLevel } from "../levels/index.ts";
import type { Award, AwardInfo, Book } from "./books.ts";
import { parseCsvRecords } from "./csv.ts";

export const BOOK_COLUMNS = [
  "id", "제목", "저자", "유형", "시리즈", "AR", "렉사일", "IL", "레벨", "읽어주기",
  "지수확인", "테마", "상황", "문학상", "쿠팡링크", "가격", "메모",
] as const;

export const SERIES_COLUMNS = [
  "id", "시리즈명", "저자", "유형", "권수", "AR최소", "AR최대", "IL", "레벨", "읽어주기",
  "지수확인", "테마", "상황", "쿠팡링크", "가격", "메모",
] as const;

export type SheetKind = "books" | "series";

export class CatalogError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`카탈로그 시트에 고칠 곳이 ${problems.length}개 있어요:\n` + problems.map((p) => `  - ${p}`).join("\n"));
    this.problems = problems;
  }
}

const AWARDS: readonly Award[] = ["칼데콧", "뉴베리", "가이젤"];
const IL_VALUES: readonly InterestLevel[] = ["LG", "MG", "MG+", "UG"];

/** 제목으로 id 만들기. 시트에서 id 칸을 비워두면 이걸 쓴다 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const list = (v: string) => v.split(/[;；]/).map((s) => s.trim()).filter(Boolean);

function parseRows(kind: SheetKind, text: string, problems: string[]): Book[] {
  const records = parseCsvRecords(text);
  const sheet = kind === "books" ? "낱권" : "시리즈";
  const columns: readonly string[] = kind === "books" ? BOOK_COLUMNS : SERIES_COLUMNS;
  const header = Object.keys(records[0] ?? {});
  const missing = columns.filter((c) => records.length > 0 && !header.includes(c));
  if (missing.length) problems.push(`${sheet} 시트에 열이 없어요: ${missing.join(", ")}`);

  return records.map((r, i) => {
    // 시트 1행은 머리글이라 실제 행 번호는 +2
    const where = `${sheet} ${i + 2}행`;
    const bad = (col: string, msg: string) => problems.push(`${where} '${col}': ${msg}`);

    const num = (col: string, min: number, max: number): number | undefined => {
      const v = (r[col] ?? "").replace(/,/g, "");
      if (!v) return undefined;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        bad(col, `${min}~${max} 사이 숫자여야 해요 (지금: "${r[col]}")`);
        return undefined;
      }
      return n;
    };
    const yesNo = (col: string): boolean => {
      const v = (r[col] ?? "").toUpperCase();
      if (v && v !== "Y" && v !== "N") bad(col, `Y 또는 N으로 적어주세요 (지금: "${r[col]}")`);
      return v === "Y";
    };

    const title = kind === "books" ? r["제목"] : r["시리즈명"];
    if (!title) bad(kind === "books" ? "제목" : "시리즈명", "비어 있어요");
    if (!r["저자"]) bad("저자", "비어 있어요");

    const id = r["id"] || (kind === "series" ? "series-" : "") + slugify(title ?? "");

    const ar = num(kind === "books" ? "AR" : "AR최소", 0, 13);
    const arMax = kind === "series" ? num("AR최대", 0, 13) : undefined;
    if (ar != null && arMax != null && arMax < ar) bad("AR최대", "AR최소보다 작아요");

    let lexile: string | undefined;
    if (kind === "books" && r["렉사일"]) {
      try {
        parseLexile(r["렉사일"]);
        lexile = r["렉사일"];
      } catch {
        bad("렉사일", `"520L", "AD520L", "BR100L"처럼 적어주세요 (지금: "${r["렉사일"]}")`);
      }
    }

    let interestLevel: InterestLevel | undefined;
    if (r["IL"]) {
      if ((IL_VALUES as readonly string[]).includes(r["IL"])) interestLevel = r["IL"] as InterestLevel;
      else bad("IL", `LG, MG, MG+, UG 중 하나예요 (지금: "${r["IL"]}")`);
    }

    const level = num("레벨", 0, 10);
    if (level != null && !Number.isInteger(level)) bad("레벨", "0~10 정수로 적어주세요");

    const awards: AwardInfo[] = [];
    for (const a of list(r["문학상"] ?? "")) {
      const m = /^(\S+)\s+(\d{4})\s+(대상|아너)$/.exec(a);
      if (!m || !(AWARDS as readonly string[]).includes(m[1])) {
        bad("문학상", `"뉴베리 2020 대상", "칼데콧 2016 아너"처럼 적어주세요 (지금: "${a}")`);
        continue;
      }
      awards.push({ award: m[1] as Award, year: Number(m[2]), kind: m[3] === "대상" ? "medal" : "honor" });
    }

    const link = r["쿠팡링크"];
    if (link && !/^https:\/\/(link\.coupang\.com|www\.coupang\.com|coupa\.ng)\//.test(link)) {
      bad("쿠팡링크", `쿠팡 링크(https://link.coupang.com/...)여야 해요`);
    }

    const book: Book = {
      id,
      title: title ?? "",
      author: r["저자"] ?? "",
      indicesVerified: yesNo("지수확인"),
    };
    const set = <K extends keyof Book>(k: K, v: Book[K] | undefined) => {
      if (v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) book[k] = v;
    };
    set("format", r["유형"]);
    set("readAloud", yesNo("읽어주기") || undefined);
    set("series", kind === "books" ? r["시리즈"] : undefined);
    set("isSeries", kind === "series" || undefined);
    set("ar", ar);
    set("arMax", arMax);
    set("bookCount", kind === "series" ? num("권수", 1, 10000) : undefined);
    set("lexile", lexile);
    set("interestLevel", interestLevel);
    set("manualLevel", level);
    set("themes", list(r["테마"] ?? ""));
    set("situations", list(r["상황"] ?? ""));
    set("awards", awards);
    set("priceKrw", num("가격", 0, 10_000_000));
    set("coupang", link ? { partnersUrl: link } : undefined);
    set("memo", r["메모"]);
    // '표지'는 선택 칸이라 시트에 없어도 된다
    const cover = r["표지"];
    if (cover && !/^https:\/\//.test(cover)) bad("표지", "https:// 로 시작하는 이미지 주소여야 해요");
    else set("coverUrl", cover);
    return book;
  });
}

/** 시트 두 장을 읽어 오류가 있으면 모두 모아 알려준다 */
export function validateCatalog(booksCsv: string, seriesCsv: string): { books: Book[]; problems: string[] } {
  const problems: string[] = [];
  const books = [...parseRows("books", booksCsv, problems), ...parseRows("series", seriesCsv, problems)];
  const seen = new Map<string, string>();
  for (const b of books) {
    const prev = seen.get(b.id);
    if (prev) problems.push(`id가 겹쳐요: "${b.id}" (${prev} / ${b.title})`);
    seen.set(b.id, b.title);
  }
  inheritFromSeries(books);
  return { books, problems };
}

/**
 * 낱권의 '시리즈' 칸이 시리즈 시트의 시리즈명과 같으면, 낱권에서 비어 있는 칸을 시리즈에서 채운다.
 * 레벨은 시리즈 AR최소로 정하고 근사로 표시한다(levelFromSeries).
 */
function inheritFromSeries(books: Book[]): void {
  const byName = new Map(books.filter((b) => b.isSeries).map((s) => [s.title, s]));
  for (const b of books) {
    if (b.isSeries || !b.series) continue;
    const s = byName.get(b.series);
    if (!s) continue;
    s.hasChildren = true;
    b.seriesId = s.id;
    b.seriesCount = s.bookCount;
    b.format ??= s.format;
    b.interestLevel ??= s.interestLevel;
    b.readAloud ??= s.readAloud;
    if (!b.themes?.length && s.themes?.length) b.themes = [...s.themes];
    if (b.ar == null && b.lexile == null && b.manualLevel == null && s.ar != null && !b.readAloud) {
      b.manualLevel = estimateLevel({ ar: s.ar }).level.level;
      b.levelFromSeries = true;
    }
  }
}

export function loadCatalog(booksCsv: string, seriesCsv: string): Book[] {
  const { books, problems } = validateCatalog(booksCsv, seriesCsv);
  if (problems.length) throw new CatalogError(problems);
  return books;
}
