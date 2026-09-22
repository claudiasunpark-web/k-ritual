#!/usr/bin/env node
/**
 * 국토교통부 실거래가 공개 API로 압구정동 아파트 매매 실거래를 수집·집계합니다.
 *
 *   MOLIT_API_KEY=발급받은키 node scripts/fetch-trades.mjs [--months 36]
 *
 * API 키 발급: https://www.data.go.kr/data/15126468/openapi.do 에서 활용신청
 * 결과: data/trades/apgujeong.json (사이트 빌드가 이 파일을 읽습니다)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fetchMonth, normalize, monthRange } from './lib/molit.mjs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const MONTHS = Number(argOf('--months', '36'));
// 국토부 API는 요청당 10~30초가 걸리는 경우가 많아, 순차 처리로는 36개월이
// 20분을 넘깁니다. 동시 요청으로 벽시계 시간을 줄입니다(서버 부담을 고려해 6).
const CONCURRENCY = Math.max(1, Math.min(8, Number(argOf('--concurrency', '6'))));
const TIMEOUT_MS = Number(argOf('--timeout', '20000'));
const serviceKey = process.env.MOLIT_API_KEY;

if (!serviceKey) {
  console.error(`
MOLIT_API_KEY 환경변수가 없습니다.

  1. https://www.data.go.kr/data/15126468/openapi.do 에서 '활용신청'
  2. 마이페이지 > 오픈API > 인증키에서 '일반 인증키(Encoding)' 복사
  3. MOLIT_API_KEY=붙여넣은키 npm run fetch

기존 data/trades/apgujeong.json 이 있으면 빌드는 그 파일로 계속 동작합니다.`);
  process.exit(1);
}

const complexesDoc = read('data/complexes.json');
const zonesDoc = read('data/zones.json');

// 별칭이 긴 것부터 매칭해 '현대1차'가 '현대1'보다 먼저 잡히게 합니다.
const aliasIndex = [];
for (const c of complexesDoc.complexes) {
  for (const a of c.aliases) aliasIndex.push({ alias: a.replace(/\s+/g, ''), complex: c });
}
aliasIndex.sort((x, y) => y.alias.length - x.alias.length);

function matchComplex(aptName) {
  const flat = String(aptName).replace(/\s+/g, '');
  for (const { alias, complex } of aliasIndex) {
    if (flat.includes(alias)) return complex;
  }
  return null;
}

// 평형대 구분. 재건축 단지는 소형의 평당가가 유독 높아(대지지분 대비 입주권
// 가치), 평형을 섞은 중위값은 그 달에 어떤 평형이 거래됐는지에 좌우됩니다.
// 그래서 구역 시계열을 평형대별로 나눠 둡니다.
const BANDS = [
  { key: 'small', label: '소형 (전용 100㎡ 미만)', min: 0, max: 100 },
  { key: 'mid', label: '중형 (전용 100~160㎡)', min: 100, max: 160 },
  { key: 'large', label: '대형 (전용 160㎡ 이상)', min: 160, max: Infinity },
];
const bandOf = (area) => BANDS.find((b) => area >= b.min && area < b.max)?.key ?? 'large';

const median = (nums) => {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const now = new Date();
// 실거래 신고는 계약 후 30일 이내이므로 직전 달은 아직 채워지는 중입니다.
const months = monthRange(now.getFullYear(), now.getMonth() + 1, MONTHS);

console.log(
  `강남구(${complexesDoc.lawdCd}) ${months[0]} ~ ${months.at(-1)} (${months.length}개월) 수집 · 동시 ${CONCURRENCY}건`,
);

const all = [];
const failures = [];
let done = 0;

/** 월 목록을 동시 CONCURRENCY 개씩 처리합니다. */
async function collect() {
  const queue = [...months];
  const worker = async () => {
    for (;;) {
      const ym = queue.shift();
      if (!ym) return;
      try {
        const raw = await fetchMonth({
          serviceKey,
          lawdCd: complexesDoc.lawdCd,
          dealYmd: ym,
          timeoutMs: TIMEOUT_MS,
        });
        const rows = raw
          .map(normalize)
          .filter((r) => r && !r.cancelled && r.umd === complexesDoc.umdName);
        all.push(...rows);
        done += 1;
        process.stdout.write(
          `  [${done}/${months.length}] ${ym}: 강남구 ${raw.length}건 → 압구정동 ${rows.length}건\n`,
        );
      } catch (err) {
        failures.push({ ym, message: err.message });
        done += 1;
        process.stdout.write(`  [${done}/${months.length}] ${ym}: 실패 — ${err.message}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

const startedAt = Date.now();
await collect();
console.log(`\n수집 소요 ${((Date.now() - startedAt) / 1000).toFixed(0)}초`);

if (all.length === 0) {
  console.error('\n수집된 거래가 0건입니다. API 키와 기간을 확인하세요.');
  if (failures.length) console.error(failures.slice(0, 5));
  process.exit(1);
}
// 일부 달이 실패해도 나머지로 집계를 진행합니다. 실패 목록은 결과에 남깁니다.
if (failures.length) {
  console.log(`실패한 월 ${failures.length}개 — 나머지 ${months.length - failures.length}개월로 집계합니다.`);
}

// ── 단지별 집계 ──────────────────────────────────────────────
const unmapped = new Map();
const byComplex = new Map();

for (const t of all) {
  const c = matchComplex(t.aptName);
  if (!c) {
    unmapped.set(t.aptName, (unmapped.get(t.aptName) ?? 0) + 1);
    continue;
  }
  if (!byComplex.has(c.id)) byComplex.set(c.id, { complex: c, trades: [] });
  byComplex.get(c.id).trades.push({ ...t, complexId: c.id, zone: c.zone });
}

const RECENT_WINDOW = 12; // 최근 12개월을 '현재 시세' 창으로 사용
const recentFrom = months.at(-RECENT_WINDOW) ?? months[0];
const inRecent = (t) => t.ym.replace('-', '') >= recentFrom;

const complexes = [...byComplex.values()]
  .map(({ complex, trades }) => {
    trades.sort((a, b) => (a.date < b.date ? 1 : -1));

    // 전용면적별(= 실제 평형 구성) 집계. 면적 목록 자체가 실거래에서 도출됩니다.
    const sizeMap = new Map();
    for (const t of trades) {
      const key = t.area.toFixed(2);
      if (!sizeMap.has(key)) sizeMap.set(key, []);
      sizeMap.get(key).push(t);
    }
    const sizes = [...sizeMap.entries()]
      .map(([key, ts]) => {
        const recent = ts.filter(inRecent);
        const basis = recent.length ? recent : ts;
        return {
          area: Number(key),
          pyeong: Math.round(ts[0].pyeong * 10) / 10,
          pyeongLabel: `${Math.round(ts[0].pyeong)}평형`,
          count: ts.length,
          recentCount: recent.length,
          medianAmountManKRW: median(basis.map((t) => t.amountManKRW)),
          medianPerPyeongManKRW: median(basis.map((t) => t.perPyeongManKRW)),
          minAmountManKRW: Math.min(...basis.map((t) => t.amountManKRW)),
          maxAmountManKRW: Math.max(...basis.map((t) => t.amountManKRW)),
          lastTrade: { date: ts[0].date, amountManKRW: ts[0].amountManKRW, floor: ts[0].floor },
          landSharePyeong: complex.landSharePyeong?.[key] ?? null,
        };
      })
      .sort((a, b) => a.area - b.area);

    const recent = trades.filter(inRecent);
    const basis = recent.length ? recent : trades;

    return {
      id: complex.id,
      label: complex.label,
      zone: complex.zone,
      tradeCount: trades.length,
      recentCount: recent.length,
      medianPerPyeongManKRW: median(basis.map((t) => t.perPyeongManKRW)),
      buildYear: trades.find((t) => t.buildYear)?.buildYear ?? null,
      sizes,
      // 개별 거래 내역. 집계값만 보면 "그래서 어떤 거래였나"를 알 수 없어
      // 최근 거래를 그대로 보관합니다(단지별 최대 30건).
      recentTrades: trades.slice(0, 30).map((t) => ({
        date: t.date,
        pyeong: Math.round(t.pyeong),
        area: t.area,
        amountManKRW: t.amountManKRW,
        perPyeongManKRW: t.perPyeongManKRW,
        floor: t.floor,
        dealType: t.dealType,
      })),
    };
  })
  .sort((a, b) => (a.zone === b.zone ? a.label.localeCompare(b.label, 'ko') : a.zone.localeCompare(b.zone)));

// ── 구역별 월별 시계열 ───────────────────────────────────────
const zoneIds = zonesDoc.zones.map((z) => z.id);
const ymList = [...new Set(all.map((t) => t.ym))].sort();
const zoneMonthly = zoneIds
  .map((zid) => {
    const trades = [...byComplex.values()]
      .filter((e) => e.complex.zone === zid)
      .flatMap((e) => e.trades);
    const series = ymList.map((ym) => {
      const picked = trades.filter((t) => t.ym === ym);
      const byBand = {};
      for (const b of BANDS) {
        const inBand = picked.filter((t) => bandOf(t.area) === b.key);
        byBand[b.key] = {
          count: inBand.length,
          medianPerPyeongManKRW: median(inBand.map((t) => t.perPyeongManKRW)),
        };
      }
      return {
        ym,
        count: picked.length,
        medianPerPyeongManKRW: median(picked.map((t) => t.perPyeongManKRW)),
        byBand,
      };
    });
    return { zone: zid, totalCount: trades.length, series };
  })
  .filter((z) => z.totalCount > 0);

const out = {
  generatedAt: new Date().toISOString(),
  range: { from: months[0], to: months.at(-1), months: months.length },
  recentWindow: { months: RECENT_WINDOW, from: recentFrom },
  source: {
    name: '국토교통부 아파트 매매 실거래가 상세 자료',
    provider: '공공데이터포털 (data.go.kr)',
    dataset: 'RTMSDataSvcAptTradeDev',
    url: 'https://www.data.go.kr/data/15126468/openapi.do',
    note: '전용면적 기준 평당가. 해제된 거래는 제외했습니다. 직전 1~2개월은 신고 기한(계약 후 30일) 때문에 건수가 과소 집계될 수 있습니다.',
  },
  totals: { trades: all.length, mappedComplexes: complexes.length, months: ymList.length },
  collection: { concurrency: CONCURRENCY, timeoutMs: TIMEOUT_MS, requestedMonths: months.length, failedMonths: failures.length },
  ymList,
  bands: BANDS.map(({ key, label, min, max }) => ({ key, label, min, max: max === Infinity ? null : max })),
  complexes,
  zoneMonthly,
  unmapped: [...unmapped.entries()]
    .map(([aptName, count]) => ({ aptName, count }))
    .sort((a, b) => b.count - a.count),
  failures,
};

mkdirSync(new URL('data/trades/', ROOT), { recursive: true });
writeFileSync(new URL('data/trades/apgujeong.json', ROOT), `${JSON.stringify(out, null, 2)}\n`);

console.log(`
완료: 압구정동 ${all.length}건 → ${complexes.length}개 단지 집계`);
console.log(`     data/trades/apgujeong.json 갱신`);
if (out.unmapped.length) {
  console.log(`
매칭되지 않은 단지명 ${out.unmapped.length}건 — data/complexes.json 의 aliases에 추가하세요:`);
  for (const u of out.unmapped.slice(0, 20)) console.log(`     ${u.aptName} (${u.count}건)`);
}
if (failures.length) console.log(`\n실패한 월 ${failures.length}건 — 재실행하면 이어서 채웁니다.`);
