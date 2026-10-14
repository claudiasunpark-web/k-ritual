// Open Library에서 받은 보조 정보(영문 줄거리·주제). scripts/fetch-book-info.ts가 data/book-info.json을 채운다.
// 시트의 '테마' 칸은 사람이 고른 테마이고, 여기서 나온 테마는 비어 있는 부분을 보충한다.

import { existsSync, readFileSync } from "node:fs";

export interface BookInfo {
  found: boolean;
  olKey?: string;
  /** 영문 짧은 줄거리 */
  summary?: string;
  /** Open Library subject 원문 */
  subjects?: string[];
}

/**
 * 영문 주제어 → 카탈로그 테마. 단어 경계로 찾는다.
 * 'Juvenile fiction'처럼 어디에나 붙는 말은 넣지 않는다.
 */
const SUBJECT_THEMES: [string, RegExp][] = [
  ["공룡", /\bdinosaurs?\b|\bprehistoric\b/],
  ["동물", /\banimals?\b|\bpets?\b|\bdogs?\b|\bcats?\b|\bkittens?\b|\bpupp(y|ies)\b|\bpigs?\b|\bbears?\b|\brabbits?\b|\bfrogs?\b|\btoads?\b|\bowls?\b|\bmice\b|\bmouse\b|\belephants?\b|\bhorses?\b|\bponies\b|\bpenguins?\b|\bbirds?\b|\bfish(es)?\b|\bmonkeys?\b|\bfoxes\b|\bgoats?\b|\bducks?\b|\bnarwhal\b|\bjellyfish/],
  ["우정", /\bfriendship\b|\bfriends\b|\bbest friends\b/],
  ["유머", /\bhumor(ous)?\b|\bhumour\b|\bjokes\b|\bfunny\b/],
  ["가족", /\bfamil(y|ies)\b|\bbrothers?\b|\bsisters?\b|\bsiblings?\b|\bmothers?\b|\bfathers?\b|\bgrandparents?\b|\bgrandmothers?\b|\bgrandfathers?\b|\bbabies\b/],
  ["모험", /\badventure|\bsurvival\b/],
  ["미스터리", /\bmyster(y|ies)\b|\bdetectives?\b|\bsleuths?\b/],
  ["자연", /\bnature\b|\bseasons\b|\bweather\b|\bplants\b|\bgardens?\b|\bgardening\b|\bwilderness\b|\bsnow\b|\bwinter\b|\bspring\b|\bautumn\b|\bocean\b|\bsea\b/],
  ["판타지", /\bmagic\b|\bfantasy\b|\bfair(y|ies)\b|\bwizards?\b|\bwitch(es)?\b|\bdragons?\b|\bunicorns?\b|\bmermaids?\b|\btime travel\b|\bmonsters?\b/],
  ["새 학기", /\bschools?\b|\bteachers?\b|\bkindergarten\b|\bclassroom\b|\bfirst day\b/],
  ["역사", /\bhistory\b|\bhistorical\b|\bmiddle ages\b|\bancient\b|\bwar\b/],
  ["과학", /\bscience\b|\bscientists?\b|\bspace\b|\binventions?\b|\brobots?\b|\bastronom/],
  ["감정", /\bemotions?\b|\bfeelings?\b|\bfear\b|\banger\b|\bsadness\b|\bjealousy\b|\bself-esteem\b|\bworry\b/],
];

/** 외국어판·형식 표기 같은 주제는 버린다 */
const NOISE = /science fiction|sci[- ]fi|school subject|key stage|study and teaching|examinations|comic books|graphic novels|reading level|language materials|translations|large type|readers \(|reading \(|nyt:|accessible book|protected daisy|in library|open library|staff picks|^fiction$|juvenile (fiction|literature)|children's (fiction|stories)|stories in rhyme|^english language/i;

/**
 * Open Library 주제는 여러 판본의 주제가 섞여 있어 한 번 스친 단어는 믿기 어렵다.
 * 주제가 많은 책은 같은 테마에 걸리는 주제가 두 개 이상일 때만 쓴다.
 */
export function themesFromSubjects(subjects: readonly string[]): string[] {
  const clean = subjects.filter((s) => !NOISE.test(s)).map((s) => s.toLowerCase());
  const need = clean.length > 10 ? 2 : 1;
  return SUBJECT_THEMES.filter(([, re]) => clean.filter((s) => re.test(s)).length >= need).map(([theme]) => theme);
}

const FILE = new URL("../../data/book-info.json", import.meta.url);
export const BOOK_INFO: Readonly<Record<string, BookInfo>> = existsSync(FILE)
  ? JSON.parse(readFileSync(FILE, "utf8"))
  : {};

/** 서평 인용("...", Kirkus 등)이나 너무 짧은 설명은 줄거리로 쓰지 않는다 */
export function usableSummary(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const summary = raw.replace(/\*+/g, "").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
  if (summary.length < 50 || /^["“'‘]/.test(summary) || /["”]\s*[-–—]{1,2}\s*[A-Z]/.test(summary)) return undefined;
  if (/\b(Kirkus|Publishers Weekly|School Library Journal|Booklist|Horn Book|starred review)\b/i.test(summary)) return undefined;
  return summary;
}
