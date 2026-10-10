// 추천 묶음: 상황별 · 테마별 · 레벨별 · 문학상별.
// 상황별은 편집자가 직접 고르고, 나머지는 카탈로그 데이터에서 자동으로 만든다.

import { K_LEVELS, estimateLevel, type LevelResult } from "../levels/index.ts";
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

/** 읽어주기 그림책은 지수와 상관없이 K-레벨 0(듣기)로 본다 */
export function bookLevel(book: Book): LevelResult {
  const result = estimateLevel(book);
  if (!book.readAloud) return result;
  return {
    ...result,
    level: K_LEVELS[0],
    mode: "listen",
    warnings: result.mode === "listen" ? result.warnings : [
      ...result.warnings,
      "엄마가 읽어주는 그림책이에요. 아이 혼자 읽기 레벨과는 따로 봐주세요.",
    ],
  };
}

const SITUATIONS: Collection[] = [
  {
    id: "situation-bedtime",
    kind: "situation",
    title: "잠들기 전 10분",
    description: "목소리를 낮추고 천천히 읽어주기 좋은 잔잔한 책",
    bookIds: ["goodnight-moon", "llama-red-pajama", "owl-moon"],
  },
  {
    id: "situation-new-school",
    kind: "situation",
    title: "새 학기·첫 등원 앞두고",
    description: "엄마와 떨어지는 불안, 새 친구를 만나는 설렘을 다룬 책",
    bookIds: ["kissing-hand", "officer-buckle", "junie-b-jones", "new-kid", "wonder"],
  },
  {
    id: "situation-big-feelings",
    kind: "situation",
    title: "화나고 속상한 날",
    description: "감정을 이름 붙이고 스스로 가라앉히는 과정을 보여주는 책",
    bookIds: ["sophie-angry", "where-the-wild-things-are", "wonder"],
  },
  {
    id: "situation-refuses-english",
    kind: "situation",
    title: "영어책 싫다고 할 때",
    description: "웃음이 먼저 터지는 책으로 '영어책 = 재미'를 다시 만들기",
    bookIds: ["pigeon-bus", "we-are-in-a-book", "hi-fly-guy", "dog-man", "horrid-henry", "wimpy-kid"],
  },
  {
    id: "situation-series-binge",
    kind: "situation",
    title: "방학·긴 여행에 몰입할 시리즈",
    description: "첫 권이 재미있으면 다음 권을 스스로 찾게 되는 시리즈 첫 권",
    bookIds: ["dinosaurs-before-dark", "nate-the-great", "absent-author", "harry-potter-1"],
  },
];

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
};

const AWARD_DESCRIPTIONS: Record<Award, string> = {
  칼데콧: "미국에서 그해 가장 뛰어난 그림책 그림에 주는 상",
  뉴베리: "미국에서 그해 가장 뛰어난 어린이 문학에 주는 상",
  가이젤: "막 읽기 시작한 아이를 위한 최고의 리더스북에 주는 상",
};

function themeCollections(): Collection[] {
  return Object.entries(THEME_DESCRIPTIONS).map(([theme, description]) => ({
    id: `theme-${theme}`,
    kind: "theme" as const,
    title: theme,
    description,
    bookIds: BOOKS.filter((b) => b.themes?.includes(theme)).map((b) => b.id),
  }));
}

function levelCollections(): Collection[] {
  return K_LEVELS.map((l) => ({
    id: `level-${l.level}`,
    kind: "level" as const,
    title: `K-레벨 ${l.level} · ${l.name}`,
    description: l.headline,
    bookIds: BOOKS.filter((b) => bookLevel(b).level.level === l.level).map((b) => b.id),
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
  return [...SITUATIONS, ...themeCollections(), ...levelCollections(), ...awardCollections()].filter(
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
