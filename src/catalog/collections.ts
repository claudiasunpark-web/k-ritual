// 추천 묶음: 상황별 · 테마별 · 레벨별 · 문학상별.
// 모두 카탈로그 시트의 '상황', '테마', AR/레벨, '문학상' 칸에서 자동으로 만든다.

import { K_LEVELS, STAGE_LABEL, estimateLevel, getLevel, type LevelResult } from "../levels/index.ts";
import { BOOKS, getBook, type Award, type Book } from "./books.ts";

export type CollectionKind = "situation" | "theme" | "level" | "award";

export interface Collection {
  id: string;
  kind: CollectionKind;
  title: string;
  description: string;
  bookIds: string[];
}

export const COLLECTION_KIND_LABEL: Record<CollectionKind, string> = {
  situation: "상황별",
  theme: "테마별",
  level: "레벨별",
  award: "문학상별",
};

/**
 * 책 한 권(또는 시리즈)의 K-레벨.
 * - 읽어주기 그림책은 지수와 상관없이 레벨 0(듣기). 혼자 읽기 기준 경고는 빼준다.
 * - AR이 없고 시트에 레벨을 직접 적었으면 그 레벨.
 * - 시리즈는 AR최소(시작 레벨) 기준.
 * - 아무 지수도 없으면 basis가 "none": 화면에서는 '레벨 확인 중'으로 보인다.
 */
export function bookLevel(book: Book): LevelResult {
  if (book.readAloud) {
    return { ...estimateLevel(book), level: K_LEVELS[0], mode: "listen", warnings: [] };
  }
  if (book.ar == null && book.lexile == null && book.manualLevel != null) {
    const level = getLevel(book.manualLevel);
    return {
      level,
      mode: "read",
      basis: "manual",
      explanations: [`시크릿 북레벨 ${level.level} '${level.name}': ${level.headline}`, `아이 모습: ${STAGE_LABEL[level.stage]}`],
      warnings: [],
    };
  }
  return estimateLevel(book);
}

/** 레벨을 정할 근거가 있는지 */
export function isRated(book: Book): boolean {
  return bookLevel(book).basis !== "none";
}

/** 시트의 '상황' 칸 값 → 화면 제목과 설명. 여기 없는 값은 그대로 제목이 된다 */
const SITUATION_INFO: Record<string, { title: string; description: string }> = {
  잠자리: { title: "잠들기 전 10분", description: "목소리를 낮추고 천천히 읽어주기 좋은 잔잔한 책" },
  "새 학기": { title: "새 학기·첫 등원 앞두고", description: "엄마와 떨어지는 불안, 새 친구를 만나는 설렘을 다룬 책" },
  "화난 날": { title: "화나고 속상한 날", description: "감정을 이름 붙이고 스스로 가라앉히는 과정을 보여주는 책" },
  "영어 거부": { title: "영어책 싫다고 할 때", description: "웃음이 먼저 터지는 책으로 '영어책 = 재미'를 다시 만들기" },
  "시리즈 몰입": { title: "방학·긴 여행에 몰입할 시리즈", description: "첫 권이 재미있으면 다음 권을 스스로 찾게 되는 시리즈" },
};

const THEME_DESCRIPTIONS: Record<string, string> = {
  동물: "동물 친구가 주인공인 책",
  공룡: "공룡 좋아하는 아이를 위한 책",
  우정: "친구와 다투고 화해하고 함께 크는 이야기",
  유머: "깔깔 웃으며 읽는 책",
  가족: "엄마·아빠·형제와의 이야기",
  모험: "떠나고 부딪히고 해내는 이야기",
  미스터리: "단서를 따라가는 탐정 이야기",
  자연: "계절과 자연을 느끼는 책",
  판타지: "마법과 다른 세계 이야기",
  "새 학기": "학교와 유치원 이야기",
  역사: "옛날 이야기와 실제 역사",
  과학: "궁금한 걸 알아가는 책",
  지식: "논픽션·지식 책",
  감정: "마음을 들여다보는 책",
};

/** 레벨 낮은 책부터. 레벨 확인 중인 책은 맨 뒤 */
function byLevel(a: Book, b: Book): number {
  const la = bookLevel(a);
  const lb = bookLevel(b);
  const ka = la.basis === "none" ? 99 : la.level.level;
  const kb = lb.basis === "none" ? 99 : lb.level.level;
  return ka - kb || (a.ar ?? 0) - (b.ar ?? 0);
}

/** 값별로 묶기. 처음 나온 순서를 지키되 known 순서를 앞에 둔다 */
function groupBy(pick: (b: Book) => string[] | undefined, known: string[]): Map<string, Book[]> {
  const groups = new Map<string, Book[]>(known.map((k) => [k, []]));
  for (const b of BOOKS) {
    for (const v of pick(b) ?? []) {
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(b);
    }
  }
  return groups;
}

function situationCollections(): Collection[] {
  return [...groupBy((b) => b.situations, Object.keys(SITUATION_INFO))].map(([name, books]) => ({
    id: `situation-${name}`,
    kind: "situation" as const,
    title: SITUATION_INFO[name]?.title ?? name,
    description: SITUATION_INFO[name]?.description ?? "",
    bookIds: books.sort(byLevel).map((b) => b.id),
  }));
}

/** 시리즈 id → 그 시리즈의 낱권들 (시트 순서) */
export function seriesBooks(): Map<string, Book[]> {
  const map = new Map<string, Book[]>();
  for (const b of BOOKS) {
    if (!b.seriesId) continue;
    if (!map.has(b.seriesId)) map.set(b.seriesId, []);
    map.get(b.seriesId)!.push(b);
  }
  return map;
}

/**
 * 테마별 묶음에서 시리즈는 대표 카드 하나로 보인다(낱권은 시리즈를 눌러서 본다).
 * 시리즈 카드의 테마는 시리즈 테마 + 낱권 테마를 합친 것.
 */
function themesForCard(b: Book, children: Map<string, Book[]>): string[] | undefined {
  if (b.seriesId) return undefined;
  if (!b.isSeries) return allThemes(b);
  const all = new Set(allThemes(b));
  for (const c of children.get(b.id) ?? []) for (const t of allThemes(c)) all.add(t);
  return [...all];
}

/** 시트 테마 + Open Library에서 뽑은 테마 */
export function allThemes(b: Book): string[] {
  return [...(b.themes ?? []), ...(b.autoThemes ?? [])];
}

function themeCollections(): Collection[] {
  const children = seriesBooks();
  return [...groupBy((b) => themesForCard(b, children), Object.keys(THEME_DESCRIPTIONS))].map(([theme, books]) => ({
    id: `theme-${theme}`,
    kind: "theme" as const,
    title: theme,
    description: THEME_DESCRIPTIONS[theme] ?? "",
    bookIds: books.sort(byLevel).map((b) => b.id),
  }));
}

const AWARD_DESCRIPTIONS: Record<Award, string> = {
  칼데콧: "미국에서 그해 가장 뛰어난 그림책 그림에 주는 상",
  뉴베리: "미국에서 그해 가장 뛰어난 어린이 문학에 주는 상",
  가이젤: "막 읽기 시작한 아이를 위한 최고의 리더스북에 주는 상",
};

function levelCollections(): Collection[] {
  return K_LEVELS.map((l) => ({
    id: `level-${l.level}`,
    kind: "level" as const,
    title: `시크릿 북레벨 ${l.level}`,
    description: l.headline,
    // 시리즈 낱권은 시리즈 카드(시작 레벨) 안에서 본다
    bookIds: BOOKS.filter((b) => !b.seriesId && isRated(b) && bookLevel(b).level.level === l.level).map((b) => b.id),
  }));
}

function awardCollections(): Collection[] {
  return (Object.keys(AWARD_DESCRIPTIONS) as Award[]).map((award) => ({
    id: `award-${award}`,
    kind: "award" as const,
    title: `${award}상`,
    description: AWARD_DESCRIPTIONS[award],
    // 최근 수상작부터
    bookIds: BOOKS.filter((b) => b.awards?.some((a) => a.award === award))
      .sort((a, b) => latestYear(b, award) - latestYear(a, award))
      .map((b) => b.id),
  }));
}

function latestYear(book: Book, award: Award): number {
  return Math.max(...(book.awards ?? []).filter((a) => a.award === award).map((a) => a.year));
}

/** 책이 한 권도 없는 묶음은 보여주지 않는다 */
export function allCollections(): Collection[] {
  return [...situationCollections(), ...themeCollections(), ...levelCollections(), ...awardCollections()].filter(
    (c) => c.bookIds.length > 0,
  );
}

export function collectionsByKind(kind: CollectionKind): Collection[] {
  return allCollections().filter((c) => c.kind === kind);
}

export function getCollection(id: string): Collection {
  const found = allCollections().find((c) => c.id === id);
  if (!found) throw new RangeError(`없는 추천 묶음이에요: ${id}`);
  return found;
}

export function collectionBooks(collection: Collection): Book[] {
  return collection.bookIds.map(getBook);
}
