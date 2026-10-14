// 책 한 권의 지수들을 모아 K-레벨을 정하고, 우리 아이에게 맞는지 판정한다.

import { K_LEVELS, STAGE_LABEL, getLevel, type KLevel } from "./levels.ts";
import {
  INTEREST_LEVEL_INFO,
  LEXILE_CODE_LABEL,
  describeAr,
  lexileToAr,
  parseLexile,
  type InterestLevel,
} from "./indices.ts";

export interface BookIndices {
  ar?: number;
  lexile?: string | number;
  interestLevel?: InterestLevel;
  wordCount?: number;
}

export interface LevelResult {
  level: KLevel;
  /** listen: 엄마가 읽어주는 책, read: 아이가 읽는 책 */
  mode: "listen" | "read";
  /** 어떤 지수로 판정했는지 */
  basis: "ar" | "lexile" | "wordCount" | "manual" | "none";
  /** 엄마에게 보여줄 설명 */
  explanations: string[];
  warnings: string[];
}

function levelFromAr(ar: number): KLevel {
  if (ar <= 0) return getLevel(0);
  for (const l of K_LEVELS) {
    if (l.level > 0 && ar >= l.ar.min && ar < l.ar.max) return l;
  }
  return getLevel(10);
}

/** 단어 수만 알 때의 대략적 판정. 지수가 없는 책을 위한 마지막 수단 */
function levelFromWordCount(words: number): KLevel {
  if (words < 150) return getLevel(1);
  if (words < 500) return getLevel(2);
  if (words < 1500) return getLevel(3);
  if (words < 4000) return getLevel(4);
  if (words < 8000) return getLevel(5);
  if (words < 15000) return getLevel(6);
  if (words < 25000) return getLevel(7);
  if (words < 50000) return getLevel(8);
  if (words < 90000) return getLevel(9);
  return getLevel(10);
}

/**
 * 판정 우선순위: AR → 렉사일 → 단어 수.
 * AR을 우선하는 이유: 한국 엄마들 사이에서 가장 많이 쓰이고, 학년 단위라 설명하기 쉽다.
 */
export function estimateLevel(book: BookIndices): LevelResult {
  const explanations: string[] = [];
  const warnings: string[] = [];
  const lexile = book.lexile != null ? parseLexile(book.lexile) : null;

  let level: KLevel;
  let basis: LevelResult["basis"];
  if (book.ar != null) {
    level = levelFromAr(book.ar);
    basis = "ar";
  } else if (lexile?.value != null) {
    level = levelFromAr(lexileToAr(lexile.value));
    basis = "lexile";
  } else if (book.wordCount != null) {
    level = levelFromWordCount(book.wordCount);
    basis = "wordCount";
    warnings.push("AR·렉사일 지수가 없어 글자 수로만 추정한 레벨이에요.");
  } else {
    level = getLevel(0);
    basis = "none";
    warnings.push("지수 정보가 없어요. 직접 펼쳐보고 판단해 주세요.");
  }

  if (book.ar != null) explanations.push(`AR ${book.ar}: ${describeAr(book.ar)}`);
  if (lexile?.code) explanations.push(`렉사일 ${lexile.code}: ${LEXILE_CODE_LABEL[lexile.code]}`);

  // AD(읽어주기용) 그림책은 지수가 높아도 "듣기 책"이다. 아이 읽기 레벨과 비교하면 안 된다.
  const mode: LevelResult["mode"] = lexile?.code === "AD" ? "listen" : "read";
  if (mode === "listen") {
    warnings.push(
      `읽어주기용 그림책이에요. 레벨 ${level.level}은 '듣고 이해하는' 수준이고, 혼자 읽기용으로는 어려워요.`,
    );
  }

  if (book.ar != null && lexile?.value != null) {
    const fromLexile = levelFromAr(lexileToAr(lexile.value));
    if (Math.abs(fromLexile.level - level.level) >= 2) {
      warnings.push(
        `AR과 렉사일이 말하는 난이도가 달라요(AR 기준 ${level.level}레벨, 렉사일 기준 ${fromLexile.level}레벨). ` +
          "문장은 길지만 단어는 쉬운 책처럼 두 지수가 다르게 보는 경우예요. 실제 아이 반응을 우선해 주세요.",
      );
    }
  }

  if (lexile?.code === "GN") {
    warnings.push("그래픽노블이라 그림이 이해를 많이 도와줘요. 글만 있는 책보다 한 단계 쉽게 느껴질 수 있어요.");
  }

  explanations.push(`K-레벨 ${level.level} '${level.name}': ${level.headline}`);
  explanations.push(`글밥: ${level.textDensity}`);
  if (level.level > 0) explanations.push(`아이 모습: ${STAGE_LABEL[level.stage]}`);

  return { level, mode, basis, explanations, warnings };
}

export interface ChildProfile {
  /** 만 나이 */
  age: number;
  /** 아이의 현재 K-레벨. 모르면 monthsAfterPhonics로 추정 */
  level?: number;
  /** 파닉스를 뗀 뒤 지난 개월 수. 아직이면 null */
  monthsAfterPhonics?: number | null;
}

/** 파닉스 개월 수로 아이 레벨 추정(꾸준히 읽은 아이 기준 출발값) */
export function levelFromPhonicsMonths(months: number | null | undefined): number {
  if (months == null) return 0;
  // 개월 범위가 겹치는 레벨이 있으면 낮은 쪽으로 잡는다: 쉬운 책이 성공 경험을 준다.
  for (const l of K_LEVELS) {
    if (l.level < 2) continue;
    const max = l.monthsAfterPhonics.max ?? Infinity;
    if (months >= l.monthsAfterPhonics.min && months < max) return l.level;
  }
  return 10;
}

export type Fit = "술술" | "딱 맞음" | "도전" | "어려움" | "읽어주기";

export interface FitResult {
  fit: Fit;
  message: string;
  warnings: string[];
}

/**
 * 아이 레벨 대비 책 레벨:
 * -1 이하: 술술(다독·자신감용) / 같음: 딱 맞음(혼자 읽기) / +1: 도전(엄마와 함께) / +2 이상: 어려움
 */
export function fitForChild(child: ChildProfile, book: BookIndices): FitResult {
  const result = estimateLevel(book);
  const childLevel = child.level ?? levelFromPhonicsMonths(child.monthsAfterPhonics);
  const warnings = [...result.warnings];

  if (book.interestLevel) {
    const il = INTEREST_LEVEL_INFO[book.interestLevel];
    if (child.age < il.minKoreanAge) {
      warnings.push(
        `내용 적정 나이 주의: ${il.label}이에요. 영어 실력으로는 읽을 수 있어도 내용이 아이 나이보다 성숙할 수 있어요.`,
      );
    }
  }

  if (result.mode === "listen") {
    return { fit: "읽어주기", message: "엄마가 읽어주기 좋은 책이에요.", warnings };
  }

  const diff = result.level.level - childLevel;
  let fit: Fit;
  let message: string;
  if (diff <= -1) {
    fit = "술술";
    message = "쉽게 읽혀요. 다독과 자신감 쌓기에 좋아요.";
  } else if (diff === 0) {
    fit = "딱 맞음";
    message = "지금 아이가 혼자 읽기 딱 좋은 책이에요.";
  } else if (diff === 1) {
    fit = "도전";
    message = "살짝 어려워요. 엄마와 함께 읽거나 오디오북과 같이 보세요.";
  } else {
    fit = "어려움";
    message = "아직 어려워요. 지금은 읽어주거나 나중을 위해 아껴두세요.";
  }
  return { fit, message, warnings };
}
