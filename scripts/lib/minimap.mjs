// 입지 항목별 작은 위치도 (인라인 SVG).
//
// 큰 지형도와 같은 좌표계·같은 범위를 씁니다. 그래야 독자가 큰 지도에서 본
// 위치를 작은 지도에서 그대로 찾을 수 있습니다.
//
// 한 페이지에 16장이 들어가므로 같은 그림을 16벌 넣으면 안 됩니다.
// 바탕(한강·큰길·구역 건물)은 <defs> 에 한 번만 두고 <use> 로 불러옵니다.
// 구역 건물은 구역별로 따로 담아 두어, 강조할 때 같은 path 를 색만 바꿔
// 다시 <use> 합니다 — 강조본을 새로 그리지 않습니다.

import { escapeHtml } from './format.mjs';
import { projector, toPath, ringsOf, linesOf, thin, centroid } from './geo.mjs';
import { geoMapView } from './geomap.mjs';

const W = 320;
const H = Math.round((W * geoMapView.H) / geoMapView.W);
const VIEW = geoMapView.VIEW;
const BASE_ID = 'locbase';
const zoneId = (id) => `locz-${id}`;

/** 항목의 features 규칙과 OSM 피처가 맞는지. 문자열이면 이름만, 객체면 태그까지 봅니다. */
function matches(rule, f) {
  if (typeof rule === 'string') return f.properties.name === rule;
  return Object.entries(rule).every(([k, v]) => (k === 'name' ? f.properties.name === v : f.properties[k] === v));
}

/**
 * 바탕 그림과 구역별 건물 path. 페이지에 한 번만 들어갑니다.
 * @param {{geojson:object, zoneBuildings:Map<string, object[]>, riverBandRings:?Array}} opts
 */
export function locatorBase({ geojson, zoneBuildings, riverBandRings }) {
  const { project } = projector(VIEW, { width: W, height: H });
  const defs = [];
  const base = [`<rect width="${W}" height="${H}" fill="var(--map-land)"/>`];

  if (riverBandRings?.length) {
    // 물가 선은 촘촘합니다. 이 크기에서는 3점마다 하나면 모양이 같습니다.
    const d = toPath(riverBandRings.map((r) => thin(r, 3)), project, { close: true });
    if (d) base.push(`<path d="${d}" fill="var(--map-water)"/>`);
  }

  // 큰 길 두 개만. 이 지도에서 방향을 잡는 데는 이 둘이면 됩니다.
  for (const [name, width] of [['올림픽대로', 3], ['압구정로', 2.2]]) {
    const lines = (geojson.features ?? [])
      .filter((f) => f.properties.name === name && f.properties.highway)
      .flatMap((f) => linesOf(f))
      .map((l) => thin(l, 2));
    const d = toPath(lines, project);
    if (d) {
      base.push(`<path d="${d}" fill="none" stroke="var(--map-road-edge)" stroke-width="${width}"`
        + ' stroke-linecap="round" stroke-linejoin="round"/>');
    }
  }

  // 구역 건물은 실제 윤곽 그대로 씁니다. 볼록 껍질로 뭉치면 대각선으로 놓인
  // 구역이 옆 구역 위로 부풀어 올라 엉뚱한 자리를 차지합니다.
  const zoneIds = [];
  for (const [id, feats] of zoneBuildings) {
    if (!feats.length) continue;
    const d = feats.map((f) => toPath(ringsOf(f), project, { close: true })).filter(Boolean).join(' ');
    if (!d) continue;
    defs.push(`<path id="${zoneId(id)}" d="${d}"/>`);
    zoneIds.push(id);
    base.push(`<use href="#${zoneId(id)}" class="locmap__zone"/>`);
  }

  const symbol = `<svg class="locmap__defs" width="0" height="0" aria-hidden="true" focusable="false">`
    + `<defs>${defs.join('')}`
    + `<symbol id="${BASE_ID}" viewBox="0 0 ${W} ${H}">${base.join('')}</symbol>`
    + `</defs></svg>`;

  return { symbol, zoneIds: new Set(zoneIds) };
}

/**
 * 항목 하나의 위치도.
 * @param {{item:object, geojson:object, zoneIds:Set<string>, zoneLabel:(id:string)=>string}} opts
 */
export function locatorFor({ item, geojson, zoneIds, zoneLabel }) {
  const spec = item.map;
  if (!spec) return '';
  const { project } = projector(VIEW, { width: W, height: H });
  const marks = [];

  // 적용 구역을 먼저 덮습니다 — 표식이 그 위에 올라와야 보입니다.
  // 바탕에 이미 그려 둔 같은 path 를 색만 바꿔 다시 부릅니다.
  for (const id of item.zones ?? []) {
    if (!zoneIds.has(id)) continue;
    marks.push(`<use href="#${zoneId(id)}" class="locmap__hot"/>`);
  }

  // 대상 지형지물. 규칙에 없는 것은 그리지 않습니다 — 없는 위치를 지어내지 않습니다.
  let drawn = 0;
  for (const rule of spec.features ?? []) {
    const found = (geojson.features ?? []).filter((f) => matches(rule, f));
    if (!found.length) continue;
    drawn += 1;

    const lines = found.flatMap((f) => (ringsOf(f).length ? [] : linesOf(f))).map((l) => thin(l, 2));
    const d = toPath(lines, project);
    if (d) {
      marks.push(`<path d="${d}" fill="none" stroke="var(--series-2)" stroke-width="2.6"`
        + ' stroke-linecap="round" stroke-linejoin="round"/>');
    }

    // 점·면은 위치를 찍습니다. 이 축척에서 건물 하나는 2~3픽셀이라
    // 윤곽만 그리면 어디를 가리키는지 알 수 없습니다.
    for (const f of found) {
      const ring = ringsOf(f)[0];
      const at = f.geometry.type === 'Point' ? f.geometry.coordinates : (ring ? centroid(ring) : null);
      if (!at) continue;
      const [x, y] = project(at);
      if (!Number.isFinite(x) || x < -8 || x > W + 8 || y < -8 || y > H + 8) continue;
      marks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="var(--series-2)"`
        + ' stroke="var(--map-land)" stroke-width="1.6"/>');
    }
  }

  const zoneNames = (item.zones ?? []).map(zoneLabel).join('·');
  const label = drawn
    ? `${item.name} 위치`
    : `${item.name} 적용 구역 (${zoneNames}) — 위치 미확정`;

  return `<figure class="locmap">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label)}" preserveAspectRatio="xMidYMid meet">
    <use href="#${BASE_ID}"/>
    ${marks.join('\n    ')}
  </svg>
  ${spec.note ? `<figcaption class="locmap__note">${escapeHtml(spec.note)}</figcaption>` : ''}
</figure>`;
}

export const locatorSize = { W, H };
