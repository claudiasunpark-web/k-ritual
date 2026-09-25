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
// 사용: node scripts/fetch-osm.mjs [--bbox s,w,n,e] [--out data/osm/apgujeong.geojson]

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

// 압구정동 일대. 북쪽은 한강 북안까지(강을 띠로 보여주기 위해),
// 남쪽은 압구정로 아래 도산대로 상권까지 포함합니다.
const BBOX = argOf('--bbox', '37.5185,127.0080,37.5450,127.0570');
const OUT = argOf('--out', 'data/osm/apgujeong.geojson');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const QUERY = `[out:json][timeout:240];
(
  way["natural"="water"](${BBOX});
  relation["natural"="water"](${BBOX});
  way["waterway"~"^(riverbank|river|stream|canal)$"](${BBOX});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|motorway_link|trunk_link|primary_link|secondary_link|footway|pedestrian)$"](${BBOX});
  way["railway"~"^(subway|rail)$"](${BBOX});
  node["railway"="station"](${BBOX});
  way["building"](${BBOX});
  relation["building"](${BBOX});
  way["landuse"](${BBOX});
  way["leisure"~"^(park|garden|pitch|sports_centre)$"](${BBOX});
  way["amenity"~"^(school|university|hospital|kindergarten)$"](${BBOX});
  node["amenity"~"^(school|hospital)$"](${BBOX});
  way["shop"="department_store"](${BBOX});
  node["shop"="department_store"](${BBOX});
  way["bridge"="yes"](${BBOX});
  node["place"~"^(suburb|quarter|neighbourhood)$"](${BBOX});
);
out geom;`;

async function ask(endpoint) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass 이용정책상 식별 가능한 User-Agent 를 요구합니다.
      'User-Agent': 'apgujeong-ebook/1.0 (static site build; contact via repository)',
    },
    body: new URLSearchParams({ data: QUERY }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchOverpass() {
  const errors = [];
  for (const endpoint of ENDPOINTS) {
    const host = new URL(endpoint).host;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        process.stdout.write(`  ${host} 요청 (${attempt}/2) ... `);
        const json = await ask(endpoint);
        console.log(`받음 (요소 ${json.elements?.length ?? 0}개)`);
        return json;
      } catch (err) {
        console.log(`실패: ${err.message}`);
        errors.push(`${host}: ${err.message}`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
  throw new Error(`모든 Overpass 서버 실패\n  ${errors.join('\n  ')}`);
}

// ── 좌표 정리 ───────────────────────────────────────────────
// 소수 5자리 = 약 1.1m. 이 축척의 지도에는 충분하고 파일이 1/3 로 줄어듭니다.
const r5 = (n) => Math.round(n * 1e5) / 1e5;

// 지도에 쓰는 태그만 남깁니다. 원본 태그를 전부 들고 있으면 파일이 수 배로 커집니다.
const KEEP_TAGS = [
  'name', 'name:ko', 'name:en', 'building', 'building:levels', 'highway', 'railway',
  'natural', 'waterway', 'landuse', 'leisure', 'amenity', 'shop', 'bridge',
  'place', 'tunnel', 'layer', 'ref', 'station', 'operator',
];

function slimTags(tags = {}) {
  const out = {};
  for (const k of KEEP_TAGS) if (tags[k] != null) out[k] = tags[k];
  return out;
}

function closed(coords) {
  if (coords.length < 3) return false;
  const [ax, ay] = coords[0];
  const [bx, by] = coords[coords.length - 1];
  return ax === bx && ay === by;
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

// ── 실행 ────────────────────────────────────────────────────
console.log(`OSM 지형 수집 — bbox ${BBOX}`);
const raw = await fetchOverpass();

const features = [];
for (const el of raw.elements ?? []) {
  const f = toFeature(el);
  if (f) features.push(f);
}

const [s, w, n, e] = BBOX.split(',').map(Number);
const geojson = {
  type: 'FeatureCollection',
  // 출처 표기 의무를 데이터 자체에 박아 둡니다.
  attribution: '© OpenStreetMap 기여자, ODbL',
  license: 'https://www.openstreetmap.org/copyright',
  fetchedAt: new Date().toISOString().slice(0, 10),
  bbox: [w, s, e, n],
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

const kb = Math.round(JSON.stringify(geojson).length / 1024);
console.log(`\n피처 ${features.length}개 → ${OUT} (${kb}KB)`);
console.log('\nhighway:', tally((f) => f.properties.highway).slice(0, 14).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('building:', tally((f) => f.properties.building).slice(0, 10).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('landuse:', tally((f) => f.properties.landuse).slice(0, 10).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('leisure/amenity/shop:', tally((f) => f.properties.leisure || f.properties.amenity || f.properties.shop).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('natural/waterway:', tally((f) => f.properties.natural || f.properties.waterway).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('railway:', tally((f) => f.properties.railway).map(([k, v]) => `${k}=${v}`).join(' '));

// 단지 이름이 붙은 건물·구획 — 구역 매칭에 쓸 후보를 그대로 보여 줍니다.
const named = features
  .filter((f) => f.properties.name && /아파트|apt|현대|한양|미성|신현대|구현대|한강|압구정/i.test(f.properties.name))
  .map((f) => f.properties.name);
const uniq = [...new Set(named)].sort();
console.log(`\n단지로 보이는 이름 ${uniq.length}종:`);
console.log(uniq.slice(0, 120).map((s) => `  ${s}`).join('\n'));
