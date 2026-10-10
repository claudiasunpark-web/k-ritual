// 미국 독서 지수(AR, 렉사일, IL, 미국 학년)를 읽고 엄마가 이해할 말로 풀어주는 함수들.

/** 렉사일 앞에 붙는 코드. 숫자보다 이 코드가 책 성격을 더 많이 알려준다 */
export type LexileCode = "AD" | "NC" | "HL" | "IG" | "GN" | "BR" | "NP";

export interface ParsedLexile {
  /** BR(Beginning Reader)은 음수. NP처럼 숫자가 없으면 null */
  value: number | null;
  code: LexileCode | null;
}

export const LEXILE_CODE_LABEL: Record<LexileCode, string> = {
  AD: "엄마가 읽어주는 책 (어른이 읽어주도록 만든 그림책)",
  NC: "지수보다 내용이 쉬워요 (높은 렉사일이지만 어린 아이도 즐길 내용)",
  HL: "지수는 낮지만 내용은 큰 아이용 (쉬운 글로 쓴 고학년 내용)",
  IG: "그림 도감·설명서 형식 (처음부터 끝까지 읽는 책이 아님)",
  GN: "그래픽노블·만화 (그림이 이야기를 많이 도와줘요)",
  BR: "처음 읽기 시작한 아이용 (0L보다 쉬움)",
  NP: "시·노래처럼 문장이 아닌 글 (렉사일 측정 안 함)",
};

/**
 * "AD520L", "BR100L", "GN340L", "650L", "NP" 같은 렉사일 표기를 해석한다.
 * BR 뒤 숫자는 0L보다 얼마나 쉬운지를 뜻하므로 음수로 바꾼다.
 */
export function parseLexile(input: string | number): ParsedLexile {
  if (typeof input === "number") return { value: input, code: null };
  const s = input.trim().toUpperCase().replace(/\s+/g, "");
  if (s === "NP") return { value: null, code: "NP" };
  const m = /^(AD|NC|HL|IG|GN|BR)?(\d+)L?$/.exec(s);
  if (!m) throw new SyntaxError(`렉사일 표기를 읽을 수 없어요: "${input}"`);
  const code = (m[1] ?? null) as LexileCode | null;
  const n = Number(m[2]);
  return { value: code === "BR" ? -n : n, code };
}

// AR ↔ 렉사일 근사 대응표. 두 지수는 측정 방식이 달라 책마다 어긋나는 일이 흔하다
// (예: Diary of a Wimpy Kid은 AR 5.2인데 렉사일 950L). 책에 두 값이 다 있으면
// 대응표로 환산하지 말고 실제 값을 쓴다.
const AR_LEXILE_POINTS: ReadonlyArray<readonly [ar: number, lexile: number]> = [
  [0.5, 0],
  [1.0, 150],
  [1.5, 300],
  [2.0, 400],
  [2.5, 480],
  [3.0, 550],
  [3.5, 620],
  [4.0, 690],
  [4.5, 750],
  [5.0, 810],
  [5.5, 860],
  [6.0, 910],
  [7.0, 990],
  [8.0, 1060],
];

function interpolate(x: number, from: 0 | 1, to: 0 | 1): number {
  const pts = AR_LEXILE_POINTS;
  if (x <= pts[0][from]) return pts[0][to];
  const last = pts[pts.length - 1];
  if (x >= last[from]) return last[to];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (x <= b[from]) {
      const t = (x - a[from]) / (b[from] - a[from]);
      return a[to] + t * (b[to] - a[to]);
    }
  }
  return last[to];
}

export function arToLexile(ar: number): number {
  return Math.round(interpolate(ar, 0, 1) / 10) * 10;
}

export function lexileToAr(lexile: number): number {
  return Math.round(interpolate(lexile, 1, 0) * 10) / 10;
}

/**
 * AR 지수를 말로 푼다. AR은 "미국 원어민 아이의 학년.개월"이라
 * 2.5 = 미국 2학년 5개월 아이가 혼자 읽는 수준.
 */
export function describeAr(ar: number): string {
  const grade = Math.floor(ar);
  const month = Math.round((ar - grade) * 10);
  const who = grade === 0 ? "미국 유치원생" : `미국 원어민 ${grade}학년`;
  const when = month === 0 ? "초" : ` ${month}개월째`;
  return `${who}${when} 아이가 혼자 읽는 수준이에요. 한국 아이 학년과는 상관없어요.`;
}

/** AR Interest Level: 지수(난이도)와 별개로 "내용이 몇 살용인지" */
export type InterestLevel = "LG" | "MG" | "MG+" | "UG";

export const INTEREST_LEVEL_INFO: Record<
  InterestLevel,
  { label: string; minKoreanAge: number }
> = {
  // 한국 나이는 만 나이 기준. 미국 학년 + 5~6 = 만 나이
  LG: { label: "유치원~초3 내용", minKoreanAge: 5 },
  MG: { label: "초4~중2 내용", minKoreanAge: 9 },
  "MG+": { label: "초6 이상 내용", minKoreanAge: 11 },
  UG: { label: "중3~고3 내용", minKoreanAge: 14 },
};

/** 미국 학년(K, 1~12)을 한국 학년으로 */
export function usGradeToKorean(grade: number | "K"): string {
  if (grade === "K") return "한국 7세(유치원 마지막 해)";
  if (grade <= 6) return `한국 초${grade}`;
  if (grade <= 9) return `한국 중${grade - 6}`;
  return `한국 고${grade - 9}`;
}
