// K-레벨: AR·렉사일·글밥·미국 학년을 "한국 아이 기준"으로 번역한 단계표.
//
// 기준 아이: 한국에서 영어를 외국어로 배우는 아이가 파닉스를 뗀 뒤
// 하루 20~30분 영어책을 꾸준히 읽는 경우. "파닉스 후 개월 수"는 이 가정 위의
// 출발값이며, 실제 사용자 읽기 기록이 쌓이면 다시 보정해야 한다.

export type ReadingStage =
  | "listen" // 엄마가 읽어줌
  | "decode" // 한 단어씩 짚으며 소리 내어 읽기
  | "read-aloud" // 혼자 소리 내어 읽기
  | "independent" // 혼자 읽기 독립
  | "silent"; // 속으로 읽기(묵독)

export type BookFormat =
  | "그림책"
  | "파닉스북"
  | "리더스북"
  | "얼리챕터북"
  | "챕터북"
  | "소설";

export interface KLevel {
  level: number;
  name: string;
  /** 엄마에게 보여줄 한 줄 요약 */
  headline: string;
  /** AR(ATOS) 범위, 하한 포함·상한 미포함 */
  ar: { min: number; max: number };
  /** 렉사일 범위(근사), 하한 포함·상한 미포함. BR은 음수로 표현 */
  lexile: { min: number; max: number };
  /** 파닉스 뗀 뒤 개월 수(꾸준히 읽은 아이 기준) */
  monthsAfterPhonics: { min: number; max: number | null };
  stage: ReadingStage;
  formats: BookFormat[];
  /** 책 한 권 단어 수(대략) */
  wordsPerBook: { min: number; max: number | null };
  /** 엄마들이 쓰는 말로 표현한 글밥 */
  textDensity: string;
  /** 이 단계 아이가 실제로 하는 모습 */
  childCanDo: string[];
  /** 이 단계에서 엄마의 역할 */
  parentRole: string;
  /** 대표 시리즈. 지수는 권마다 다르니 책 단위 데이터로 확인할 것 */
  exampleSeries: string[];
}

export const K_LEVELS: readonly KLevel[] = [
  {
    level: 0,
    name: "귀 열기",
    headline: "파닉스 전 · 엄마가 읽어주는 단계",
    ar: { min: 0, max: 0 },
    lexile: { min: -Infinity, max: -Infinity },
    monthsAfterPhonics: { min: 0, max: 0 },
    stage: "listen",
    formats: ["그림책"],
    wordsPerBook: { min: 0, max: null },
    textDensity: "글밥 상관없음 (읽어주기용)",
    childCanDo: [
      "알파벳을 배우는 중이거나 아직 모름",
      "그림을 보며 엄마가 읽어주는 영어를 들음",
      "반복되는 문장을 따라 말함",
    ],
    parentRole: "읽어주기. 지수보다 아이가 좋아하는 그림과 리듬이 우선",
    exampleSeries: ["노부영 그림책", "Eric Carle 그림책", "Mother Goose 동요책"],
  },
  {
    level: 1,
    name: "첫 글자",
    headline: "파닉스 배우는 중 · 한 단어씩 짚으며 읽기",
    ar: { min: 0.1, max: 1.0 },
    lexile: { min: -Infinity, max: 150 },
    monthsAfterPhonics: { min: 0, max: 0 },
    stage: "decode",
    formats: ["파닉스북", "리더스북"],
    wordsPerBook: { min: 0, max: 150 },
    textDensity: "페이지당 한 줄, 같은 문장 반복",
    childCanDo: [
      "cat, sit 같은 짧은 단어를 소리로 조합해 읽음",
      "the, is 같은 사이트워드를 외워서 읽기 시작",
      "손가락으로 짚으며 천천히 읽음",
    ],
    parentRole: "옆에서 같이 짚어주기. 틀려도 바로 고치지 말고 끝까지 읽게 두기",
    exampleSeries: ["Oxford Reading Tree 1~2단계", "Bob Books", "파닉스 디코더블북"],
  },
  {
    level: 2,
    name: "막 뗀 파닉스",
    headline: "파닉스 뗀 직후~3개월 · 소리 내어 혼자 읽기 시작",
    ar: { min: 1.0, max: 1.5 },
    lexile: { min: 150, max: 300 },
    monthsAfterPhonics: { min: 0, max: 3 },
    stage: "read-aloud",
    formats: ["리더스북"],
    wordsPerBook: { min: 100, max: 500 },
    textDensity: "페이지당 1~2문장, 그림이 대부분",
    childCanDo: [
      "처음 보는 쉬운 책을 소리 내어 끝까지 읽음",
      "모르는 단어는 그림을 보고 추측",
      "한 권 5~10분",
    ],
    parentRole: "들어주는 청중 되기. 다 읽으면 내용 한두 개만 물어보기",
    exampleSeries: [
      "Elephant & Piggie",
      "Biscuit (I Can Read My First)",
      "Oxford Reading Tree 3~4단계",
    ],
  },
  {
    level: 3,
    name: "리더스 독립",
    headline: "파닉스 후 3~6개월 · 짧은 리더스북 혼자 완독",
    ar: { min: 1.5, max: 2.0 },
    lexile: { min: 300, max: 400 },
    monthsAfterPhonics: { min: 3, max: 6 },
    stage: "read-aloud",
    formats: ["리더스북"],
    wordsPerBook: { min: 300, max: 1500 },
    textDensity: "페이지당 2~4문장",
    childCanDo: [
      "리더스북 한 권을 엄마 도움 없이 완독",
      "읽는 속도가 붙고 억양이 생김",
      "같은 시리즈를 연달아 읽고 싶어함",
    ],
    parentRole: "시리즈 물량 대주기. 다독으로 속도를 올릴 시기",
    exampleSeries: ["Fly Guy", "Step into Reading 2", "Oxford Reading Tree 5~6단계"],
  },
  {
    level: 4,
    name: "얼리챕터 입문",
    headline: "파닉스 후 6~9개월 · 챕터로 나뉜 책 시작",
    ar: { min: 2.0, max: 2.5 },
    lexile: { min: 400, max: 480 },
    monthsAfterPhonics: { min: 6, max: 9 },
    stage: "independent",
    formats: ["리더스북", "얼리챕터북"],
    wordsPerBook: { min: 1000, max: 4000 },
    textDensity: "짧은 문단, 그림이 절반 이상",
    childCanDo: [
      "챕터 1~2개씩 나눠서 며칠에 걸쳐 읽음",
      "소리 내어 읽기와 속으로 읽기를 섞어 씀",
      "앞 내용을 기억하고 이어서 읽음",
    ],
    parentRole: "오디오북 흘려듣기 병행. 첫 챕터만 같이 읽고 나머지는 맡기기",
    exampleSeries: ["Nate the Great", "Frog and Toad", "Henry and Mudge"],
  },
  {
    level: 5,
    name: "혼자 읽기",
    headline: "파닉스 후 6~12개월 · 혼자 읽기 가능",
    ar: { min: 2.5, max: 3.0 },
    lexile: { min: 480, max: 550 },
    monthsAfterPhonics: { min: 6, max: 12 },
    stage: "independent",
    formats: ["얼리챕터북"],
    wordsPerBook: { min: 3000, max: 8000 },
    textDensity: "페이지 절반이 글, 그림은 2~3쪽에 한 번",
    childCanDo: [
      "얼리챕터북 한 권을 혼자 읽고 줄거리를 말함",
      "모르는 단어가 있어도 멈추지 않고 문맥으로 넘어감",
      "한 번에 20~30분 집중",
    ],
    parentRole: "읽기는 아이에게, 엄마는 내용 대화만",
    exampleSeries: ["Magic Tree House", "Mercy Watson", "Junie B. Jones"],
  },
  {
    level: 6,
    name: "챕터북",
    headline: "파닉스 후 1~1년 반 · 속으로 읽기 전환",
    ar: { min: 3.0, max: 3.5 },
    lexile: { min: 550, max: 620 },
    monthsAfterPhonics: { min: 12, max: 18 },
    stage: "silent",
    formats: ["챕터북"],
    wordsPerBook: { min: 6000, max: 15000 },
    textDensity: "페이지가 글로 차 있음, 그림은 챕터당 한두 개",
    childCanDo: [
      "소리 내지 않고 속으로 읽음",
      "100쪽 내외 책을 며칠에 걸쳐 완독",
      "등장인물 감정과 이유를 이해",
    ],
    parentRole: "좋아하는 시리즈 찾아주기. 몰입하면 같은 시리즈를 끝까지",
    exampleSeries: ["Horrid Henry", "Rainbow Magic", "Captain Underpants"],
  },
  {
    level: 7,
    name: "챕터북 몰입",
    headline: "파닉스 후 1년 반~2년 · 두꺼운 챕터북 시리즈 몰입",
    ar: { min: 3.5, max: 4.0 },
    lexile: { min: 620, max: 690 },
    monthsAfterPhonics: { min: 18, max: 24 },
    stage: "silent",
    formats: ["챕터북"],
    wordsPerBook: { min: 10000, max: 25000 },
    textDensity: "그림 거의 없음, 긴 문단과 대화",
    childCanDo: [
      "시리즈를 연달아 읽으며 하루 30분 이상 몰입",
      "유머와 말장난을 알아듣고 웃음",
      "한글책 읽듯 편하게 읽기 시작",
    ],
    parentRole: "읽은 양 칭찬하기. 어휘 테스트보다 계속 읽게 두기",
    exampleSeries: ["The Zack Files", "A to Z Mysteries", "Geronimo Stilton"],
  },
  {
    level: 8,
    name: "소설 입문",
    headline: "파닉스 후 2~3년 · 그림 없는 소설 시작",
    ar: { min: 4.0, max: 5.0 },
    lexile: { min: 690, max: 810 },
    monthsAfterPhonics: { min: 24, max: 36 },
    stage: "silent",
    formats: ["소설"],
    wordsPerBook: { min: 20000, max: 50000 },
    textDensity: "그림 없음, 빽빽한 글",
    childCanDo: [
      "150쪽 이상 소설을 완독",
      "주제와 인물의 변화를 이해",
      "영어로 책 감상을 짧게 말하거나 씀",
    ],
    parentRole: "내용 적정 나이(IL) 확인하기. 지수는 맞아도 내용이 아이 나이보다 성숙할 수 있음",
    exampleSeries: ["Charlotte's Web", "Roald Dahl 초기작", "Wonder"],
  },
  {
    level: 9,
    name: "소설 독립",
    headline: "파닉스 후 3~4년 · 미국 또래 수준 소설",
    ar: { min: 5.0, max: 6.0 },
    lexile: { min: 810, max: 910 },
    monthsAfterPhonics: { min: 36, max: 48 },
    stage: "silent",
    formats: ["소설"],
    wordsPerBook: { min: 40000, max: 90000 },
    textDensity: "두꺼운 소설, 어려운 어휘 포함",
    childCanDo: [
      "300쪽 소설을 혼자 완독",
      "장르(판타지·미스터리)를 골라 읽음",
      "영어 원서가 한글책만큼 편함",
    ],
    parentRole: "내용 적정 나이(IL) 확인하기. 아이 관심사 넓혀주기",
    exampleSeries: ["Harry Potter 1권", "Matilda", "Percy Jackson"],
  },
  {
    level: 10,
    name: "상급 독서",
    headline: "원어민 고학년 이상 · 내용 성숙도 꼭 확인",
    ar: { min: 6.0, max: Infinity },
    lexile: { min: 910, max: Infinity },
    monthsAfterPhonics: { min: 48, max: null },
    stage: "silent",
    formats: ["소설"],
    wordsPerBook: { min: 50000, max: null },
    textDensity: "성인 소설에 가까운 글밥",
    childCanDo: ["긴 소설과 논픽션을 혼자 읽음", "작가 의도와 배경을 생각하며 읽음"],
    parentRole: "레벨보다 내용 적정 나이가 우선. 초등 저학년이면 IL MG+/UG 책은 피하기",
    exampleSeries: ["Harry Potter 후반부", "The Giver", "Hatchet"],
  },
];

/** 읽기 단계 설명(엄마용) */
export const STAGE_LABEL: Record<ReadingStage, string> = {
  listen: "엄마가 읽어줘요",
  decode: "한 단어씩 짚으며 읽어요",
  "read-aloud": "소리 내어 혼자 읽어요",
  independent: "혼자 읽을 수 있어요",
  silent: "속으로 술술 읽어요",
};

export function getLevel(level: number): KLevel {
  const found = K_LEVELS.find((l) => l.level === level);
  if (!found) throw new RangeError(`K-레벨 ${level}은 없어요 (0~10)`);
  return found;
}
