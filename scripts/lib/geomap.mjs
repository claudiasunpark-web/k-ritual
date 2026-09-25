// 압구정 실제 지형도 (인라인 SVG).
//
// OpenStreetMap 원본 지형(한강·올림픽대로·건물 윤곽·지하철)을 빌드할 때
// 직접 그립니다. 지도 타일을 불러오지 않으므로:
//   - API 키가 필요 없고, 타일 이용약관·트래픽 제약이 없습니다.
//   - 독자 브라우저에서 추가 요청 없이 즉시 뜨고, 인쇄·PDF 에 그대로 들어갑니다.
//   - 다크 모드에서 색이 같이 바뀝니다 (CSS 토큰을 그대로 씁니다).
// OSM 데이터는 ODbL 입니다. 렌더링 결과물은 Produced Work 이므로
// 출처 표기(© OpenStreetMap 기여자)로 충족됩니다 — 지도 우하단에 넣습니다.

import { escapeHtml } from './format.mjs';
import {
  projector, toPath, ringArea, centroid, pointInRing, bboxOf, inBbox, ringsOf, linesOf, mercY,
  crossesAny, crossPoint,
} from './geo.mjs';

// ── 보여줄 범위 ─────────────────────────────────────────────
// 북: 한강 본류가 띠로 보이는 높이. 남: 압구정로 아래 도산대로 상권까지.
// 서: 동호대교. 동: 영동대교.
const VIEW = { west: 127.0165, south: 37.5225, east: 127.0487, north: 37.5415 };

const W = 980;
// 메르카토르 상에서 실제 비율이 되도록 높이를 계산합니다 (형상이 눌리지 않게).
// mercY 와 경도가 같은 단위(도)여야 합니다 — geo.mjs 의 주석 참고.
const H = Math.round((W * (mercY(VIEW.north) - mercY(VIEW.south))) / (VIEW.east - VIEW.west));

const ZONE_COLOR = {
  z1: 'var(--series-1)', z2: 'var(--series-2)', z3: 'var(--series-3)',
  z4: 'var(--series-4)', z5: 'var(--series-5)', z6: 'var(--series-7)',
};

// 도로 등급별 굵기. 폭이 아니라 '위계'를 보여 주는 값입니다.
// service(주차장 통로·건물 진입로)는 뺐습니다. 이 축척에서 읽히지 않으면서
// 수가 많아 파일만 키웁니다. living_street 은 골목 상권이라 남깁니다.
const ROAD = {
  motorway: 7, trunk: 6.2, primary: 4.6, secondary: 3.2, tertiary: 2.3,
  unclassified: 1.4, residential: 1.4, living_street: 1.2,
  motorway_link: 3, trunk_link: 2.8, primary_link: 2.4, secondary_link: 1.8,
};
const ROAD_ORDER = ['living_street', 'residential', 'unclassified', 'secondary_link', 'primary_link',
  'trunk_link', 'motorway_link', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];

// 지도에 이름을 띄울 주요 시설. OSM 이름이 조금씩 달라 부분 일치로 찾습니다.
// OSM 의 역 이름에는 '역'이 붙지 않습니다 (압구정, 압구정로데오).
// 그래서 railway=station 인 것만 따로 보고, 이름은 우리가 붙입니다.
const POI_RULES = [
  { match: /갤러리아백화점/, label: '갤러리아백화점', kind: 'shop' },
  { match: /^압구정$/, label: '압구정역 (3호선)', kind: 'station', station: true },
  { match: /^압구정로데오$/, label: '압구정로데오역 (수인분당선)', kind: 'station', station: true },
  { match: /^청담$/, label: '청담역 (7호선)', kind: 'station', station: true },
  { match: /^서울압구정초등학교$/, label: '압구정초', kind: 'school' },
  { match: /^압구정중학교$/, label: '압구정중', kind: 'school' },
  { match: /^압구정고등학교$/, label: '압구정고', kind: 'school' },
  { match: /^신사중학교$/, label: '신사중', kind: 'school' },
  { match: /^청담고등학교$/, label: '청담고', kind: 'school' },
  { match: /^현대고등학교$/, label: '현대고', kind: 'school' },
];

// 한강 다리는 OSM 에 '동호대교'가 아니라 그 다리가 나르는 도로 이름으로
// 올라가 있습니다. 어느 도로가 어느 다리인지는 정해져 있으므로 표로 둡니다.
//
// 값은 실제 교차 지점으로 확인했습니다 (도로가 한강 중심선을 건너는 경도):
//   한남대로 127.0127 · 논현로 127.0210 · 언주로 127.0350
// 처음에 '동호로 → 동호대교' 로 적었는데 틀렸습니다. 동호로는 강 북쪽
// 성동구 길이고, 동호대교를 나르는 것은 논현로입니다.
const BRIDGE_BY_ROAD = new Map([
  ['논현로', '동호대교'],
  ['언주로', '성수대교'],
  ['영동대로', '영동대교'],
  ['한남대로', '한남대교'],
]);

// ── 단지 이름 → 구역 찾기 ───────────────────────────────────
function zoneMatcher(complexes) {
  // 긴 별칭을 먼저 봐야 '현대1'이 '현대11'을 삼키지 않습니다.
  const entries = [];
  for (const c of complexes.complexes) {
    for (const alias of c.aliases ?? []) {
      entries.push({ key: alias.replace(/\s+/g, ''), zone: c.zone, label: c.label });
    }
  }
  entries.sort((a, b) => b.key.length - a.key.length);

  return (rawName) => {
    if (!rawName) return null;
    const name = rawName.replace(/\s+/g, '');
    for (const e of entries) {
      if (!name.includes(e.key)) continue;
      // '현대1' 뒤에 숫자가 더 붙으면 다른 단지입니다.
      const at = name.indexOf(e.key);
      const next = name[at + e.key.length];
      if (/\d/.test(e.key.at(-1)) && /\d/.test(next ?? '')) continue;
      return e;
    }
    return null;
  };
}


/**
 * 물가 선(bank)들로 강을 면으로 만듭니다.
 *
 * OSM 의 한강은 멀티폴리곤 관계이고, 그 테두리는 서울 전체를 도는 거대한
 * 고리입니다. 우리가 받은 범위 안에서는 고리가 아니라 '남쪽 물가 선'과
 * '북쪽 물가 선' 두 가닥으로만 들어옵니다. 그래서 고리를 그대로 채울 수 없고,
 * 두 가닥을 남안(서→동) + 북안(동→서) 로 이어 닫아야 강이 띠가 됩니다.
 *
 * 중심선을 기준으로 남/북을 가릅니다. 중심선이 없으면 포기하고 null 을
 * 돌려줍니다 — 잘못 이은 면을 그리느니 선으로 두는 편이 낫습니다.
 */
function riverBand(bankLines, centerline, view) {
  if (!bankLines.length || !centerline?.length) return null;

  // 경도 → 중심선 위도 (선형 보간). 중심선은 서→동 정렬이 아닐 수 있습니다.
  const center = [...centerline].sort((a, b) => a[0] - b[0]);
  const centerLatAt = (lon) => {
    if (lon <= center[0][0]) return center[0][1];
    if (lon >= center[center.length - 1][0]) return center[center.length - 1][1];
    for (let i = 1; i < center.length; i += 1) {
      if (center[i][0] >= lon) {
        const [x0, y0] = center[i - 1];
        const [x1, y1] = center[i];
        return x1 === x0 ? y0 : y0 + ((y1 - y0) * (lon - x0)) / (x1 - x0);
      }
    }
    return center[center.length - 1][1];
  };

  const south = [];
  const north = [];
  for (const line of bankLines) {
    // 화면 경도 구간에 걸치는 가닥만 씁니다.
    const seg = line.filter(([lon]) => lon >= view.west - 0.004 && lon <= view.east + 0.004);
    if (seg.length < 2) continue;
    // 가닥 전체의 평균으로 남/북을 정합니다. 점 하나로 정하면 물가가
    // 구불거리는 곳에서 뒤집힙니다.
    let above = 0;
    for (const [lon, lat] of seg) if (lat > centerLatAt(lon)) above += 1;
    (above > seg.length / 2 ? north : south).push(seg);
  }
  if (!south.length || !north.length) return null;

  // 각 가닥을 서→동으로 맞추고, 가닥들도 서→동 순으로 이어 붙입니다.
  const chain = (groups) => {
    const fixed = groups.map((g) => (g[0][0] <= g[g.length - 1][0] ? g : [...g].reverse()));
    fixed.sort((a, b) => a[0][0] - b[0][0]);
    return fixed.flat();
  };

  const southChain = chain(south);
  const northChain = chain(north);
  // 남안은 서→동, 북안은 동→서로 돌려 닫으면 강 띠가 됩니다.
  return [[...southChain, ...northChain.reverse()]];
}

// ── 본체 ────────────────────────────────────────────────────
/**
 * @param {{geojson:object, zones:object, complexes:object, title?:string, id?:string}} opts
 */
export function geoMap({ geojson, zones, complexes, title = '압구정 실제 지형도', id = 'geo-map' }) {
  const { project, metersPerPx } = projector(VIEW, { width: W, height: H });
  const matchZone = zoneMatcher(complexes);
  const features = geojson.features ?? [];

  // 화면 밖 피처는 일찍 버립니다 (SVG 크기가 크게 줄어듭니다).
  //
  // '꼭짓점이 화면 안에 있는가'로 보면 안 됩니다. 한강처럼 화면을 통째로
  // 가로지르는 피처는 꼭짓점이 모두 화면 밖에 있을 수 있습니다. 경계 상자가
  // 겹치는지로 판정해야 그런 피처가 사라지지 않습니다.
  const viewBbox = [VIEW.west - 0.002, VIEW.south - 0.002, VIEW.east + 0.002, VIEW.north + 0.002];
  const touchesView = (f) => {
    if (f.geometry?.type === 'Point') return inBbox(f.geometry.coordinates, viewBbox);
    const coords = [...ringsOf(f), ...linesOf(f)].flat();
    if (!coords.length) return false;
    const [w, s2, e, n] = bboxOf(coords);
    const [vw, vs, ve, vn] = viewBbox;
    return w <= ve && e >= vw && s2 <= vn && n >= vs;
  };
  const inView = features.filter(touchesView);

  // ── 구역 판정 ─────────────────────────────────────────────
  // 1) 이름 붙은 폴리곤을 별칭으로 맞춥니다.
  // 2) 이름 없는 건물은 위 1)에서 맞은 구획 안에 있으면 그 구역을 물려받습니다.
  //    OSM 은 단지를 landuse=residential 한 덩이로, 동을 개별 building 으로
  //    올려 둔 곳이 많아 이 두 단계가 다 필요합니다.
  const zoneOf = new Map(); // feature → {zone,label}
  const anchors = []; // 구역이 확정된 '구획' 폴리곤 (점 검사 대상)

  for (const f of inView) {
    const hit = matchZone(f.properties.name);
    if (!hit) continue;
    zoneOf.set(f, hit);
    const isPlot = f.properties.landuse || f.properties.place || !f.properties.building;
    for (const ring of ringsOf(f)) {
      if (ring.length < 4) continue;
      // 구획으로 쓸 만큼 큰 폴리곤만 (동 하나짜리 건물은 앵커로 쓰지 않습니다).
      const big = Math.abs(ringArea(ring)) > 2e-7;
      if (isPlot || big) anchors.push({ ring, bbox: bboxOf(ring), hit });
    }
  }

  for (const f of inView) {
    if (!f.properties.building || zoneOf.has(f)) continue;
    const ring = ringsOf(f)[0];
    if (!ring || ring.length < 4) continue;
    const c = centroid(ring);
    for (const a of anchors) {
      if (!inBbox(c, a.bbox)) continue;
      if (pointInRing(c, a.ring)) { zoneOf.set(f, a.hit); break; }
    }
  }

  // ── 레이어별 분류 ─────────────────────────────────────────
  const water = [];
  const greens = [];
  const institutions = [];
  const buildings = [];
  const roadsBy = new Map(ROAD_ORDER.map((k) => [k, []]));
  const subway = [];
  const bridgeCandidates = [];
  const pois = [];

  for (const f of inView) {
    const p = f.properties;
    if (p.natural === 'water' || /^(riverbank|river|stream|canal)$/.test(p.waterway ?? '')) {
      water.push(f);
      continue;
    }
    if (p.railway === 'subway') { subway.push(f); continue; }
    if (p.highway && ROAD[p.highway]) {
      roadsBy.get(p.highway)?.push(f);
      if (p.bridge === 'yes' && p.name && BRIDGE_BY_ROAD.has(p.name)) bridgeCandidates.push(f);
      continue;
    }
    if (/^(park|garden|pitch|sports_centre)$/.test(p.leisure ?? '')) { greens.push(f); continue; }
    if (/^(school|university|hospital|kindergarten)$/.test(p.amenity ?? '') && ringsOf(f).length) {
      institutions.push(f);
      continue;
    }
    if (p.building) { buildings.push(f); continue; }
  }

  // 강을 실제로 가로지르는 것만 한강 다리입니다.
  // 강 '중심선'만 씁니다. 연못·저수지 폴리곤까지 넣으면 그 테두리를 스치는
  // 고가도로가 다리로 잡힙니다.
  const riverLines = water
    .filter((f) => f.properties.waterway === 'river' && f.properties.name === '한강')
    .flatMap((f) => linesOf(f))
    .filter((l) => l.length >= 2);
  const bridges = riverLines.length
    ? bridgeCandidates.filter((f) => linesOf(f).some((l) => crossesAny(l, riverLines)))
    : [];

  for (const f of inView) {
    const name = f.properties.name;
    if (!name) continue;
    const rule = POI_RULES.find((r) => r.match.test(name)
      && (!r.station || f.properties.railway === 'station'));
    if (!rule) continue;
    if (pois.some((x) => x.label === rule.label)) continue; // 중복 표시 방지
    const at = f.geometry.type === 'Point'
      ? f.geometry.coordinates
      : centroid(ringsOf(f)[0] ?? linesOf(f)[0] ?? []);
    if (!at?.length) continue;
    pois.push({ ...rule, at });
  }

  // ── 그리기 ────────────────────────────────────────────────
  const out = [];
  const push = (s) => out.push(s);

  push(`<rect width="${W}" height="${H}" fill="var(--map-land)"/>`);

  // 한강 — 물가 선 두 가닥을 이어 면으로 만듭니다.
  const bankLines = water.filter((f) => f.properties.bank === 'yes').flatMap((f) => linesOf(f));
  const centerline = water
    .find((f) => f.properties.waterway === 'river' && f.properties.name === '한강')
    ?.geometry?.coordinates;
  const band = riverBand(bankLines, centerline, VIEW);

  const ponds = water.filter((f) => f.properties.bank !== 'yes' && ringsOf(f).length);
  const pondPath = ponds.map((f) => toPath(ringsOf(f), project, { close: true })).filter(Boolean).join(' ');

  if (band) {
    push(`<path d="${toPath(band, project, { close: true })}" fill="var(--map-water)"/>`);
  } else {
    // 물가 선을 못 받았으면 중심선을 굵게 그립니다. 폭은 실제와 다르므로
    // 면인 척하지 않고 선으로 둡니다.
    const lines = water.filter((f) => !ringsOf(f).length)
      .map((f) => toPath(linesOf(f), project)).filter(Boolean).join(' ');
    if (lines) push(`<path d="${lines}" fill="none" stroke="var(--map-water)" stroke-width="5"/>`);
  }
  if (pondPath) push(`<path d="${pondPath}" fill="var(--map-water)"/>`);

  // 공원·녹지
  const greenPath = greens.map((f) => toPath(ringsOf(f), project, { close: true })).filter(Boolean).join(' ');
  if (greenPath) push(`<path d="${greenPath}" fill="var(--map-green)"/>`);

  // 학교·병원 부지
  const instPath = institutions.map((f) => toPath(ringsOf(f), project, { close: true })).filter(Boolean).join(' ');
  if (instPath) push(`<path d="${instPath}" fill="var(--map-inst)"/>`);

  // 도로 — 테두리(casing)를 먼저 전부 깔고 그 위에 채움선을 올려야
  // 교차로에서 선이 끊겨 보이지 않습니다.
  const roadPaths = ROAD_ORDER
    .map((k) => ({ k, d: roadsBy.get(k).map((f) => toPath(linesOf(f), project)).filter(Boolean).join(' ') }))
    .filter((r) => r.d);
  push('<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="var(--map-road-edge)">');
  for (const r of roadPaths) push(`<path d="${r.d}" stroke-width="${ROAD[r.k] + 1.4}"/>`);
  push('</g>');
  push('<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="var(--map-road)">');
  for (const r of roadPaths) push(`<path d="${r.d}" stroke-width="${ROAD[r.k]}"/>`);
  push('</g>');

  // 지하철 (점선)
  const subPath = subway.map((f) => toPath(linesOf(f), project)).filter(Boolean).join(' ');
  if (subPath) {
    push(`<path d="${subPath}" fill="none" stroke="var(--map-rail)" stroke-width="1.6"`
      + ' stroke-dasharray="7 5" opacity="0.85"/>');
  }

  // 건물 — 구역 밖은 회색 한 덩이로, 구역 안은 구역색으로.
  const other = buildings.filter((f) => !zoneOf.has(f));
  const otherPath = other
    .map((f) => toPath(ringsOf(f), project, { close: true, decimals: 0 }))
    .filter(Boolean).join(' ');
  if (otherPath) {
    push(`<path d="${otherPath}" fill="var(--map-bldg)" stroke="var(--map-bldg-edge)" stroke-width="0.4"/>`);
  }

  const zoneList = zones.zones;
  const perZone = new Map(zoneList.map((z) => [z.id, []]));
  for (const [f, hit] of zoneOf) {
    if (!f.properties.building) continue; // 구획 폴리곤은 칠하지 않습니다 (건물만)
    perZone.get(hit.zone)?.push(f);
  }

  push(`<g class="geomap__zones">`);
  for (const z of zoneList) {
    const list = perZone.get(z.id) ?? [];
    if (!list.length) continue;
    const d = list.map((f) => toPath(ringsOf(f), project, { close: true })).filter(Boolean).join(' ');
    push(`<g class="geomap__zone" data-zone="${z.id}">`
      + `<title>${escapeHtml(z.name ?? z.id)}</title>`
      + `<path d="${d}" fill="${ZONE_COLOR[z.id]}" fill-opacity="0.82"`
      + ` stroke="${ZONE_COLOR[z.id]}" stroke-width="0.6"/></g>`);
  }
  push('</g>');

  // ── 라벨 ──────────────────────────────────────────────────
  // 구역 이름은 그 구역 건물들의 면적 가중 중심에 둡니다.
  const labels = [];
  for (const z of zoneList) {
    const list = perZone.get(z.id) ?? [];
    if (!list.length) continue;
    let ax = 0; let ay = 0; let aw = 0;
    for (const f of list) {
      for (const ring of ringsOf(f)) {
        const a = Math.abs(ringArea(ring));
        if (!a) continue;
        const [cx, cy] = centroid(ring);
        ax += cx * a; ay += cy * a; aw += a;
      }
    }
    if (!aw) continue;
    labels.push({ at: [ax / aw, ay / aw], text: z.shortName ?? z.name ?? z.id, zone: z.id, weight: 1 });
  }

  push('<g class="geomap__labels">');
  for (const l of labels) {
    const [x, y] = project(l.at);
    push(`<text class="geomap__zonelabel" x="${x.toFixed(1)}" y="${y.toFixed(1)}"`
      + ` data-zone="${l.zone}" text-anchor="middle">${escapeHtml(l.text)}</text>`);
  }
  push('</g>');

  // 한강 / 올림픽대로 / 압구정로 이름은 실제 선을 따라, 그 선의 방향으로 씁니다.
  //
  // 화면을 가로지르는 긴 선은 꼭짓점이 대부분 화면 밖에 있습니다. 그래서
  // '화면 안 꼭짓점만' 쓰면 라벨이 아예 안 붙습니다. 화면 안 점이 2개 미만이면
  // 전체 꼭짓점으로 방향을 잡고, 글자 위치만 화면 안으로 당겨 넣습니다.
  const MARGIN = 26;
  const labelOnLine = (re, text, cls, opts = {}) => {
    const cand = inView.filter((f) => f.properties.name && re.test(f.properties.name)
      && (!opts.bridgeOnly || f.properties.bridge === 'yes'));
    if (!cand.length) return;

    // 화면 안에 있는 꼭짓점만 씁니다. 화면 밖 선의 이름표를 테두리로 끌어오면
    // 거기 있지도 않은 것이 지도에 적히게 됩니다(한남대교가 그렇게 잘못 찍혔습니다).
    let best = null; // 화면 안에 가장 길게 걸친 조각
    for (const f of cand) {
      for (const line of [...linesOf(f), ...ringsOf(f)]) {
        if (line.length < 2) continue;
        const shown = line.filter((c) => inBbox(c, viewBbox));
        if (shown.length < 2) continue;
        if (!best || shown.length > best.length) best = shown;
      }
    }
    if (!best) return;

    const mid = Math.floor(best.length / 2);
    const a = project(best[Math.max(0, mid - 2)]);
    const b = project(best[Math.min(best.length - 1, mid + 2)]);
    let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;

    const [px, py] = project(best[mid]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    // 글자가 테두리에 걸리면 살짝만 당깁니다. 이미 화면 안 점이므로
    // 위치가 크게 어긋나지 않습니다.
    const x = Math.min(Math.max(px, MARGIN), W - MARGIN);
    const y = Math.min(Math.max(py, MARGIN), H - MARGIN);

    push(`<text class="${cls}" x="${x.toFixed(1)}" y="${(y + (opts.dy ?? 0)).toFixed(1)}"`
      + ` text-anchor="middle" transform="rotate(${deg.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">`
      + `${escapeHtml(text)}</text>`);
  };

  labelOnLine(/^한강$/, '한 강', 'geomap__water-label', { dy: -6 });
  labelOnLine(/올림픽대로/, '올림픽대로', 'geomap__road-label');
  labelOnLine(/^압구정로$/, '압구정로', 'geomap__road-label');
  labelOnLine(/^도산대로$/, '도산대로', 'geomap__road-label');
  labelOnLine(/^언주로$/, '언주로', 'geomap__road-label');
  // 다리 이름은 '강을 건너는 그 자리'에 찍습니다. 선 전체의 가운데에 찍으면
  // 강에서 한참 떨어진 접속도로 위에 다리 이름이 올라갑니다. 건너는 지점이
  // 화면 밖이면 아예 쓰지 않습니다 — 없는 자리에 이름이 적히는 것보다 낫습니다.
  const bridgeDone = new Set();
  for (const f of bridges) {
    const road = f.properties.name;
    if (bridgeDone.has(road)) continue; // 상·하행 여러 조각으로 올라와 있습니다
    for (const line of linesOf(f)) {
      const hit = crossPoint(line, riverLines);
      if (!hit) continue;
      const [lon, lat] = hit.at;
      if (lon < VIEW.west || lon > VIEW.east || lat < VIEW.south || lat > VIEW.north) continue;
      const [x, y] = project(hit.at);
      const [dxp, dyp] = [project([lon + hit.dir[0] * 1e-4, lat + hit.dir[1] * 1e-4])[0] - x,
        project([lon + hit.dir[0] * 1e-4, lat + hit.dir[1] * 1e-4])[1] - y];
      let deg = (Math.atan2(dyp, dxp) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      push(`<text class="geomap__bridge-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}"`
        + ` text-anchor="middle" transform="rotate(${deg.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">`
        + `${escapeHtml(BRIDGE_BY_ROAD.get(road))}</text>`);
      bridgeDone.add(road);
      break;
    }
  }

  // 주요 시설
  // 표시 색은 쓰지 않습니다. 색은 구역에만 쓰고, 시설은 크기·굵기로 위계를
  // 나눕니다. 그러지 않으면 시설 색과 구역 색이 서로 간섭합니다.
  const KIND_MARK = {
    station: 'fill="var(--text-primary)"',
    shop: 'fill="var(--text-primary)"',
    school: 'fill="var(--text-muted)"',
  };
  push('<g class="geomap__pois">');
  for (const poi of pois) {
    const [x, y] = project(poi.at);
    if (x < 0 || x > W || y < 0 || y > H) continue;
    const r = poi.kind === 'school' ? 2.6 : poi.kind === 'shop' ? 5.5 : 4.5;
    push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" ${KIND_MARK[poi.kind]}`
      + ' stroke="var(--map-land)" stroke-width="1.4"/>');
    push(`<text class="geomap__poi geomap__poi--${poi.kind}" x="${x.toFixed(1)}"`
      + ` y="${(y - r - 4).toFixed(1)}" text-anchor="middle">${escapeHtml(poi.label)}</text>`);
  }
  push('</g>');

  // ── 축척 바 · 방위 · 출처 ─────────────────────────────────
  const targetPx = 140;
  const nice = [100, 200, 250, 500, 1000].reduce(
    (best, m) => (Math.abs(m / metersPerPx - targetPx) < Math.abs(best / metersPerPx - targetPx) ? m : best),
    100,
  );
  const barPx = nice / metersPerPx;
  const bx = 18;
  const by = H - 20;
  push(`<g class="geomap__scale"><line x1="${bx}" y1="${by}" x2="${(bx + barPx).toFixed(1)}" y2="${by}"/>`
    + `<line x1="${bx}" y1="${by - 4}" x2="${bx}" y2="${by + 4}"/>`
    + `<line x1="${(bx + barPx).toFixed(1)}" y1="${by - 4}" x2="${(bx + barPx).toFixed(1)}" y2="${by + 4}"/>`
    + `<text x="${(bx + barPx / 2).toFixed(1)}" y="${by - 7}" text-anchor="middle">${nice}m</text></g>`);

  push(`<g class="geomap__north" transform="translate(${W - 30} 26)">`
    + '<path d="M0 -13 L5.5 9 L0 4 L-5.5 9 Z" fill="var(--text-secondary)"/>'
    + '<text y="22" text-anchor="middle">N</text></g>');

  push(`<text class="geomap__credit" x="${W - 10}" y="${H - 8}" text-anchor="end">`
    + '© OpenStreetMap 기여자 (ODbL)</text>');

  // ── 범례 (구역 강조 버튼) ─────────────────────────────────
  const legend = zoneList.map((z) => {
    const n = (perZone.get(z.id) ?? []).length;
    return `<button type="button" class="geomap__key" data-zone="${z.id}" aria-pressed="false"`
      + ` ${n ? '' : 'disabled '}title="${n ? `건물 ${n}동 표시` : '이 구역 건물 윤곽이 지도 데이터에 없습니다'}">`
      + `<span class="geomap__swatch" style="background:${ZONE_COLOR[z.id]}"></span>`
      + `${escapeHtml(z.shortName ?? z.name ?? z.id)}</button>`;
  }).join('');

  const matched = [...perZone.values()].reduce((s, l) => s + l.length, 0);

  return `<figure class="geomap" data-widget="geo-map" id="${id}">
  <figcaption class="geomap__title">${escapeHtml(title)}</figcaption>
  <div class="geomap__legend" role="group" aria-label="구역 강조">${legend}
    <button type="button" class="geomap__key geomap__key--reset" data-zone="">전체</button>
  </div>
  <div class="geomap__frame">
    <svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet"
         aria-label="${escapeHtml(title)} — 한강, 올림픽대로, 압구정 6개 구역 단지 건물 윤곽, 지하철역과 갤러리아백화점 위치">
      ${out.join('\n      ')}
    </svg>
  </div>
  <p class="geomap__note">건물 윤곽·도로·한강은 OpenStreetMap 실제 지형입니다(${escapeHtml(geojson.fetchedAt ?? '')} 기준).
  색을 입힌 건물 ${matched}동은 단지명으로 구역을 맞춘 것이고, 회색 건물은 구역 밖입니다.
  <strong>정비구역 경계선이 아닙니다</strong> — 구역 경계의 법적 기준은 서울시 정비구역 지정 고시입니다.</p>
</figure>`;
}

export const geoMapView = { W, H, VIEW };
