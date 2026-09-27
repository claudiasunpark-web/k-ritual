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
    rule: { name: '갤러리아백화점 이스트', shop: 'department_store' } },
  // OSM 에는 이름이 '현대' 한 글자로만 올라와 있습니다 (압구정로 현대백화점).
  { key: 'hyundai-dept', label: '현대백화점', kind: 'shop', group: '상권', priority: 1,
    mapLabel: '현대百', rule: { name: '현대', shop: 'department_store' } },

  { key: 'rodeo', label: '로데오거리', kind: 'shop', group: '상권', priority: 2,
    rule: { name: '압구정로데오거리', landuse: 'retail' } },
  { key: 'park-river', label: '잠원한강공원', kind: 'park', group: '한강', priority: 2,
    mapLabel: '한강공원', rule: { name: '잠원한강공원', leisure: 'park' } },
  { key: 'st-cheongdam', label: '청담역', kind: 'station', group: '교통', priority: 2,
    rule: { name: '청담', railway: 'station' } },

  { key: 'dosan', label: '도산공원', kind: 'park', group: '상권', priority: 3,
    rule: { name: '도산공원', leisure: 'park' } },
  { key: 'sch-hyundai', label: '현대고', kind: 'school', group: '학교', priority: 3,
    rule: { name: '현대고등학교', amenity: 'school' } },

  // 압구정초·중·고는 서로 100~300m 안에 붙어 있어 작은 지도에 세 이름을 다
  // 넣을 수 없습니다. 표에는 따로 두고, 지도에는 아래 merged 항목 하나로 씁니다.
  { key: 'sch-ap-el', label: '압구정초', kind: 'school', group: '학교', priority: 4,
    onZoneMap: false, rule: { name: '서울압구정초등학교', amenity: 'school' } },
  { key: 'sch-ap-mid', label: '압구정중', kind: 'school', group: '학교', priority: 4,
    onZoneMap: false, rule: { name: '압구정중학교', amenity: 'school' } },
  { key: 'sch-ap-high', label: '압구정고', kind: 'school', group: '학교', priority: 4,
    onZoneMap: false, rule: { name: '압구정고등학교', amenity: 'school' } },

  { key: 'sch-sinsa', label: '신사중', kind: 'school', group: '학교', priority: 4,
    rule: { name: '신사중학교', amenity: 'school' } },
  { key: 'sch-singu-el', label: '신구초', kind: 'school', group: '학교', priority: 5,
    rule: { name: '서울신구초등학교', amenity: 'school' } },
  { key: 'sch-singu-mid', label: '신구중', kind: 'school', group: '학교', priority: 5,
    rule: { name: '신구중학교', amenity: 'school' } },

  // 청담초·청담중은 서로 100m 안이라 지도에서는 묶습니다.
  { key: 'sch-cd-el', label: '청담초', kind: 'school', group: '학교', priority: 5,
    onZoneMap: false, rule: { name: '서울청담초등학교', amenity: 'school' } },
  { key: 'sch-cd-mid', label: '청담중', kind: 'school', group: '학교', priority: 5,
    onZoneMap: false, rule: { name: '청담중학교', amenity: 'school' } },
  // 이전 예정이라 따로 둡니다 — 묶어 버리면 그 사실이 가려집니다.
  { key: 'sch-cheongdam', label: '청담고', mapLabel: '청담고(이전예정)',
    kind: 'school', group: '학교', priority: 4,
    caveat: '이전 예정 — 시점·이전지 확인 필요',
    rule: { name: '청담고등학교', amenity: 'school' } },
];

/** 지도에만 쓰는 묶음 표식 — 서로 붙어 있어 따로 찍으면 이름이 겹칩니다. */
const MERGED = [
  { key: 'sch-apgujeong', mapLabel: '압구정초·중·고', kind: 'school', priority: 3,
    of: ['sch-ap-el', 'sch-ap-mid', 'sch-ap-high'] },
  { key: 'sch-cd', mapLabel: '청담초·중', kind: 'school', priority: 5,
    of: ['sch-cd-el', 'sch-cd-mid'] },
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

/** 한 지점에서 시설의 가장 가까운 꼭짓점까지 (km). */
export function nearestKm(from, fac) {
  const pts = fac.pts?.length ? fac.pts : [fac.at];
  let best = Infinity;
  for (const p of pts) {
    const d = distKm(from, p);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : null;
}

/** 피처의 대표 지점 — 지도에 점을 찍을 자리. */
function anchorOf(f) {
  if (f.geometry?.type === 'Point') return f.geometry.coordinates;
  const ring = ringsOf(f)[0];
  if (ring?.length) return centroid(ring);
  const line = linesOf(f)[0];
  return line?.length ? line[Math.floor(line.length / 2)] : null;
}

/** 피처의 모든 꼭짓점 — 거리를 잴 때 씁니다. */
function vertsOf(f) {
  if (f.geometry?.type === 'Point') return [f.geometry.coordinates];
  const pts = [...ringsOf(f), ...linesOf(f)].flat().filter((c) => Array.isArray(c) && c.length === 2);
  return pts.length ? pts : [];
}

const ruleMatches = (rule, f) =>
  Object.entries(rule).every(([k, v]) => (k === 'name' ? f.properties.name === v : f.properties[k] === v));

/**
 * OSM 에서 시설 좌표를 찾습니다.
 *
 * 규칙에는 반드시 판별 태그가 있어야 합니다. 이름만으로 찾으면 같은 이름의
 * 버스정류장을 집습니다 — '도산공원'·'신사중학교'·'신구중학교' 는 정류장
 * 이름으로도 등록되어 있어, 실제로 좌표 세 개가 정류장 위치로 잡혀 있었습니다.
 * 좌표가 하나 틀리면 그 시설까지의 거리가 책 전체에서 틀립니다.
 */
export function findFacilities(geojson) {
  const out = [];
  const missing = [];
  for (const spec of FACILITY_RULES) {
    const keys = Object.keys(spec.rule);
    if (keys.length < 2 || !keys.some((k) => k !== 'name')) {
      throw new Error(`시설 규칙 '${spec.key}' 에 판별 태그가 없습니다 — 이름만으로는 정류장과 구분되지 않습니다`);
    }
    const hits = (geojson.features ?? []).filter((x) => ruleMatches(spec.rule, x));
    if (!hits.length) { missing.push(spec.key); continue; }
    // 같은 시설이 점과 면으로 두 번 올라온 경우가 있습니다. 면을 씁니다.
    const f = hits.find((x) => x.geometry?.type !== 'Point') ?? hits[0];
    const at = anchorOf(f);
    if (!at) { missing.push(spec.key); continue; }
    // 거리는 '가장 가까운 지점' 으로 잽니다. 무게중심으로 재면 잠원한강공원처럼
    // 긴 띠 모양인 것이 엉뚱한 곳으로 잡힙니다 (실제로 강 남쪽 1km 로 잡혀
    // 있었습니다). 백화점처럼 작은 건물은 두 방식이 거의 같습니다.
    out.push({ ...spec, at, pts: vertsOf(f) });
  }
  if (missing.length) console.warn(`  ! 좌표를 못 찾은 시설: ${missing.join(', ')}`);
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
    for (const fac of facilities) to.set(fac.key, nearestKm(center, fac));
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

// ── 대중교통 ────────────────────────────────────────────────
/**
 * 버스정류장·지하철 출입구를 모읍니다.
 *
 * 정류장은 같은 이름이 상·하행으로 두 개씩 올라와 있습니다. 개수를 셀 때는
 * 둘 다 실제 정류장이므로 그대로 세고, '가장 가까운 정류장 이름' 을 고를 때만
 * 이름으로 묶습니다 — 같은 이름이 두 번 나오면 읽는 사람이 헷갈립니다.
 */
export function findTransit(geojson) {
  const stops = [];
  const entrances = [];
  for (const f of geojson.features ?? []) {
    if (f.geometry?.type !== 'Point') continue;
    const p = f.properties;
    const at = f.geometry.coordinates;
    if (p.highway === 'bus_stop') stops.push({ at, name: p.name ?? null });
    else if (p.railway === 'subway_entrance') entrances.push({ at, name: p.name ?? null });
  }
  return { stops, entrances };
}

/**
 * 한 지점에서 본 대중교통 접근성.
 * @param {number} radiusM 개수를 셀 반경 (m)
 */
export function transitAccess(center, { stops = [], entrances = [] }, radiusM = 300) {
  const nearest = (list) => {
    let best = null;
    for (const s of list) {
      const km = distKm(center, s.at);
      if (!best || km < best.km) best = { km, name: s.name };
    }
    return best;
  };
  const within = (list) => list.filter((s) => distKm(center, s.at) * 1000 <= radiusM).length;

  return {
    bus: nearest(stops),
    busWithin: within(stops),
    entrance: nearest(entrances),
    radiusM,
  };
}

/**
 * 사람이 읽는 거리 문구.
 * 1km 미만은 10m 단위로 줄입니다 — 직선거리를 1m 단위로 쓰면 실측한 것처럼
 * 보입니다. 반올림해서 1000m 가 되면 km 로 적습니다.
 */
export function formatKm(v) {
  if (v == null) return '—';
  const m = Math.round((v * 1000) / 10) * 10;
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

// ── 도로 진출입 ─────────────────────────────────────────────
/**
 * 구역별로 가장 가까운 진출입 지점.
 *
 * 램프(motorway_link/trunk_link 등)의 꼭짓점 중 가장 가까운 점을 찾습니다.
 * 램프는 올림픽대로·강변북로·경부고속도로 연결로가 모두 섞여 있으므로,
 * '어느 도로로 들어가는 램프인지' 는 이 자료로 단정할 수 없습니다.
 * 그래서 이름을 붙이지 않고 '가장 가까운 진출입' 으로만 씁니다.
 */
export function rampPoints(geojson) {
  const pts = [];
  for (const f of geojson.features ?? []) {
    if (!/_link$/.test(f.properties.highway ?? '')) continue;
    for (const line of linesOf(f)) for (const c of line) pts.push(c);
  }
  return pts;
}

/** 강을 건너는 다리의 꼭짓점 — 강변북로·강북 방면 접근에 씁니다. */
export function bridgePoints(geojson, names) {
  const want = new Set(names);
  const pts = [];
  for (const f of geojson.features ?? []) {
    const p = f.properties;
    if (p.bridge !== 'yes' || !want.has(p.name)) continue;
    for (const line of linesOf(f)) for (const c of line) pts.push(c);
  }
  return pts;
}

/** 여러 점 중 가장 가까운 것. */
export function nearestPoint(from, pts) {
  let best = null;
  for (const p of pts) {
    const km = distKm(from, p);
    if (!best || km < best.km) best = { at: p, km };
  }
  return best;
}
