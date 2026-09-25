#!/usr/bin/env node
/**
 * API 키 없이도 사이트 레이아웃을 확인할 수 있도록 '구조만 같은' 샘플 데이터를 만듭니다.
 * 가격은 전부 합성값이며 실제 시세가 아닙니다. isSample:true 가 붙어 사이트에 경고 배너가 뜹니다.
 *   node scripts/make-sample.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const complexesDoc = read('data/complexes.json');
const zonesDoc = read('data/zones.json');

// 결정론적 의사난수 — 같은 입력이면 항상 같은 샘플이 나옵니다.
let seed = 20260919;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const MONTHS = 36;
const ymList = [];
{
  let y = 2026;
  let m = 9;
  for (let i = 0; i < MONTHS; i += 1) {
    ymList.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
}

const AREA_SETS = [
  [82.5, 108.98, 131.48, 158.72],
  [108.98, 144.2, 170.37, 196.21],
  [131.48, 158.72, 196.21, 245.2],
];
const ZONE_BASE = { z1: 1050, z2: 1500, z3: 1420, z4: 1320, z5: 1280, z6: 1120 };

const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const complexes = [];
const zoneTrades = new Map(zonesDoc.zones.map((z) => [z.id, []]));

for (const c of complexesDoc.complexes) {
  const areas = AREA_SETS[Math.floor(rand() * AREA_SETS.length)];
  const base = ZONE_BASE[c.zone] ?? 1200;
  const sizes = [];
  const recentTrades = [];

  for (const area of areas) {
    const pyeong = area / 3.3058;
    const perPyeong = Math.round(base * (0.92 + rand() * 0.18) * 10);
    const amount = Math.round((perPyeong * pyeong) / 1000) * 1000;
    sizes.push({
      area,
      pyeong: Math.round(pyeong * 10) / 10,
      pyeongLabel: `${Math.round(pyeong)}평형`,
      count: 3 + Math.floor(rand() * 20),
      recentCount: 1 + Math.floor(rand() * 6),
      medianAmountManKRW: amount,
      medianPerPyeongManKRW: perPyeong,
      minAmountManKRW: Math.round(amount * 0.92),
      maxAmountManKRW: Math.round(amount * 1.09),
      lastTrade: { date: '2026-08-15', amountManKRW: amount, floor: 3 + Math.floor(rand() * 12) },
      landSharePyeong: c.landSharePyeong?.[area.toFixed(2)] ?? null,
      landShareByDong: {},
    });
    // 평형마다 몇 건씩 만들어 개별 거래 표가 비지 않게 합니다.
    for (let k = 0; k < 2 + Math.floor(rand() * 3); k += 1) {
      const m = 8 - k;
      const jitter = 0.94 + rand() * 0.12;
      const amt = Math.round((amount * jitter) / 1000) * 1000;
      recentTrades.push({
        date: `2026-${String(m > 0 ? m : 12 + m).padStart(2, '0')}-${String(3 + Math.floor(rand() * 25)).padStart(2, '0')}`,
        dong: rand() > 0.4 ? `${101 + Math.floor(rand() * 12)}` : null,
        pyeong: Math.round(pyeong),
        area,
        amountManKRW: amt,
        perPyeongManKRW: Math.round(amt / pyeong),
        floor: 3 + Math.floor(rand() * 12),
        dealType: rand() > 0.85 ? '직거래' : '중개거래',
      });
    }
  }

  recentTrades.sort((a, b) => (a.date < b.date ? 1 : -1));
  const dongs = [...new Set(recentTrades.map((t) => t.dong).filter(Boolean))].sort();
  // lastTrade 를 실제로 생성된 최신 거래에서 가져옵니다(날짜가 전부 같아지지 않게).
  for (const sz of sizes) {
    const newest = recentTrades.find((t) => t.area === sz.area);
    if (newest) {
      sz.lastTrade = { date: newest.date, amountManKRW: newest.amountManKRW, floor: newest.floor };
    }
  }
  const med = median(sizes.map((s) => s.medianPerPyeongManKRW));
  complexes.push({
    id: c.id,
    label: c.label,
    zone: c.zone,
    tradeCount: sizes.reduce((a, s) => a + s.count, 0),
    recentCount: sizes.reduce((a, s) => a + s.recentCount, 0),
    medianPerPyeongManKRW: med,
    buildYear: 1976 + Math.floor(rand() * 12),
    sizes,
    dongs,
    recentTrades,
  });
  zoneTrades.get(c.zone)?.push(med);
}

const zoneMonthly = zonesDoc.zones
  .map((z) => {
    const start = (ZONE_BASE[z.id] ?? 1200) * 10 * 0.72;
    const end = (ZONE_BASE[z.id] ?? 1200) * 10;
    const series = ymList.map((ym, i) => {
      const t = i / (ymList.length - 1);
      const trend = start + (end - start) * (t ** 1.25);
      const base = Math.round((trend * (0.97 + rand() * 0.06)) / 10) * 10;
      // 소형이 평당가가 높은 실제 경향을 샘플에도 반영합니다.
      const byBand = {
        small: { count: Math.floor(rand() * 3), medianPerPyeongManKRW: Math.round(base * 1.55) },
        mid: { count: 1 + Math.floor(rand() * 5), medianPerPyeongManKRW: base },
        large: { count: Math.floor(rand() * 4), medianPerPyeongManKRW: Math.round(base * 0.9) },
      };
      return {
        ym,
        count: byBand.small.count + byBand.mid.count + byBand.large.count,
        medianPerPyeongManKRW: base,
        byBand,
      };
    });
    return { zone: z.id, totalCount: series.reduce((a, s) => a + s.count, 0), series };
  });

const out = {
  isSample: true,
  sampleWarning:
    '이 데이터는 사이트 레이아웃 확인용 합성 샘플입니다. 실제 시세가 아니며, 판매·배포 전에 반드시 npm run fetch 로 국토교통부 실거래가를 채워야 합니다.',
  generatedAt: new Date().toISOString(),
  range: { from: ymList[0].replace('-', ''), to: ymList.at(-1).replace('-', ''), months: MONTHS },
  recentWindow: { months: 12, from: ymList.at(-12).replace('-', '') },
  source: {
    name: '샘플 (합성 데이터)',
    provider: '—',
    dataset: 'sample',
    url: 'https://www.data.go.kr/data/15126468/openapi.do',
    note: '합성 데이터입니다.',
  },
  totals: { trades: complexes.reduce((a, c) => a + c.tradeCount, 0), mappedComplexes: complexes.length, months: MONTHS },
  ymList,
  bands: [
    { key: 'small', label: '소형 (전용 100㎡ 미만)', min: 0, max: 100 },
    { key: 'mid', label: '중형 (전용 100~160㎡)', min: 100, max: 160 },
    { key: 'large', label: '대형 (전용 160㎡ 이상)', min: 160, max: null },
  ],
  complexes,
  zoneMonthly,
  unmapped: [],
  failures: [],
};

mkdirSync(new URL('data/trades/', ROOT), { recursive: true });
writeFileSync(new URL('data/trades/sample.json', ROOT), `${JSON.stringify(out, null, 2)}\n`);
console.log(`샘플 생성: data/trades/sample.json (${out.totals.mappedComplexes}개 단지, ${MONTHS}개월)`);
