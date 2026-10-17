// 문제집 추천: 파닉스·보캡·그래머·리딩(독해) 문제집을 시크릿 북레벨 범위에 맞춰 보여준다.
// 데이터는 data/workbooks.csv(구글 시트 '문제집')에 있다. 레벨 범위는 모두 근사값이다.

import { readFileSync } from "node:fs";
import { CatalogError } from "./sheet.ts";
import { coupangSearchUrl } from "./coupang.ts";
import { parseCsvRecords } from "./csv.ts";

export const WORKBOOK_KINDS = ["파닉스", "사이트워드", "보캡", "그래머", "리딩"] as const;
export type WorkbookKind = (typeof WORKBOOK_KINDS)[number];

export interface Workbook {
  id: string;
  title: string;
  publisher: string;
  kind: WorkbookKind;
  levelMin: number;
  levelMax: number;
  description: string;
  url: string;
}

export function parseWorkbooks(csv: string): { workbooks: Workbook[]; problems: string[] } {
  const problems: string[] = [];
  const workbooks = parseCsvRecords(csv).map((r, i) => {
    const where = `문제집 ${i + 2}행`;
    const level = (col: string) => {
      const n = Number(r[col]);
      if (r[col] === "" || !Number.isInteger(n) || n < 0 || n > 10) problems.push(`${where} '${col}': 0~10 정수로 적어주세요`);
      return n;
    };
    if (!r["제목"]) problems.push(`${where} '제목': 비어 있어요`);
    if (!(WORKBOOK_KINDS as readonly string[]).includes(r["종류"])) {
      problems.push(`${where} '종류': ${WORKBOOK_KINDS.join(", ")} 중 하나예요`);
    }
    const levelMin = level("레벨최소");
    const levelMax = level("레벨최대");
    if (levelMax < levelMin) problems.push(`${where} '레벨최대': 레벨최소보다 작아요`);
    const link = r["쿠팡링크"];
    if (link && !/^https:\/\/(link\.coupang\.com|www\.coupang\.com|coupa\.ng)\//.test(link)) {
      problems.push(`${where} '쿠팡링크': 쿠팡 링크여야 해요`);
    }
    return {
      id: r["id"] || r["제목"],
      title: r["제목"],
      publisher: r["출판사"],
      kind: r["종류"] as WorkbookKind,
      levelMin,
      levelMax,
      description: r["설명"],
      url: link || coupangSearchUrl(r["제목"]),
    };
  });
  return { workbooks, problems };
}

function load(): Workbook[] {
  const { workbooks, problems } = parseWorkbooks(
    readFileSync(new URL("../../data/workbooks.csv", import.meta.url), "utf8"),
  );
  if (problems.length) throw new CatalogError(problems);
  return workbooks;
}

export const WORKBOOKS: readonly Workbook[] = load();

/** 이 레벨 아이에게 맞는 문제집. 종류 순서(파닉스 → 그래머)대로 */
export function workbooksForLevel(level: number): Workbook[] {
  return WORKBOOKS.filter((w) => level >= w.levelMin && level <= w.levelMax).sort(
    (a, b) => WORKBOOK_KINDS.indexOf(a.kind) - WORKBOOK_KINDS.indexOf(b.kind),
  );
}
