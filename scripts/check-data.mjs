#!/usr/bin/env node
/** 데이터 정합성 점검. node scripts/check-data.mjs */
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

const zones = read('data/zones.json');
const complexes = read('data/complexes.json');
const location = read('data/location.json');
const policy = read('data/policy.json');
const sources = read('data/sources.json');

const problems = [];
const notes = [];
const zoneIds = new Set(zones.zones.map((z) => z.id));
const sourceKeys = new Set(Object.keys(sources.sources));

// 출처 키 참조 검증
const checkSources = (keys, where) => {
  for (const k of keys ?? []) if (!sourceKeys.has(k)) problems.push(`${where}: 없는 출처 키 '${k}'`);
};
for (const z of zones.zones) checkSources(z.sources, `zones/${z.id}`);
for (const c of location.categories) for (const it of c.items) checkSources(it.sources, `location/${c.id}/${it.name}`);
checkSources(policy.jaechohwan.sources, 'policy/jaechohwan');
checkSources(policy.assumptions.constructionCostPerPyeongManKRW.sources, 'policy/assumptions');

// 원고에서 쓰인 출처 키 검증
for (const f of ['00-cover', '01-zones', '02-location', '03-after', '04-schedule', '05-risk', '06-method']) {
  const md = readFileSync(new URL(`content/${f}.md`, ROOT), 'utf8');
  for (const m of md.matchAll(/\[\^src:([A-Za-z0-9_.-]+)\]/g)) {
    if (!sourceKeys.has(m[1])) problems.push(`content/${f}.md: 없는 출처 키 '${m[1]}'`);
  }
}

// 구역 참조 검증
for (const c of complexes.complexes) if (!zoneIds.has(c.zone)) problems.push(`complexes/${c.id}: 없는 구역 '${c.zone}'`);
for (const c of location.categories)
  for (const it of c.items)
    for (const z of it.zones ?? []) if (!zoneIds.has(z)) problems.push(`location/${it.name}: 없는 구역 '${z}'`);

// 별칭 충돌 검증 — 짧은 별칭이 다른 단지 이름에 포함되는 경우.
// 수집 스크립트는 긴 별칭을 먼저 매칭하므로 정상 동작하지만, 별칭을 추가할 때 참고용으로 보고합니다.
const aliases = complexes.complexes.flatMap((c) => c.aliases.map((a) => ({ a: a.replace(/\s+/g, ''), id: c.id })));
const shadowed = new Map();
for (const x of aliases)
  for (const y of aliases)
    if (x.id !== y.id && x.a !== y.a && y.a.includes(x.a)) {
      if (!shadowed.has(x.a)) shadowed.set(x.a, new Set());
      shadowed.get(x.a).add(y.a);
    }
for (const [short, longs] of shadowed)
  notes.push(
    `별칭 '${short}'가 ${[...longs].join(', ')} 에도 포함됩니다 — 긴 별칭 우선 매칭으로 처리됩니다`,
  );

// 단계 검증
for (const z of zones.zones) {
  if (z.stageDone == null) problems.push(`zones/${z.id}: stageDone 없음`);
  else if (z.stageDone < 0 || z.stageDone > zones.stageLadder.length)
    problems.push(`zones/${z.id}: stageDone ${z.stageDone} 범위 밖`);
  if (z.unitsBefore && z.unitsAfter && z.unitsAfter < z.unitsBefore)
    notes.push(`zones/${z.id}: 계획 세대(${z.unitsAfter})가 기존 세대(${z.unitsBefore})보다 적습니다 — 확인 필요`);
}

// 미입력 항목 집계
const missing = [];
for (const z of zones.zones) {
  const gaps = [];
  if (!z.unitsBefore) gaps.push('기존 세대수');
  if (!z.unitsAfter) gaps.push('계획 세대수');
  if (!z.maxFloors) gaps.push('최고 층수');
  if (!z.builder) gaps.push('시공사');
  if (!z.constructionCostBillionKRW) gaps.push('총공사비');
  if (gaps.length) missing.push(`  ${z.shortName}: ${gaps.join(', ')}`);
}
const noShare = complexes.complexes.filter((c) => Object.keys(c.landSharePyeong ?? {}).length === 0);

// 시세 데이터
const tradePath = new URL('data/trades/apgujeong.json', ROOT);
if (!existsSync(tradePath)) {
  notes.push('data/trades/apgujeong.json 없음 — npm run fetch 로 실거래를 채우세요 (현재 샘플로 빌드됩니다)');
} else {
  const t = JSON.parse(readFileSync(tradePath, 'utf8'));
  if (t.unmapped?.length) notes.push(`매칭 안 된 단지명 ${t.unmapped.length}건 — data/complexes.json aliases 확인`);
  const noTrade = complexes.complexes.filter((c) => !t.complexes.some((x) => x.id === c.id));
  if (noTrade.length) notes.push(`실거래가 수집되지 않은 단지: ${noTrade.map((c) => c.label).join(', ')}`);
}

console.log(`출처 ${sourceKeys.size}건 · 구역 ${zones.zones.length}개 · 단지 ${complexes.complexes.length}개 점검\n`);
if (problems.length) {
  console.log('오류:');
  for (const p of problems) console.log(`  ✗ ${p}`);
} else {
  console.log('오류 없음 ✓');
}
if (notes.length) {
  console.log('\n확인 권장:');
  for (const n of [...new Set(notes)]) console.log(`  · ${n}`);
}
if (missing.length) console.log(`\n구역별 미확인 항목:\n${missing.join('\n')}`);
console.log(`\n대지지분 미입력 단지 ${noShare.length}/${complexes.complexes.length}개 — 채우면 '지분당 단가'가 활성화됩니다`);
process.exit(problems.length ? 1 : 0);
