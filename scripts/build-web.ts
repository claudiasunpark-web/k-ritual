// 웹페이지 빌드: 레벨·카탈로그·쿠팡 링크를 미리 계산해 web/template.html에 넣는다.
//
//   node scripts/build-web.ts
//
// web/dist/index.html: 그대로 열거나 정적 호스팅에 올리는 완성 페이지
// web/dist/app.html: <head> 없는 조각(미리보기 아티팩트용)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  INTEREST_LEVEL_INFO,
  K_LEVELS,
  STAGE_LABEL,
  describeAr,
  levelFromPhonicsMonths,
  parseLexile,
} from "../src/levels/index.ts";
import {
  BOOKS,
  COLLECTION_KIND_LABEL,
  WORKBOOKS,
  COUPANG_PARTNERS_DISCLOSURE,
  allCollections,
  bookCoupangUrl,
  bookLevel,
  bookLinkKind,
  seriesBooks,
  allThemes,
} from "../src/catalog/index.ts";

const AWARD_KIND = { medal: "대상", honor: "아너" } as const;

// EMBED_COVERS=1: 미리보기는 외부 이미지를 못 불러와서, scripts/cache-covers.py가 만든 썸네일을 페이지에 넣는다
const EMBED = process.env.EMBED_COVERS === "1";
const coverDir = new URL("../web/.covers/", import.meta.url);
function coverSrc(url: string | undefined): string | null {
  if (!url) return null;
  if (!EMBED) return url;
  const key = url.split("//")[1].replace(/[^A-Za-z0-9]/g, "_").slice(-80) + ".jpg";
  const file = new URL(key, coverDir);
  return existsSync(file) ? "data:image/jpeg;base64," + readFileSync(file).toString("base64") : null;
}

const range = (min: number, max: number, unit = "") =>
  max === Infinity ? `${min}${unit} 이상` : `${min}–${max}${unit}`;

const levels = K_LEVELS.map((l) => ({
  level: l.level,
  name: l.name,
  headline: l.headline,
  ar: l.level === 0 ? "—" : range(l.ar.min, l.ar.max),
  lexile:
    l.level === 0 ? "—" : l.lexile.min === -Infinity ? `BR–${l.lexile.max}L` : range(l.lexile.min, l.lexile.max, "L"),
  stage: STAGE_LABEL[l.stage],
  textDensity: l.textDensity,
  formats: l.formats.join(" · "),
  childCanDo: l.childCanDo,
  parentRole: l.parentRole,
}));

const books = Object.fromEntries(
  BOOKS.map((b) => {
    const r = bookLevel(b);
    const lexile = b.lexile != null ? parseLexile(b.lexile) : null;
    const il = b.interestLevel ? INTEREST_LEVEL_INFO[b.interestLevel] : null;
    return [
      b.id,
      {
        id: b.id,
        title: b.title,
        author: b.author,
        series: b.series ?? null,
        // null이면 '레벨 확인 중'
        level: r.basis === "none" ? null : r.level.level,
        levelApprox: r.basis === "manual" && !b.indicesVerified,
        listen: r.mode === "listen",
        approx: !b.indicesVerified,
        format: b.format ?? null,
        isSeries: b.isSeries ?? false,
        arMax: b.arMax ?? null,
        bookCount: b.bookCount ?? null,
        seriesCount: b.seriesCount ?? null,
        cover: coverSrc(b.coverUrl),
        levelFromSeries: b.levelFromSeries ?? false,
        ar: b.ar ?? null,
        arText: b.ar != null ? describeAr(b.ar) : null,
        lexile: b.lexile != null ? String(b.lexile) : null,
        lexileCode: lexile?.code ?? null,
        il: b.interestLevel ?? null,
        ilLabel: il?.label ?? null,
        ilMinAge: il?.minKoreanAge ?? null,
        awards: (b.awards ?? []).map((a) => `${a.award}상 ${a.year} ${AWARD_KIND[a.kind]}`),
        themes: allThemes(b),
        summary: b.summary ?? null,
        price: b.priceKrw ?? null,
        url: bookCoupangUrl(b),
        // 지수가 없다는 경고는 화면에서 '레벨 확인 중'으로 대신한다
        warnings: r.basis === "none" ? [] : r.warnings,
      },
    ];
  }),
);

// 표지가 없는 시리즈 카드는 표지가 있는 첫 낱권의 표지를 쓴다
for (const [seriesId, kids] of seriesBooks()) {
  const card = books[seriesId];
  if (card && !card.cover) card.cover = kids.map((k) => books[k.id]?.cover).find(Boolean) ?? null;
}

// "우리 아이 지금" 선택지. 개월 → 레벨은 levelFromPhonicsMonths와 같은 규칙
const readingOptions = [
  { id: "before", label: "파닉스 전 (엄마가 읽어줘요)", level: 0 },
  { id: "learning", label: "파닉스 배우는 중", level: 1 },
  ...[
    [0, "파닉스 뗀 지 3개월 안"],
    [3, "파닉스 뗀 지 3~6개월"],
    [6, "파닉스 뗀 지 6~9개월"],
    [9, "파닉스 뗀 지 9~12개월"],
    [12, "파닉스 뗀 지 1년~1년 반"],
    [18, "파닉스 뗀 지 1년 반~2년"],
    [24, "파닉스 뗀 지 2~3년"],
    [36, "파닉스 뗀 지 3~4년"],
    [48, "파닉스 뗀 지 4년 넘음"],
  ].map(([m, label]) => ({ id: `m${m}`, label, level: levelFromPhonicsMonths(m as number) })),
];

const data = {
  levels,
  books,
  collections: allCollections(),
  kindLabels: COLLECTION_KIND_LABEL,
  readingOptions,
  workbooks: WORKBOOKS,
  // 시리즈 카드를 눌렀을 때 보여줄 낱권 목록
  seriesBooks: Object.fromEntries([...seriesBooks()].map(([id, list]) => [id, list.map((b) => b.id)])),
  disclosure: COUPANG_PARTNERS_DISCLOSURE,
};

const root = new URL("../web/", import.meta.url);
const template = readFileSync(new URL("template.html", root), "utf8");
// </script> 가 데이터 안에 있어도 태그가 닫히지 않도록
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const app = template.replace("/*__DATA__*/null", json);

mkdirSync(new URL("dist/", root), { recursive: true });
writeFileSync(new URL("dist/app.html", root), app);
writeFileSync(
  new URL("dist/index.html", root),
  `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${app}\n</body>\n</html>\n`,
);

const notPartners = BOOKS.filter((b) => bookLinkKind(b) !== "partners").length;
const seriesCount = BOOKS.filter((b) => b.isSeries).length;
console.log(`web/dist 빌드 완료: 낱권 ${BOOKS.length - seriesCount}권, 시리즈 ${seriesCount}개, 묶음 ${data.collections.length}개`);
if (notPartners > 0) {
  console.log(`주의: ${notPartners}권은 아직 내 파트너스 링크가 없어 실적이 잡히지 않아요 (src/catalog/coupang-links.json)`);
}
