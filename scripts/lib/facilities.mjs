// 구역별 입지 분석에 쓰는 주요 시설 목록과 거리 계산.
//
// 거리는 모두 '직선거리' 입니다. 도보 경로를 계산한 것이 아닙니다 —
// 실제 걷는 거리는 이보다 깁니다. 그래도 구역 사이를 견주는 데는 쓸 수
// 있고, 무엇보다 OSM 좌표에서 그대로 나오는 검증 가능한 숫자입니다.

import { ringsOf, linesOf, centroid, ringArea } from './geo.mjs';

/**
 * OSM 에서 찾을 시설.
 *   kind     — 지도 표식 색
 *   group    — 표의 묶음
 *   priority — 이름표 자리 다툼에서 먼저 놓을 순서 (작을수록 먼저).
 *              작은 지도에서는 모든 이름을 다 넣을 수 없습니다. 자리가 없어
 *              하나를 버려야 할 때, 역이나 백화점보다 학교를 버립니다.
 *   mapLabel — 지도에만 쓰는 짧은 이름 (없으면 label)
 *   onZoneMap: false — 표에는 넣되 구역 지도에는 점을 찍지 않음
 */
export const FACILITY_RULES = [
  { key: 'st-apgujeong', label: '압구정역', kind: 'station', group: '교통', priority: 1,
    rule: { name: '압구정', railway: 'station' } },
  { key: 'st-rodeo', label: '압구정로데오역', kind: 'station', group: '교통', priority: 1,
    mapLabel: '로데오역', rule: { name: '압구정로데오', railway: 'station' } },
  { key: 'galleria', label: '갤러리아', kind: 'shop', group: '상권', priority: 1,
    rule: { name: '갤러리아백화점 이스트' } },

  { key: 'rodeo', label: '로데오거리', kind: 'shop', group: '상권', priority: 2,
    rule: { name: '압구정로데오거리' } },
  { key: 'park-river', label: '잠원한강공원', kind: 'park', group: '한강', priority: 2,
    mapLabel: '한강공원', rule: { name: '잠원한강공원' } },
  { key: 'st-cheongdam', label: '청담역', kind: 'station', group: '교통', priority: 2,
    rule: { name: '청담', railway: 'station' } },

  { key: 'dosan', label: '도산공원', kind: 'park', group: '상권', priority: 3,
    rule: { name: '도산공원' } },
  { key: 'sch-hyundai', label: '현대고', kind: 'school', group: '학교', priority: 3,
    rule: { name: '현대고등학교' } },

  // 압구정초·중·고는 서로 100~300m 안에 붙어 있어 작은 지도에 세 이름을 다
  // 넣을 수 없습니다. 표에는 따로 두고, 지도에는 아래 merged 항목 하나로 씁니다.
  { key: 'sch-ap-el', label: '압구정초', kind: 'school', group: '학교', priority: 4,
    onZoneMap: false, rule: { name: '서울압구정초등학교' } },
  { key: 'sch-ap-mid', label: '압구정중', kind: 'school', group: '학교', priority: 4,
    onZoneMap: false, rule: { name: '압구정중학교' } },
  { key: 'sch-ap-high', label: '압구정고', kind: 'school', group: '학교', priority: 4,
    onZoneMap: false, rule: { name: '압구정고등학교' } },

  { key: 'sch-sinsa', label: '신사중', kind: 'school', group: '학교', priority: 5,
    rule: { name: '신사중학교' } },
  { key: 'sch-cheongdam', label: '청담고', kind: 'school', group: '학교', priority: 5,
    rule: { name: '청담고등학교' } },
];

/** 지도에만 쓰는 묶음 표식 — 서로 붙어 있어 따로 찍으면 이름이 겹칩니다. */
const MERGED = [
  { key: 'sch-apgujeong', mapLabel: '압구정초·중·고', kind: 'school', priority: 3,
    of: ['sch-ap-el', 'sch-ap-mid', 'sch-ap-high'] },
];

/** 위경도 두 점 사이 직선거리 (km). 이 축척에서는 평면 근사로 충분합니다. */
export function distKm(a, b) {
  const R = 6371;
  const t = Math.PI / 180;
  const dLat = (b[1] - a[1]) * t;
  const dLon = (b[0] - a[0]) * t;
  const midLat = ((a[1] + b[1]) / 2) * t;
  return Math.sqrt((dLat * R) ** 2 + (dLon * R * Math.cos(midLat)) ** 2);
}

/** 피처의 대표 지점. */
function anchorOf(f) {
  if (f.geometry?.type === 'Point') return f.geometry.coordinates;
  const ring = ringsOf(f)[0];
  if (ring?.length) return centroid(ring);
  const line = linesOf(f)[0];
  return line?.length ? line[Math.floor(line.length / 2)] : null;
}

const ruleMatches = (rule, f) =>
  Object.entries(rule).every(([k, v]) => (k === 'name' ? f.properties.name === v : f.properties[k] === v));

/** OSM 에서 시설 좌표를 찾습니다. 못 찾은 것은 조용히 빠집니다. */
export function findFacilities(geojson) {
  const out = [];
  for (const spec of FACILITY_RULES) {
    const f = (geojson.features ?? []).find((x) => ruleMatches(spec.rule, x));
    if (!f) continue;
    const at = anchorOf(f);
    if (!at) continue;
    out.push({ ...spec, at });
  }
  return out;
}

/**
 * 구역 지도에 찍을 표식. 붙어 있는 학교들은 하나로 묶고,
 * 이름표 자리 다툼에서 중요한 것이 먼저 놓이도록 정렬합니다.
 */
export function mapMarkers(facilities) {
  const byKey = new Map(facilities.map((f) => [f.key, f]));
  const out = facilities
    .filter((f) => f.onZoneMap !== false)
    .map((f) => ({ ...f, label: f.mapLabel ?? f.label }));

  for (const m of MERGED) {
    const parts = m.of.map((k) => byKey.get(k)).filter(Boolean);
    if (parts.length < 2) continue; // 하나뿐이면 묶을 이유가 없습니다
    const at = [
      parts.reduce((s, p) => s + p.at[0], 0) / parts.length,
      parts.reduce((s, p) => s + p.at[1], 0) / parts.length,
    ];
    out.push({ key: m.key, label: m.mapLabel, kind: m.kind, priority: m.priority, at });
  }

  return out.sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
}

/** 구역 건물들의 면적 가중 중심. '단지 중심' 기준점입니다. */
export function zoneCenter(buildings) {
  let ax = 0;
  let ay = 0;
  let aw = 0;
  for (const f of buildings) {
    for (const ring of ringsOf(f)) {
      const a = Math.abs(ringArea(ring));
      if (!a) continue;
      const [cx, cy] = centroid(ring);
      ax += cx * a;
      ay += cy * a;
      aw += a;
    }
  }
  return aw ? [ax / aw, ay / aw] : null;
}

/**
 * 한강 물가까지의 최단 직선거리.
 * 구역별로 '한강이 얼마나 가까운가'를 비교하는 유일한 객관적 숫자입니다.
 */
export function riverDistanceKm(center, bankLines) {
  let best = Infinity;
  for (const line of bankLines) {
    for (const p of line) {
      const d = distKm(center, p);
      if (d < best) best = d;
    }
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * 구역별 시설 거리표.
 * @returns {Map<string, {center:number[], river:?number, to:Map<string, number>}>}
 */
export function zoneDistances({ zoneBuildings, facilities, bankLines = [] }) {
  const out = new Map();
  for (const [zoneId, buildings] of zoneBuildings) {
    const center = zoneCenter(buildings);
    if (!center) continue;
    const to = new Map();
    for (const fac of facilities) to.set(fac.key, distKm(center, fac.at));
    out.set(zoneId, { center, river: riverDistanceKm(center, bankLines), to });
  }
  return out;
}

/** 구역별로 그 구역에서 가장 가까운 시설 (묶음별). */
export function nearestByGroup(dist, facilities, group) {
  const inGroup = facilities.filter((f) => f.group === group);
  let best = null;
  for (const f of inGroup) {
    const d = dist.to.get(f.key);
    if (d == null) continue;
    if (!best || d < best.km) best = { label: f.label, km: d, key: f.key };
  }
  return best;
}
