import { test } from "node:test";
import assert from "node:assert/strict";
import {
  K_LEVELS,
  arToLexile,
  describeAr,
  estimateLevel,
  fitForChild,
  levelFromPhonicsMonths,
  lexileToAr,
  parseLexile,
  usGradeToKorean,
} from "../src/levels/index.ts";

test("레벨 AR 구간이 빈틈·겹침 없이 이어진다", () => {
  const reading = K_LEVELS.filter((l) => l.level > 0);
  for (let i = 1; i < reading.length; i++) {
    assert.equal(reading[i].ar.min, reading[i - 1].ar.max, `레벨 ${reading[i].level}`);
    assert.equal(reading[i].lexile.min, reading[i - 1].lexile.max, `레벨 ${reading[i].level}`);
  }
});

test("AR 2.5 = 파닉스 후 6~12개월, 혼자 읽기", () => {
  const r = estimateLevel({ ar: 2.5 });
  assert.equal(r.level.level, 5);
  assert.equal(r.level.name, "혼자 읽기");
  assert.deepEqual(r.level.monthsAfterPhonics, { min: 6, max: 12 });
});

test("렉사일 코드 해석", () => {
  assert.deepEqual(parseLexile("AD520L"), { value: 520, code: "AD" });
  assert.deepEqual(parseLexile("BR100L"), { value: -100, code: "BR" });
  assert.deepEqual(parseLexile("gn 390l"), { value: 390, code: "GN" });
  assert.deepEqual(parseLexile("650L"), { value: 650, code: null });
  assert.deepEqual(parseLexile("NP"), { value: null, code: "NP" });
  assert.throws(() => parseLexile("abc"), SyntaxError);
});

test("AR↔렉사일 근사 환산은 왕복해도 크게 벗어나지 않는다", () => {
  for (const ar of [1.0, 2.5, 4.4, 5.5]) {
    assert.ok(Math.abs(lexileToAr(arToLexile(ar)) - ar) <= 0.1, `AR ${ar}`);
  }
});

test("AD 렉사일 그림책은 듣기용으로 판정", () => {
  const r = estimateLevel({ ar: 3.4, lexile: "AD740L" });
  assert.equal(r.mode, "listen");
  assert.equal(fitForChild({ age: 5, level: 1 }, { ar: 3.4, lexile: "AD740L" }).fit, "읽어주기");
});

test("AR과 렉사일이 2레벨 이상 어긋나면 경고", () => {
  // Diary of a Wimpy Kid: AR 5.2, 950L
  const r = estimateLevel({ ar: 5.2, lexile: "950L" });
  assert.equal(r.level.level, 9);
  assert.equal(r.warnings.length, 0); // 렉사일 950 → 레벨 10, 차이 1
  const off = estimateLevel({ ar: 2.9, lexile: "800L" });
  assert.ok(off.warnings.some((w) => w.includes("AR과 렉사일")));
});

test("지수가 없으면 단어 수로 추정하고 경고", () => {
  const r = estimateLevel({ wordCount: 5000 });
  assert.equal(r.basis, "wordCount");
  assert.equal(r.level.level, 5);
  assert.equal(r.warnings.length, 1);
});

test("아이 레벨 대비 맞춤 판정", () => {
  const child = { age: 8, level: 5 };
  assert.equal(fitForChild(child, { ar: 2.0 }).fit, "술술");
  assert.equal(fitForChild(child, { ar: 2.6 }).fit, "딱 맞음");
  assert.equal(fitForChild(child, { ar: 3.2 }).fit, "도전");
  assert.equal(fitForChild(child, { ar: 4.4 }).fit, "어려움");
});

test("영어 실력은 되지만 내용이 성숙하면 경고", () => {
  const r = fitForChild({ age: 7, level: 9 }, { ar: 5.7, interestLevel: "UG" });
  assert.ok(r.warnings.some((w) => w.includes("내용 적정 나이")));
  assert.equal(fitForChild({ age: 15, level: 9 }, { ar: 5.7, interestLevel: "UG" }).warnings.length, 0);
});

test("파닉스 개월 수로 레벨 추정", () => {
  assert.equal(levelFromPhonicsMonths(null), 0);
  assert.equal(levelFromPhonicsMonths(0), 2);
  assert.equal(levelFromPhonicsMonths(4), 3);
  assert.equal(levelFromPhonicsMonths(6), 4);
  assert.equal(levelFromPhonicsMonths(10), 5);
  assert.equal(levelFromPhonicsMonths(40), 9);
  assert.equal(levelFromPhonicsMonths(60), 10);
});

test("엄마용 설명 문구", () => {
  assert.equal(describeAr(2.5), "미국 원어민 2학년 5개월째 아이가 혼자 읽는 수준이에요. 한국 아이 학년과는 상관없어요.");
  assert.equal(usGradeToKorean("K"), "한국 7세(유치원 마지막 해)");
  assert.equal(usGradeToKorean(8), "한국 중2");
});
