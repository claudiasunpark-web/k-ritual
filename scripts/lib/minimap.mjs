// 입지 항목별 작은 위치도 (인라인 SVG).
//
// 큰 지형도와 같은 좌표계·같은 범위를 씁니다. 그래야 독자가 큰 지도에서 본
// 위치를 작은 지도에서 그대로 찾을 수 있습니다.
//
// 한 페이지에 스무 장 넘게 들어가므로 같은 그림을 그만큼 넣으면 안 됩니다.
// 바탕(한강·큰길·구역 건물·상업용 건물·램프)은 <defs> 에 한 번만 두고
// <use> 로 불러옵니다. 강조할 때도 같은 path 를 색만 바꿔 다시 <use> 합니다.

import { escapeHtml } from './format.mjs';
import { projector, toPath, ringsOf, linesOf, thin, centroid } from './geo.mjs';
import { geoMapView } from './geomap.mjs';

const W = 320;
const H = Math.round((W * geoMapView.H) / geoMapView.W);
const VIEW = geoMapView.VIEW;
const BASE_ID = 'locbase';
const zoneRef = (id) => `locz-${id}`;

const { project } = projector(VIEW, { width: W, height: H });
const onScreen = ([x, y]) => Number.isFinite(x) && x >= -6 && x <= W + 6 && y >= -6 && y <= H + 6;

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
function labelPlacer() {
  const taken = [];
  const fits = (box) => !taken.some((t) => !(box.x2 < t.x1 || box.x1 > t.x2 || box.y2 < t.y1 || box.y1 > t.y2));

  return (x, y, text, cls = 'locmap__label') => {
    const w = text.length * 6.2 + 4; // 한글 기준 대략치
    const h = 12;
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
      if (box.x1 < 2 || box.x2 > W - 2 || box.y1 < 2 || box.y2 > H - 2) continue;
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
export function locatorBase({ geojson, zoneBuildings, riverBandRings }) {
  const defs = [];
  const base = [`<rect width="${W}" height="${H}" fill="var(--map-land)"/>`];
  const feats = geojson.features ?? [];

  if (riverBandRings?.length) {
    // 물가 선은 촘촘합니다. 이 크기에서는 3점마다 하나면 모양이 같습니다.
    const d = toPath(riverBandRings.map((r) => thin(r, 3)), project, { close: true });
    if (d) base.push(`<path d="${d}" fill="var(--map-water)"/>`);
  }

  // 상업용 건물 — 상권이 어디인지는 이 분포가 말해 줍니다. 경계를 지어내지
  // 않고도 '어디가 상권인가'를 보여 주는 유일하게 확인 가능한 자료입니다.
  const commercial = feats.filter((f) => /^(commercial|retail)$/.test(f.properties.building ?? ''));
  const comD = commercial.map((f) => toPath(ringsOf(f), project, { close: true })).filter(Boolean).join(' ');
  if (comD) defs.push(`<path id="loc-commercial" d="${comD}"/>`);

  // 올림픽대로 진출입 램프
  const ramps = feats.filter((f) => /_link$/.test(f.properties.highway ?? ''))
    .flatMap((f) => linesOf(f)).map((l) => thin(l, 2));
  const rampD = toPath(ramps, project);
  if (rampD) defs.push(`<path id="loc-ramps" d="${rampD}"/>`);

  // 큰 길 두 개만. 이 지도에서 방향을 잡는 데는 이 둘이면 됩니다.
  for (const [name, width] of [['올림픽대로', 3], ['압구정로', 2.2]]) {
    const lines = feats.filter((f) => f.properties.name === name && f.properties.highway)
      .flatMap((f) => linesOf(f)).map((l) => thin(l, 2));
    const d = toPath(lines, project);
    if (d) {
      base.push(`<path d="${d}" fill="none" stroke="var(--map-road-edge)" stroke-width="${width}"`
        + ' stroke-linecap="round" stroke-linejoin="round"/>');
    }
  }

  // 구역 건물은 실제 윤곽 그대로 씁니다. 볼록 껍질로 뭉치면 대각선으로 놓인
  // 구역이 옆 구역 위로 부풀어 올라 엉뚱한 자리를 차지합니다.
  const zoneIds = [];
  for (const [id, list] of zoneBuildings) {
    if (!list.length) continue;
    const d = list.map((f) => toPath(ringsOf(f), project, { close: true })).filter(Boolean).join(' ');
    if (!d) continue;
    defs.push(`<path id="${zoneRef(id)}" d="${d}"/>`);
    zoneIds.push(id);
    base.push(`<use href="#${zoneRef(id)}" class="locmap__zone"/>`);
  }

  const symbol = '<svg class="locmap__defs" width="0" height="0" aria-hidden="true" focusable="false">'
    + `<defs>${defs.join('')}`
    + `<symbol id="${BASE_ID}" viewBox="0 0 ${W} ${H}">${base.join('')}</symbol>`
    + '</defs></svg>';

  return { symbol, zoneIds: new Set(zoneIds), hasCommercial: !!comD, hasRamps: !!rampD };
}

// ── 항목별 위치도 ───────────────────────────────────────────
/**
 * @param {{item:object, geojson:object, zoneIds:Set<string>, zoneLabel:(id:string)=>string}} opts
 */
export function locatorFor({ item, geojson, zoneIds, zoneLabel, base = {} }) {
  const spec = item.map;
  if (!spec) return '';
  const marks = [];
  const labels = [];
  const place = labelPlacer();

  // 상업용 건물을 가장 밑에 옅게 깝니다.
  if (spec.commercial && base.hasCommercial) {
    marks.push('<use href="#loc-commercial" class="locmap__commercial"/>');
  }

  // 적용 구역. 모든 항목에 해당 구역이 있으므로 언제나 칠합니다.
  for (const id of item.zones ?? []) {
    if (zoneIds.has(id)) marks.push(`<use href="#${zoneRef(id)}" class="locmap__hot"/>`);
  }

  if (spec.ramps && base.hasRamps) marks.push('<use href="#loc-ramps" class="locmap__ramp"/>');

  // 면으로 칠할 구역 (상권 등)
  for (const rule of spec.areas ?? []) {
    for (const f of findAll(geojson, rule)) {
      const d = toPath(ringsOf(f), project, { close: true });
      if (d) marks.push(`<path d="${d}" class="locmap__area"/>`);
    }
    const first = findAll(geojson, rule)[0];
    const at = first && anchorOf(first);
    if (at && rule.label) {
      const p = project(at);
      if (onScreen(p)) labels.push(place(p[0], p[1], rule.label));
    }
  }

  // 도로
  for (const rule of spec.roads ?? []) {
    const found = findAll(geojson, rule).filter((f) => f.properties.highway);
    if (!found.length) continue;
    const d = toPath(found.flatMap((f) => linesOf(f)).map((l) => thin(l, 2)), project);
    if (d) marks.push(`<path d="${d}" class="locmap__road"/>`);
    // 이름표는 화면 안에서 가장 긴 조각의 가운데에.
    let best = null;
    for (const f of found) {
      for (const line of linesOf(f)) {
        const shown = line.filter((c) => onScreen(project(c)));
        if (shown.length >= 2 && (!best || shown.length > best.length)) best = shown;
      }
    }
    if (best && rule.label) {
      const p = project(best[Math.floor(best.length / 2)]);
      labels.push(place(p[0], p[1], rule.label, 'locmap__label locmap__label--road'));
    }
  }

  // 점·면 지형지물
  for (const rule of spec.features ?? []) {
    const found = findAll(geojson, rule);
    if (!found.length) continue;

    const lineD = toPath(found.flatMap((f) => (ringsOf(f).length ? [] : linesOf(f))).map((l) => thin(l, 2)), project);
    if (lineD) marks.push(`<path d="${lineD}" class="locmap__road"/>`);

    let labelled = false;
    for (const f of found) {
      const at = anchorOf(f);
      if (!at) continue;
      const p = project(at);
      if (!onScreen(p)) continue;
      marks.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" class="locmap__dot"/>`);
      if (!labelled && rule.label) {
        const t = place(p[0], p[1], rule.label);
        if (t) { labels.push(t); labelled = true; }
      }
    }
  }

  // 예정 노선 — 확정된 것과 반드시 다르게 보여야 합니다.
  if (spec.plannedLine) {
    const a = project(spec.plannedLine.from);
    const b = project(spec.plannedLine.to);
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

  return `<figure class="locmap">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label)}" preserveAspectRatio="xMidYMid meet">
    <use href="#${BASE_ID}"/>
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
export function zoneLocator({ zone, facilities, zoneIds }) {
  const marks = [];
  const labels = [];
  const place = labelPlacer();

  if (zoneIds.has(zone.id)) marks.push(`<use href="#${zoneRef(zone.id)}" class="locmap__hot"/>`);

  for (const fac of facilities) {
    const p = project(fac.at);
    if (!onScreen(p)) continue;
    marks.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.6"`
      + ` class="locmap__dot locmap__dot--${fac.kind}"/>`);
    labels.push(place(p[0], p[1], fac.label));
  }

  return `<svg class="zoneloc__map" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="${escapeHtml(zone.name)} 위치와 주변 주요 시설" preserveAspectRatio="xMidYMid meet">
    <use href="#${BASE_ID}"/>
    ${marks.join('\n    ')}
    ${labels.filter(Boolean).join('\n    ')}
  </svg>`;
}

export const locatorSize = { W, H };
