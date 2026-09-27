// 입지 항목별 작은 위치도 (인라인 SVG).
//
// 큰 지형도와 같은 좌표계·같은 범위를 씁니다. 그래야 독자가 큰 지도에서 본
// 위치를 작은 지도에서 그대로 찾을 수 있습니다.
//
// 한 페이지에 스무 장 넘게 들어가므로 같은 그림을 그만큼 넣으면 안 됩니다.
// 바탕(한강·큰길·구역 건물·상업용 건물·램프)은 <defs> 에 한 번만 두고
// <use> 로 불러옵니다. 강조할 때도 같은 path 를 색만 바꿔 다시 <use> 합니다.

import { escapeHtml } from './format.mjs';
import { projector, toPath, ringsOf, linesOf, thin, centroid, mercY } from './geo.mjs';
import { geoMapView } from './geomap.mjs';

// 화면 두 종류를 씁니다.
//   full — 큰 지형도와 같은 범위. 위치를 견주는 데 씁니다.
//   zoom — 압구정 블록만. 정류장·램프처럼 작은 것이 전체 범위에서는
//          점 몇 픽셀로 뭉쳐 버려서 확대가 필요합니다.
const ZOOM_VIEW = { west: 127.0180, south: 37.5230, east: 127.0460, north: 37.5345 };

function makeView(view, width, prefix) {
  const height = Math.round((width * (mercY(view.north) - mercY(view.south))) / (view.east - view.west));
  const { project } = projector(view, { width, height });
  return {
    view, W: width, H: height, project, prefix,
    baseId: `${prefix}base`,
    zoneRef: (id) => `${prefix}z-${id}`,
    onScreen: ([x, y]) => Number.isFinite(x) && x >= -6 && x <= width + 6 && y >= -6 && y <= height + 6,
  };
}

const FULL = makeView(geoMapView.VIEW, 320, 'loc');
const ZOOM = makeView(ZOOM_VIEW, 640, 'locz2');

// 기존 호출부 호환용
const W = FULL.W;
const H = FULL.H;
const VIEW = FULL.view;
const BASE_ID = FULL.baseId;
const zoneRef = FULL.zoneRef;
const { project } = FULL;
const onScreen = FULL.onScreen;

/** 규칙과 OSM 피처가 맞는지. label 은 표시용이라 비교에서 뺍니다. */
function matches(rule, f) {
  if (typeof rule === 'string') return f.properties.name === rule;
  return Object.entries(rule).every(([k, v]) => {
    if (k === 'label') return true;
    return k === 'name' ? f.properties.name === v : f.properties[k] === v;
  });
}

const findAll = (geojson, rule) => (geojson.features ?? []).filter((f) => matches(rule, f));

/** 피처의 대표 지점 (점은 그대로, 면은 무게중심, 선은 가운데). */
function anchorOf(f) {
  if (f.geometry?.type === 'Point') return f.geometry.coordinates;
  const ring = ringsOf(f)[0];
  if (ring?.length) return centroid(ring);
  const line = linesOf(f)[0];
  return line?.length ? line[Math.floor(line.length / 2)] : null;
}

/**
 * 이름표를 겹치지 않게 놓습니다.
 * 작은 지도라 글자 두 개만 겹쳐도 못 읽습니다. 위 → 아래 → 오른쪽 → 왼쪽
 * 순으로 빈자리를 찾고, 다 막히면 포기합니다 (겹쳐 쓰느니 안 쓰는 편이 낫습니다).
 */
function labelPlacer(V = FULL) {
  const taken = [];
  const fits = (box) => !taken.some((t) => !(box.x2 < t.x1 || box.x1 > t.x2 || box.y2 < t.y1 || box.y1 > t.y2));

  return (x, y, text, cls = 'locmap__label') => {
    // 한글은 폭이 넓습니다. 좁게 잡으면 겹쳐도 통과해 버립니다.
    const w = text.length * 7.2 + 6;
    const h = 13;
    const spots = [
      { dx: 0, dy: -9, anchor: 'middle' },
      { dx: 0, dy: 15, anchor: 'middle' },
      { dx: 8, dy: 4, anchor: 'start' },
      { dx: -8, dy: 4, anchor: 'end' },
      { dx: 0, dy: -20, anchor: 'middle' },
    ];
    for (const s of spots) {
      const cx = x + s.dx;
      const cy = y + s.dy;
      const x1 = s.anchor === 'middle' ? cx - w / 2 : s.anchor === 'start' ? cx : cx - w;
      const box = { x1, x2: x1 + w, y1: cy - h, y2: cy + 3 };
      if (box.x1 < 2 || box.x2 > V.W - 2 || box.y1 < 2 || box.y2 > V.H - 2) continue;
      if (!fits(box)) continue;
      taken.push(box);
      return `<text class="${cls}" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}"`
        + ` text-anchor="${s.anchor}">${escapeHtml(text)}</text>`;
    }
    return '';
  };
}

// ── 바탕 ────────────────────────────────────────────────────
/**
 * 바탕 그림과 다시 쓰는 path 들. 페이지에 한 번만 들어갑니다.
 */
export function locatorBase({ geojson, zoneBuildings, riverBandRings, transit = {} }) {
  const out = { defs: [], symbols: [], zoneIds: new Set(), caps: {} };
  for (const V of [FULL, ZOOM]) buildOneBase(V, { geojson, zoneBuildings, riverBandRings, transit }, out);
  return {
    symbol: '<svg class="locmap__defs" width="0" height="0" aria-hidden="true" focusable="false">'
      + `<defs>${out.defs.join('')}${out.symbols.join('')}</defs></svg>`,
    zoneIds: out.zoneIds,
    ...out.caps,
  };
}

function buildOneBase(V, { geojson, zoneBuildings, riverBandRings, transit = {} }, out) {
  const { project, W: w, H: h, onScreen: vis } = V;
  const defs = out.defs;
  const base = [`<rect width="${w}" height="${h}" fill="var(--map-land)"/>`];
  const feats = geojson.features ?? [];
  const id = (name) => `${V.prefix}-${name}`;
  // 확대 화면은 축척이 달라 같은 굵기·반지름이면 더 얇고 작게 보입니다.
  const scale = V === ZOOM ? 1.6 : 1;

  if (riverBandRings?.length) {
    // 물가 선은 촘촘합니다. 이 크기에서는 3점마다 하나면 모양이 같습니다.
    const d = toPath(riverBandRings.map((r) => thin(r, 3)), project, { close: true });
    if (d) base.push(`<path d="${d}" fill="var(--map-water)"/>`);
  }

  // 상업용 건물 — 상권이 어디인지는 이 분포가 말해 줍니다. 경계를 지어내지
  // 않고도 '어디가 상권인가'를 보여 주는 유일하게 확인 가능한 자료입니다.
  // 상권 항목은 전체 화면만 쓰므로 확대 화면에는 만들지 않습니다 (1,300동이라
  // 두 번 담으면 페이지가 크게 무거워집니다).
  let comD = '';
  if (V === FULL) {
    const commercial = feats.filter((f) => /^(commercial|retail)$/.test(f.properties.building ?? ''));
    comD = commercial.map((f) => toPath(ringsOf(f), project, { close: true })).filter(Boolean).join(' ');
    if (comD) defs.push(`<path id="${id('commercial')}" d="${comD}"/>`);
  }

  // 올림픽대로 진출입 램프 — 확대 화면에서만 읽힙니다.
  let rampD = '';
  if (V === ZOOM) {
    const ramps = feats.filter((f) => /_link$/.test(f.properties.highway ?? ''))
      .flatMap((f) => linesOf(f)).map((l) => thin(l, 2));
    rampD = toPath(ramps, project);
    if (rampD) defs.push(`<path id="${id('ramps')}" d="${rampD}"/>`);
  }

  // 큰 길 두 개만. 이 지도에서 방향을 잡는 데는 이 둘이면 됩니다.
  for (const [name, width] of [['올림픽대로', 3 * scale], ['압구정로', 2.2 * scale]]) {
    const lines = feats.filter((f) => f.properties.name === name && f.properties.highway)
      .flatMap((f) => linesOf(f)).map((l) => thin(l, 2));
    const d = toPath(lines, project);
    if (d) {
      base.push(`<path d="${d}" fill="none" stroke="var(--map-road-edge)" stroke-width="${width}"`
        + ' stroke-linecap="round" stroke-linejoin="round"/>');
    }
  }

  // 버스정류장·지하철 출입구. 45곳이라 이름은 달 수 없고 점으로만 둡니다.
  // 한 벌만 담아 두고 필요한 지도에서 불러 씁니다.
  const dots = (list, name, r) => {
    const items = list.filter((s) => vis(project(s.at)));
    if (!items.length) return false;
    const circles = items.map((s) => {
      const [x, y] = project(s.at);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`;
    }).join('');
    defs.push(`<g id="${id(name)}">${circles}</g>`);
    return true;
  };
  const hasBusStops = dots(transit.stops ?? [], 'busstops', 1.8 * scale);
  const hasEntrances = dots(transit.entrances ?? [], 'subwayent', 1.6 * scale);

  // 보행 지하통로·보행교 ('토끼굴' 등) — 확대 화면에서만 씁니다.
  let tunD = '';
  if (V === ZOOM) {
    const tunnels = feats.filter((f) => /^(footway|steps|path|pedestrian)$/.test(f.properties.highway ?? ''));
    tunD = toPath(tunnels.flatMap((f) => linesOf(f)), project);
    if (tunD) defs.push(`<path id="${id('tunnels')}" d="${tunD}"/>`);
  }

  // 구역 건물은 실제 윤곽 그대로 씁니다. 볼록 껍질로 뭉치면 대각선으로 놓인
  // 구역이 옆 구역 위로 부풀어 올라 엉뚱한 자리를 차지합니다.
  for (const [zid, list] of zoneBuildings) {
    if (!list.length) continue;
    const d = list.map((f) => toPath(ringsOf(f), project, { close: true })).filter(Boolean).join(' ');
    if (!d) continue;
    defs.push(`<path id="${V.zoneRef(zid)}" d="${d}"/>`);
    out.zoneIds.add(zid);
    base.push(`<use href="#${V.zoneRef(zid)}" class="locmap__zone"/>`);
  }

  out.symbols.push(`<symbol id="${V.baseId}" viewBox="0 0 ${w} ${h}">${base.join('')}</symbol>`);
  // 레이어는 화면마다 다르게 만들므로 있으면 참으로 합칩니다.
  for (const [k, v] of Object.entries({
    hasCommercial: !!comD, hasRamps: !!rampD, hasBusStops, hasEntrances, hasTunnels: !!tunD,
  })) out.caps[k] = out.caps[k] || v;
}

// ── 항목별 위치도 ───────────────────────────────────────────
/**
 * @param {{item:object, geojson:object, zoneIds:Set<string>, zoneLabel:(id:string)=>string}} opts
 */
export function locatorFor({ item, geojson, zoneIds, zoneLabel, base = {} }) {
  const spec = item.map;
  if (!spec) return '';
  // 정류장·램프·지하통로처럼 작은 것은 전체 범위에서 뭉개집니다. 확대 화면을 씁니다.
  const V = spec.zoom || spec.transit || spec.ramps || spec.tunnels ? ZOOM : FULL;
  const { project: proj, onScreen: vis } = V;
  const ref = (name) => `#${V.prefix}-${name}`;
  const marks = [];
  const labels = [];
  const place = labelPlacer(V);

  // 상업용 건물을 가장 밑에 옅게 깝니다.
  if (spec.commercial && base.hasCommercial) {
    marks.push(`<use href="${ref('commercial')}" class="locmap__commercial"/>`);
  }

  // 적용 구역. 모든 항목에 해당 구역이 있으므로 언제나 칠합니다.
  for (const id of item.zones ?? []) {
    if (zoneIds.has(id)) marks.push(`<use href="#${V.zoneRef(id)}" class="locmap__hot"/>`);
  }

  if (spec.ramps && base.hasRamps) marks.push(`<use href="${ref('ramps')}" class="locmap__ramp"/>`);
  if (spec.transit) {
    if (base.hasBusStops) marks.push(`<use href="${ref('busstops')}" class="locmap__bus"/>`);
    if (base.hasEntrances) marks.push(`<use href="${ref('subwayent')}" class="locmap__subent"/>`);
  }
  if (spec.tunnels && base.hasTunnels) {
    marks.push(`<use href="${ref('tunnels')}" class="locmap__tunnel"/>`);
  }

  // 면으로 칠할 구역 (상권 등)
  for (const rule of spec.areas ?? []) {
    for (const f of findAll(geojson, rule)) {
      const d = toPath(ringsOf(f), proj, { close: true });
      if (d) marks.push(`<path d="${d}" class="locmap__area"/>`);
    }
    const first = findAll(geojson, rule)[0];
    const at = first && anchorOf(first);
    if (at && rule.label) {
      const p = proj(at);
      if (vis(p)) labels.push(place(p[0], p[1], rule.label));
    }
  }

  // 도로
  for (const rule of spec.roads ?? []) {
    const found = findAll(geojson, rule).filter((f) => f.properties.highway);
    if (!found.length) continue;
    const d = toPath(found.flatMap((f) => linesOf(f)).map((l) => thin(l, 2)), proj);
    if (d) marks.push(`<path d="${d}" class="locmap__road"/>`);
    // 이름표는 화면 안에서 가장 긴 조각의 가운데에.
    let best = null;
    for (const f of found) {
      for (const line of linesOf(f)) {
        const shown = line.filter((c) => vis(proj(c)));
        if (shown.length >= 2 && (!best || shown.length > best.length)) best = shown;
      }
    }
    if (best && rule.label) {
      const p = proj(best[Math.floor(best.length / 2)]);
      labels.push(place(p[0], p[1], rule.label, 'locmap__label locmap__label--road'));
    }
  }

  // 점·면 지형지물
  for (const rule of spec.features ?? []) {
    const found = findAll(geojson, rule);
    if (!found.length) continue;

    const lineD = toPath(found.flatMap((f) => (ringsOf(f).length ? [] : linesOf(f))).map((l) => thin(l, 2)), proj);
    if (lineD) marks.push(`<path d="${lineD}" class="locmap__road"/>`);

    let labelled = false;
    for (const f of found) {
      const at = anchorOf(f);
      if (!at) continue;
      const p = proj(at);
      if (!vis(p)) continue;
      marks.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" class="locmap__dot"/>`);
      if (!labelled && rule.label) {
        const t = place(p[0], p[1], rule.label);
        if (t) { labels.push(t); labelled = true; }
      }
    }
  }

  // 예정 노선 — 확정된 것과 반드시 다르게 보여야 합니다.
  if (spec.plannedLine) {
    const a = proj(spec.plannedLine.from);
    const b = proj(spec.plannedLine.to);
    marks.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}"`
      + ` x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" class="locmap__planned"/>`);
    for (const p of [a, b]) {
      marks.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" class="locmap__planned-end"/>`);
    }
    if (spec.plannedLine.label) {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      labels.push(place(mid[0], mid[1], spec.plannedLine.label, 'locmap__label locmap__label--planned'));
    }
  }

  const zoneNames = (item.zones ?? []).map(zoneLabel).join('·');
  const label = `${item.name} — 적용 구역 ${zoneNames || '전체'}`;

  return `<figure class="locmap${V === ZOOM ? ' locmap--wide' : ''}">
  <svg viewBox="0 0 ${V.W} ${V.H}" role="img" aria-label="${escapeHtml(label)}" preserveAspectRatio="xMidYMid meet">
    <use href="#${V.baseId}"/>
    ${marks.join('\n    ')}
    ${labels.filter(Boolean).join('\n    ')}
  </svg>
  ${spec.note ? `<figcaption class="locmap__note">${escapeHtml(spec.note)}</figcaption>` : ''}
</figure>`;
}

// ── 구역 하나를 중심으로 보는 지도 ──────────────────────────
/**
 * 구역별 입지 분석용. 그 구역만 강조하고 주변 시설에 이름을 답니다.
 * @param {{zone:object, facilities:Array, zoneIds:Set<string>}} opts
 */
export function zoneLocator({ zone, facilities, zoneIds, base = {}, nearestStop = null }) {
  const marks = [];
  const labels = [];
  const place = labelPlacer();

  // 정류장은 먼저 옅게 깔아 둡니다 — 시설 표식이 그 위에 올라와야 합니다.
  if (base.hasBusStops) marks.push('<use href="#loc-busstops" class="locmap__bus"/>');
  if (zoneIds.has(zone.id)) marks.push(`<use href="#${zoneRef(zone.id)}" class="locmap__hot"/>`);

  for (const fac of facilities) {
    const p = project(fac.at);
    if (!onScreen(p)) continue;
    marks.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.6"`
      + ` class="locmap__dot locmap__dot--${fac.kind}"/>`);
    labels.push(place(p[0], p[1], fac.label));
  }

  // 그 구역에서 가장 가까운 정류장 하나만 이름을 답니다. 45곳에 다 달면
  // 아무것도 읽을 수 없습니다.
  if (nearestStop?.at && nearestStop.name) {
    const p = project(nearestStop.at);
    if (onScreen(p)) {
      marks.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2"`
        + ' class="locmap__bus-near"/>');
      labels.push(place(p[0], p[1], nearestStop.name, 'locmap__label locmap__label--bus'));
    }
  }

  return `<svg class="zoneloc__map" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="${escapeHtml(zone.name)} 위치와 주변 주요 시설" preserveAspectRatio="xMidYMid meet">
    <use href="#${BASE_ID}"/>
    ${marks.join('\n    ')}
    ${labels.filter(Boolean).join('\n    ')}
  </svg>`;
}

export const locatorSize = { W, H };

// ── 단지별 진출입 경로 (확대 화면) ──────────────────────────
/**
 * 구역마다 가장 가까운 진출입 지점까지 화살표를 그립니다.
 *
 * 화살표는 '직선 방향과 직선거리' 만 뜻합니다. 실제 차량 경로가 아닙니다 —
 * 단지 정문 위치, 일방통행, 중앙분리대 때문에 실제로는 돌아가야 합니다.
 * 그럼에도 구역별로 어느 쪽 진출입이 가까운지는 이 그림이 가장 빠르게
 * 보여 줍니다.
 *
 * @param {Array<{zone:object, from:number[], to:number[], km:number, label:string}>} routes
 */
export function accessArrows({ routes, zoneIds, base = {} }) {
  const V = ZOOM;
  const marks = [];
  const labels = [];
  const place = labelPlacer(V);

  if (base.hasRamps) marks.push(`<use href="#${V.prefix}-ramps" class="locmap__ramp"/>`);

  // 구역을 전부 옅게 칠해 두고, 화살표가 그 위에 올라가게 합니다.
  for (const id of zoneIds) marks.push(`<use href="#${V.zoneRef(id)}" class="locmap__hot locmap__hot--faint"/>`);

  for (const r of routes) {
    const a = V.project(r.from);
    const b = V.project(r.to);
    if (!V.onScreen(a) || !V.onScreen(b)) continue;
    marks.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}"`
      + ` x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"`
      + ' class="locmap__arrow" marker-end="url(#locarrow)"/>');
    marks.push(`<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="3" class="locmap__arrow-start"/>`);
    // 이름표는 화살표 중간에 — 시작점에 붙이면 구역 이름과 겹칩니다.
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    labels.push(place(mid[0], mid[1], r.label, 'locmap__label locmap__label--arrow'));
  }

  return `<figure class="locmap locmap--wide">
  <svg viewBox="0 0 ${V.W} ${V.H}" role="img"
       aria-label="구역별 올림픽대로 진출입 램프까지의 방향과 직선거리"
       preserveAspectRatio="xMidYMid meet">
    <defs>
      <marker id="locarrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="var(--series-2)"/>
      </marker>
    </defs>
    <use href="#${V.baseId}"/>
    ${marks.join('\n    ')}
    ${labels.filter(Boolean).join('\n    ')}
  </svg>
  <figcaption class="locmap__note">화살표는 <strong>방향과 직선거리</strong>만 나타냅니다. 실제 차량 경로가 아닙니다 —
  단지 정문 위치, 일방통행, 중앙분리대 때문에 실제로는 돌아가야 합니다.
  가는 주황 선은 올림픽대로 진출입 램프입니다.</figcaption>
</figure>`;
}
