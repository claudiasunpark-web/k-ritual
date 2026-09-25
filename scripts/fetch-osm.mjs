// OpenStreetMap 지형 데이터 수집 (Overpass API).
//
// 왜 이렇게 하는가:
//  - 지도 타일 서비스(네이버·카카오·구글)는 유료 상품에 그대로 싣기 어렵습니다.
//  - OSM 원본 지형(강·도로·건물 윤곽)을 한 번 받아 두고, 빌드할 때 우리가 직접
//    SVG로 그립니다. 그러면 API 키·타일 트래픽·이용약관 문제가 없고,
//    인쇄·PDF에도 그대로 들어가며 독자 브라우저에서 즉시 뜹니다.
//  - OSM 데이터는 ODbL 입니다. 렌더링한 지도는 'Produced Work' 이므로
//    출처 표기(© OpenStreetMap 기여자)만 하면 상업적 이용이 가능합니다.
//
// 한 번에 다 요청하면 모든 Overpass 서버가 504 로 끊습니다(응답이 수십 MB).
// 그래서 레이어별로 잘게 나눠 요청하고, 건물은 bbox 를 격자로 더 쪼갭니다.
//
// 사용: node scripts/fetch-osm.mjs [--bbox s,w,n,e] [--out 경로] [--only 레이어]

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fetchOsmApi } from './lib/osmapi.mjs';

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

// 압구정동 일대. 북쪽은 한강이 띠로 보이는 높이까지,
// 남쪽은 압구정로 아래 도산대로 상권까지.
const BBOX = argOf('--bbox', '37.5190,127.0120,37.5430,127.0530');
const OUT = argOf('--out', 'data/osm/apgujeong.geojson');
const ONLY = argOf('--only', '');
// osmapi | overpass | auto
//
// 기본값은 공식 API 입니다. 실측: 공식 API 는 36조각을 30초에 실패 0으로 받았고,
// Overpass 는 세 번 시도해 한 번도 끝내지 못했습니다(504 또는 17분 초과).
// auto 는 Overpass 를 먼저 쓰고 막히면 공식 API 로 넘어갑니다 — 8분쯤 더 걸립니다.
const SOURCE = argOf('--source', 'osmapi');
// Overpass 가 느릴 때 여기서 시간을 다 쓰면 안 됩니다. 이 시간을 넘기면
// 받다 만 것은 그대로 두고 공식 API 로 넘어갑니다.
const OVERPASS_BUDGET_MS = Number(argOf('--overpass-budget', '360')) * 1000;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const [S, W, N, E] = BBOX.split(',').map(Number);
const bx = (s, w, n, e) => `${s},${w},${n},${e}`;

/** bbox 를 cols×rows 격자로 쪼갭니다. 건물처럼 무거운 레이어에 씁니다. */
function tiles(cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push(bx(
        S + ((N - S) * r) / rows, W + ((E - W) * c) / cols,
        S + ((N - S) * (r + 1)) / rows, W + ((E - W) * (c + 1)) / cols,
      ));
    }
  }
  return out;
}

// ── 레이어 정의 ─────────────────────────────────────────────
// 각 레이어는 여러 요청으로 나뉠 수 있습니다. required=true 인 레이어가
// 하나라도 비면 지도를 그릴 수 없으므로 실패로 처리합니다.
const LAYERS = [
  {
    id: 'water',
    required: true,
    parts: [BBOX].map((b) => `
      way["natural"="water"](${b});
      relation["natural"="water"](${b});
      way["waterway"~"^(riverbank|river|stream|canal)$"](${b});`),
  },
  {
    id: 'roads-major',
    required: true,
    parts: [BBOX].map((b) => `
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link)$"](${b});`),
  },
  {
    id: 'roads-minor',
    required: false,
    parts: tiles(2, 2).map((b) => `
      way["highway"~"^(residential|unclassified|living_street|service)$"](${b});`),
  },
  {
    id: 'rail',
    required: false,
    parts: [BBOX].map((b) => `
      way["railway"~"^(subway|rail)$"](${b});
      node["railway"="station"](${b});`),
  },
  {
    id: 'plots',
    required: false,
    parts: [BBOX].map((b) => `
      way["landuse"](${b});
      way["leisure"~"^(park|garden|pitch|sports_centre)$"](${b});
      way["amenity"~"^(school|university|hospital|kindergarten)$"](${b});
      way["shop"="department_store"](${b});
      node["shop"="department_store"](${b});
      node["amenity"~"^(school|hospital)$"](${b});
      node["place"~"^(suburb|quarter|neighbourhood)$"](${b});`),
  },
  {
    // 가장 무거운 레이어 — 2×3 격자로 쪼갭니다.
    id: 'buildings',
    required: true,
    parts: tiles(2, 3).map((b) => `
      way["building"](${b});
      relation["building"](${b});`),
  },
];

// ── 요청 ────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let endpointIdx = 0;

async function ask(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass 이용정책상 식별 가능한 User-Agent 를 요구합니다.
      'User-Agent': 'apgujeong-ebook/1.0 (static site build; contact via repository)',
    },
    body: new URLSearchParams({ data: body }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  try {
    return JSON.parse(text);
  } catch {
    // Overpass 는 쿼리 오류를 JSON 이 아닌 HTML 로 돌려줍니다.
    const hint = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
    throw new Error(`JSON 아님: ${hint}`);
  }
}

/** 한 조각을 여러 서버에 돌려가며 시도합니다. */
async function fetchPart(label, statements) {
  // timeout 을 낮게 잡아야 Overpass 가 스스로 포기하고 오류를 돌려줍니다.
  // 높게 두면 앞단 프록시가 먼저 504 로 끊어 원인을 알 수 없습니다.
  const query = `[out:json][timeout:90];\n(${statements}\n);\nout geom;`;
  const errors = [];
  for (let i = 0; i < ENDPOINTS.length; i += 1) {
    const endpoint = ENDPOINTS[endpointIdx % ENDPOINTS.length];
    endpointIdx += 1;
    const host = new URL(endpoint).host;
    try {
      process.stdout.write(`  ${label} ← ${host} ... `);
      const json = await ask(endpoint, query);
      const n = json.elements?.length ?? 0;
      console.log(`${n}개`);
      return json.elements ?? [];
    } catch (err) {
      console.log(`실패 (${err.message})`);
      errors.push(`${host}: ${err.message}`);
      await sleep(3000);
    }
  }
  throw new Error(`${label} 실패\n    ${errors.join('\n    ')}`);
}

// ── 좌표·태그 정리 ──────────────────────────────────────────
// 소수 5자리 = 약 1.1m. 이 축척의 지도에는 충분하고 파일이 1/3 로 줄어듭니다.
const r5 = (n) => Math.round(n * 1e5) / 1e5;

// 지도에 쓰는 태그만 남깁니다. 원본 태그를 전부 들고 있으면 파일이 수 배로 커집니다.
const KEEP_TAGS = [
  'name', 'name:ko', 'building', 'building:levels', 'highway', 'railway',
  'natural', 'waterway', 'landuse', 'leisure', 'amenity', 'shop', 'bridge',
  'place', 'tunnel', 'layer', 'ref',
];

function slimTags(tags = {}) {
  const out = {};
  for (const k of KEEP_TAGS) if (tags[k] != null) out[k] = tags[k];
  return out;
}

function closed(coords) {
  if (coords.length < 3) return false;
  const [ax, ay] = coords[0];
  const [bx2, by] = coords[coords.length - 1];
  return ax === bx2 && ay === by;
}

// 면으로 그려야 하는 태그 (닫힌 선이면 폴리곤)
const AREA_KEYS = ['building', 'natural', 'landuse', 'leisure', 'amenity', 'shop'];
const isAreaish = (t) => AREA_KEYS.some((k) => t[k] != null) || t.waterway === 'riverbank';

function toFeature(el) {
  const tags = slimTags(el.tags);
  if (!Object.keys(tags).length) return null;

  if (el.type === 'node') {
    if (el.lat == null) return null;
    return { type: 'Feature', properties: { ...tags, osm: `n${el.id}` },
      geometry: { type: 'Point', coordinates: [r5(el.lon), r5(el.lat)] } };
  }

  if (el.type === 'way') {
    if (!Array.isArray(el.geometry)) return null;
    const coords = el.geometry.filter((p) => p && p.lat != null).map((p) => [r5(p.lon), r5(p.lat)]);
    if (coords.length < 2) return null;
    const asArea = isAreaish(tags) && closed(coords);
    return { type: 'Feature', properties: { ...tags, osm: `w${el.id}` },
      geometry: asArea
        ? { type: 'Polygon', coordinates: [coords] }
        : { type: 'LineString', coordinates: coords } };
  }

  if (el.type === 'relation') {
    // 멀티폴리곤(한강 등). outer 멤버들만 각각 링으로 씁니다.
    const rings = [];
    for (const m of el.members ?? []) {
      if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
      if (m.role && m.role !== 'outer') continue;
      const coords = m.geometry.filter((p) => p && p.lat != null).map((p) => [r5(p.lon), r5(p.lat)]);
      if (coords.length >= 3) rings.push([coords]);
    }
    if (!rings.length) return null;
    return { type: 'Feature', properties: { ...tags, osm: `r${el.id}` },
      geometry: { type: 'MultiPolygon', coordinates: rings } };
  }

  return null;
}

// ── 공식 API 로 받은 것 중 지도에 쓰는 것만 남기기 ──────────
// Overpass 와 달리 태그로 거르지 않고 전부 오므로 여기서 거릅니다.
const ROAD_TAGS = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|motorway_link|trunk_link|primary_link|secondary_link)$/;

const WANTED = (t = {}) =>
  t.building != null
  || t.natural === 'water'
  || /^(riverbank|river|stream|canal)$/.test(t.waterway ?? '')
  || ROAD_TAGS.test(t.highway ?? '')
  || /^(subway|rail)$/.test(t.railway ?? '')
  || t.railway === 'station'
  || t.landuse != null
  || /^(park|garden|pitch|sports_centre)$/.test(t.leisure ?? '')
  || /^(school|university|hospital|kindergarten)$/.test(t.amenity ?? '')
  || t.shop === 'department_store'
  || /^(suburb|quarter|neighbourhood)$/.test(t.place ?? '');

// ── 실행 ────────────────────────────────────────────────────
console.log(`OSM 지형 수집 — bbox ${BBOX} (source=${SOURCE})`);
const seen = new Set(); // 격자 경계에 걸친 요소가 중복으로 들어옵니다.
const features = [];
const missing = [];
const counts = {};

const addElements = (elements, bucket) => {
  let got = 0;
  for (const el of elements) {
    const key = `${el.type}${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const f = toFeature(el);
    if (f) { features.push(f); got += 1; }
  }
  counts[bucket] = (counts[bucket] ?? 0) + got;
  return got;
};

async function viaOverpass() {
  const deadline = Date.now() + OVERPASS_BUDGET_MS;
  for (const layer of LAYERS) {
    if (ONLY && ONLY !== layer.id) continue;
    counts[layer.id] = 0;
    if (Date.now() > deadline) {
      console.log(`  ${layer.id} 건너뜀 — Overpass 시간 예산(${OVERPASS_BUDGET_MS / 1000}초) 초과`);
      missing.push(layer.id);
      if (layer.required) throw new Error('Overpass 시간 예산 초과');
      continue;
    }
    try {
      for (let i = 0; i < layer.parts.length; i += 1) {
        if (Date.now() > deadline) throw new Error('Overpass 시간 예산 초과');
        const label = layer.parts.length > 1 ? `${layer.id} ${i + 1}/${layer.parts.length}` : layer.id;
        addElements(await fetchPart(label, layer.parts[i]), layer.id);
        await sleep(1500); // 서버에 예의
      }
    } catch (err) {
      console.log(`  ! ${err.message}`);
      missing.push(layer.id);
      // 필수 레이어가 비면 Overpass 로는 지도를 못 그립니다.
      if (layer.required) throw err;
    }
  }
}

async function viaOsmApi() {
  const elements = await fetchOsmApi({ s: S, w: W, n: N, e: E }, { cols: 6, rows: 6 });
  const wanted = elements.filter((el) => WANTED(el.tags));
  console.log(`  쓸 만한 요소 ${wanted.length}개 / 받은 ${elements.length}개`);
  addElements(wanted, 'osm-api');
}

if (SOURCE === 'osmapi') {
  await viaOsmApi();
} else {
  try {
    await viaOverpass();
  } catch (err) {
    if (SOURCE === 'overpass') {
      console.error(`\nOverpass 실패로 중단합니다: ${err.message}`);
      process.exit(1);
    }
    console.log(`\nOverpass 로는 못 받았습니다 — 공식 API(api.openstreetmap.org)로 다시 시도합니다.`);
    // Overpass 에서 부분적으로 받은 것은 그대로 두고 부족한 것만 채웁니다.
    await viaOsmApi();
  }
}

// 필수 레이어에 해당하는 것이 하나라도 있어야 지도를 그립니다.
const has = (fn) => features.some(fn);
const missingEssential = [
  ['건물', (f) => f.properties.building],
  ['도로', (f) => f.properties.highway],
  ['물길', (f) => f.properties.natural === 'water' || f.properties.waterway],
].filter(([, fn]) => !has(fn)).map(([n]) => n);

if (missingEssential.length) {
  console.error(`\n${missingEssential.join('·')} 을(를) 하나도 못 받았습니다. 지도를 그릴 수 없어 중단합니다.`);
  process.exit(1);
}

const geojson = {
  type: 'FeatureCollection',
  // 출처 표기 의무를 데이터 자체에 박아 둡니다.
  attribution: '© OpenStreetMap 기여자, ODbL',
  license: 'https://www.openstreetmap.org/copyright',
  fetchedAt: new Date().toISOString().slice(0, 10),
  bbox: [W, S, E, N],
  layers: counts,
  missingLayers: missing,
  features,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(geojson), 'utf8');

// ── 무엇이 들어왔는지 요약 (CI 로그에서 바로 확인) ───────────
const tally = (fn) => {
  const m = new Map();
  for (const f of features) { const k = fn(f); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
};
const show = (name, fn, n = 12) =>
  console.log(`${name}:`, tally(fn).slice(0, n).map(([k, v]) => `${k}=${v}`).join(' ') || '없음');

const kb = Math.round(JSON.stringify(geojson).length / 1024);
console.log(`\n레이어별 피처:`, Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
if (missing.length) console.log(`못 받은 레이어: ${missing.join(', ')}`);
console.log(`합계 ${features.length}개 → ${OUT} (${kb}KB)`);

show('highway', (f) => f.properties.highway, 14);
show('building', (f) => f.properties.building, 10);
show('landuse', (f) => f.properties.landuse, 10);
show('leisure/amenity/shop', (f) => f.properties.leisure || f.properties.amenity || f.properties.shop);
show('natural/waterway', (f) => f.properties.natural || f.properties.waterway);
show('railway', (f) => f.properties.railway);

// 단지 이름이 붙은 건물·구획 — 구역 매칭에 쓸 후보를 그대로 보여 줍니다.
const uniq = [...new Set(features
  .filter((f) => f.properties.name && /아파트|빌라|현대|한양|미성|압구정|갤러리아|역$|초등|중학|고등/.test(f.properties.name))
  .map((f) => f.properties.name))].sort();
console.log(`\n이름 있는 후보 ${uniq.length}종:`);
console.log(uniq.map((s) => `  ${s}`).join('\n'));
