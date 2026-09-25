// 좌표 → 화면 좌표 변환과 폴리곤 계산.
// 지도 라이브러리를 쓰지 않으므로 필요한 만큼만 직접 구현합니다.

/**
 * 웹 메르카토르 y. 지도 서비스와 같은 투영이라 형상이 익숙하게 보입니다.
 *
 * 180/π 를 곱해 '도(degree)' 단위로 돌려줍니다. 이걸 빼먹으면 y 는 라디안,
 * x(경도)는 도가 되어 세로가 57배 눌린 지도가 나옵니다.
 */
export const mercY = (lat) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/**
 * 경위도 → SVG 픽셀 변환기를 만듭니다.
 * @param {{west:number, south:number, east:number, north:number}} view 보여줄 범위
 * @param {{width:number, height:number, pad?:number}} box
 */
export function projector(view, { width, height, pad = 0 }) {
  const x0 = view.west;
  const x1 = view.east;
  const y0 = mercY(view.north); // 위쪽
  const y1 = mercY(view.south); // 아래쪽
  const w = width - pad * 2;
  const h = height - pad * 2;

  const project = ([lon, lat]) => [
    pad + ((lon - x0) / (x1 - x0)) * w,
    pad + ((mercY(lat) - y0) / (y1 - y0)) * h,
  ];

  // 1픽셀이 몇 미터인지 — 축척 바에 씁니다.
  const metersPerPx = (() => {
    const midLat = (view.north + view.south) / 2;
    const spanM = (x1 - x0) * 111320 * Math.cos((midLat * Math.PI) / 180);
    return spanM / w;
  })();

  return { project, metersPerPx, width, height };
}

/**
 * 좌표 배열 → SVG path 문자열. close=true 면 면으로 닫습니다.
 *
 * decimals 는 좌표 자릿수입니다. 1자리면 화면에서 차이가 없고, 건물 윤곽처럼
 * 수천 개가 쌓이는 것은 0자리(정수 픽셀)로 해도 눈에 띄지 않으면서
 * 파일이 크게 줄어듭니다.
 */
export function toPath(rings, project, { close = false, decimals = 1 } = {}) {
  const f = 10 ** decimals;
  const r1 = (n) => Math.round(n * f) / f;
  const parts = [];
  for (const ring of rings) {
    if (!ring || ring.length < 2) continue;
    let d = '';
    let prev = null;
    for (const c of ring) {
      const [x, y] = project(c);
      const p = `${r1(x)} ${r1(y)}`;
      // 같은 픽셀로 접히는 점은 버립니다 (건물 윤곽에서 상당히 줄어듭니다).
      if (p === prev) continue;
      d += d ? ` L${p}` : `M${p}`;
      prev = p;
    }
    if (d) parts.push(close ? `${d} Z` : d);
  }
  return parts.join(' ');
}

/** 폴리곤 링의 부호 있는 면적 (제곱도 단위 — 크기 비교·무게중심용). */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

/** 폴리곤 링의 무게중심. 면적이 0이면 첫 점을 씁니다. */
export function centroid(ring) {
  const a = ringArea(ring);
  if (!a) return ring[0] ?? [0, 0];
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** 점이 링 안에 있는지 (ray casting). 이름 없는 건물에 구역을 물려줄 때 씁니다. */
export function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 링의 경위도 경계 상자 — 점 검사 전에 걸러서 속도를 확보합니다. */
export function bboxOf(ring) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

export const inBbox = ([lon, lat], [w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n;

/** 피처의 모든 링(Polygon / MultiPolygon 공통). */
export function ringsOf(feature) {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
}

/** 선 피처의 좌표열. */
export function linesOf(feature) {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  if (g.type === 'Polygon') return g.coordinates;
  return [];
}

/** 두 선분이 실제로 교차하는가 (끝점이 닿기만 한 경우는 제외). */
function segmentsCross([ax, ay], [bx, by], [cx, cy], [dx, dy]) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * 선 하나가 다른 선들 중 하나라도 가로지르는가.
 *
 * 한강 다리를 고르는 데 씁니다. OSM 의 bridge=yes 는 고가도로·입체교차로까지
 * 전부 포함하므로, 그것만 보고 '한남대로 다리 = 한남대교' 라고 적으면
 * 강을 건너지도 않는 고가도로에 다리 이름이 찍힙니다.
 */
export function crossesAny(line, others) {
  return crossPoint(line, others) !== null;
}

/**
 * 선이 다른 선들과 처음 만나는 지점. 안 만나면 null.
 * 다리 이름표를 '강을 건너는 그 자리'에 찍는 데 씁니다.
 */
export function crossPoint(line, others) {
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    for (const other of others) {
      for (let j = 0; j < other.length - 1; j += 1) {
        const [cx, cy] = other[j];
        const [dx, dy] = other[j + 1];
        if (!segmentsCross([ax, ay], [bx, by], [cx, cy], [dx, dy])) continue;
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (!den) continue;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
        return { at: [ax + t * (bx - ax), ay + t * (by - ay)], dir: [bx - ax, by - ay] };
      }
    }
  }
  return null;
}
