#!/usr/bin/env node
/**
 * 대지지분을 채워야 할 목록을 뽑아 줍니다.
 *   node scripts/land-share-todo.mjs            # 화면에 요약 출력
 *   node scripts/land-share-todo.mjs --csv      # 엑셀용 CSV 파일 생성
 *
 * 압구정은 같은 단지·같은 평형이라도 동에 따라 대지지분이 다릅니다.
 * 따라서 조사 단위는 '단지 × 동 × 평형'입니다. 실거래에 동이 나타난 경우
 * 그 조합을 펼쳐 보여 주고, 동이 비공개인 단지는 평형 단위로만 셉니다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

const zones = read('data/zones.json');
const complexesDoc = read('data/complexes.json');
const zoneName = new Map(zones.zones.map((z) => [z.id, z.shortName]));

const realPath = new URL('data/trades/apgujeong.json', ROOT);
const samplePath = new URL('data/trades/sample.json', ROOT);
const trades = existsSync(realPath)
  ? JSON.parse(readFileSync(realPath, 'utf8'))
  : existsSync(samplePath)
    ? JSON.parse(readFileSync(samplePath, 'utf8'))
    : null;

if (!trades) {
  console.error('실거래 데이터가 없습니다. npm run fetch 또는 npm run sample 을 먼저 실행하세요.');
  process.exit(1);
}

// 우선순위: 거래가 많은 평형 = 시장에서 실제로 거래되는 평형 = 먼저 채울 가치가 큼
const rows = [];
for (const c of trades.complexes) {
  const meta = complexesDoc.complexes.find((x) => x.id === c.id);
  // 실거래에 나타난 동 목록. 없으면 동 미상(빈 문자열) 한 줄로 셉니다.
  const dongs = (c.dongs ?? []).length ? c.dongs : [''];
  for (const s of c.sizes) {
    const key = s.area.toFixed(2);
    for (const dong of dongs) {
      const byDong = dong ? meta?.landSharePyeongByDong?.[dong]?.[key] : undefined;
      const common = meta?.landSharePyeong?.[key];
      rows.push({
        zone: zoneName.get(c.zone) ?? c.zone,
        zoneId: c.zone,
        complexId: c.id,
        complex: c.label,
        dong,
        pyeong: s.pyeongLabel,
        area: s.area,
        tradeCount: s.count,
        filled: byDong ?? common ?? null,
        filledBy: Number.isFinite(byDong) ? '동별' : Number.isFinite(common) ? '단지공통' : null,
      });
    }
  }
}
rows.sort((a, b) => {
  if (a.zoneId !== b.zoneId) return a.zoneId.localeCompare(b.zoneId);
  if (a.complex !== b.complex) return a.complex.localeCompare(b.complex, 'ko');
  if (a.dong !== b.dong) return a.dong.localeCompare(b.dong, 'ko', { numeric: true });
  return a.area - b.area;
});

const todo = rows.filter((r) => r.filled === null);
const done = rows.length - todo.length;

if (process.argv.includes('--csv')) {
  // 엑셀에서 바로 열리도록 BOM을 붙입니다.
  const header = '구역,단지,동,평형,전용면적(㎡),실거래건수,대지지분(평) ← 여기에 입력';
  const body = rows
    .map((r) =>
      [r.zone, r.complex, r.dong || '(동 미상)', r.pyeong, r.area, r.tradeCount, r.filled ?? ''].join(','),
    )
    .join('\n');
  const out = new URL('대지지분-입력표.csv', ROOT);
  writeFileSync(out, `﻿${header}\n${body}\n`);
  console.log(`생성: 대지지분-입력표.csv (${rows.length}행)`);
  console.log('맨 오른쪽 칸만 채워서 돌려주시면 데이터에 반영합니다.');
} else {
  const byZone = new Map();
  for (const r of rows) {
    if (!byZone.has(r.zone)) byZone.set(r.zone, { 단지: new Set(), 동: new Set(), 조합: 0, 남음: 0 });
    const e = byZone.get(r.zone);
    e.단지.add(r.complex);
    if (r.dong) e.동.add(`${r.complex}/${r.dong}`);
    e.조합 += 1;
    if (r.filled === null) e.남음 += 1;
  }

  console.log(
    `${trades.isSample ? '※ 합성 샘플 기준 (실거래 수집 후 확정됩니다)\n' : `실거래 ${trades.range.from}~${trades.range.to} 기준\n`}`,
  );
  console.table(
    Object.fromEntries(
      [...byZone].map(([k, v]) => [
        k,
        { 단지수: v.단지.size, '확인된 동': v.동.size, '찾아야 할 조합': v.조합, 미입력: v.남음 },
      ]),
    ),
  );
  console.log(
    '※ 압구정은 동별로 대지지분이 다릅니다. 조사 단위는 단지 × 동 × 평형입니다.',
  );
  console.log(
    '  실거래에 동이 나타난 것만 펼쳤습니다. 국토부가 동을 비공개한 거래는 "(동 미상)"으로 한 줄만 나옵니다.',
  );
  console.log('  실제 동 수는 이보다 많습니다 — 거래가 없던 동은 여기 나타나지 않습니다.\n');
  console.log(`전체: ${rows.length}개 중 ${done}개 입력됨, ${todo.length}개 남음\n`);

  // 거래가 많은 평형 = 먼저 채울 가치가 큰 평형
  const priority = [...todo].sort((a, b) => b.tradeCount - a.tradeCount).slice(0, 15);
  if (priority.length) {
    console.log('먼저 채우면 효과가 큰 평형 (실거래가 많은 순 상위 15개):');
    for (const r of priority) {
      console.log(
        `  ${r.zone}  ${r.complex.padEnd(16, ' ')} ${(r.dong || '동미상').padStart(6, ' ')}동  ${r.pyeong.padStart(6, ' ')}  전용 ${String(r.area).padStart(7, ' ')}㎡  거래 ${String(r.tradeCount).padStart(3, ' ')}건`,
      );
    }
  }
  console.log('\n엑셀 입력표가 필요하면: node scripts/land-share-todo.mjs --csv');
}
