// OSM 공식 API(api.openstreetmap.org)에서 지형을 받습니다.
//
// Overpass 대비 장단점:
//   + 질의 엔진이 아니라 DB 범위 조회라 훨씬 빠르고 잘 안 죽습니다.
//   + 태그로 거르지 않으므로 '그 태그를 안 걸었다'는 이유로 빠지는 게 없습니다.
//   − 한 요청당 노드 5만개 제한이 있어 bbox 를 잘게 쪼개야 합니다.
//   − 거른 데이터가 아니라 전부 오므로 받는 양이 많습니다 (조각당 1~3MB).
// 그래서 Overpass 를 먼저 쓰고, 실패했을 때 이쪽으로 넘어옵니다.

const ENDPOINT = 'https://api.openstreetmap.org/api/0.6/map';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** bbox 를 cols×rows 로 쪼갭니다. */
export function grid({ s, w, n, e }, cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push({
        s: s + ((n - s) * r) / rows, w: w + ((e - w) * c) / cols,
        n: s + ((n - s) * (r + 1)) / rows, e: w + ((e - w) * (c + 1)) / cols,
      });
    }
  }
  return out;
}

// ── 아주 작은 OSM XML 파서 ──────────────────────────────────
// 의존성 없이 돌아가야 하므로 필요한 만큼만 직접 읽습니다.
// OSM XML 의 속성값은 &quot; 로 이스케이프되어 큰따옴표가 값 안에 그대로
// 나타나지 않습니다. 그래서 속성 단위 정규식이 안전합니다.
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unesc = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m])
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unesc(m[1]) : null;
};

function tagsOf(body) {
  const out = {};
  if (!body) return out;
  for (const m of body.matchAll(/<tag\s[^>]*\/?>/g)) {
    const k = attr(m[0], 'k');
    const v = attr(m[0], 'v');
    if (k != null && v != null) out[k] = v;
  }
  return out;
}

/**
 * OSM XML → Overpass 와 같은 모양의 elements 배열.
 * way 는 node 표를 참조해 geometry 를 채워 넣습니다(Overpass 의 `out geom` 과 동일).
 */
export function parseOsmXml(xml, nodeTable) {
  const elements = [];

  for (const m of xml.matchAll(/<node\s([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const head = `<node ${m[1]}>`;
    const id = attr(head, 'id');
    const lat = Number(attr(head, 'lat'));
    const lon = Number(attr(head, 'lon'));
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    nodeTable.set(id, { lat, lon });
    const tags = tagsOf(m[3]);
    if (Object.keys(tags).length) elements.push({ type: 'node', id: Number(id), lat, lon, tags });
  }

  for (const m of xml.matchAll(/<way\s([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const id = attr(`<way ${m[1]}>`, 'id');
    const body = m[2];
    const tags = tagsOf(body);
    if (!id || !Object.keys(tags).length) continue;
    const geometry = [];
    for (const nd of body.matchAll(/<nd\s[^>]*\/?>/g)) {
      const ref = attr(nd[0], 'ref');
      const p = ref && nodeTable.get(ref);
      // 조각 경계 밖 노드는 아직 표에 없을 수 있습니다. 그런 way 는 버립니다.
      if (!p) { geometry.length = 0; break; }
      geometry.push(p);
    }
    if (geometry.length >= 2) elements.push({ type: 'way', id: Number(id), tags, geometry });
  }

  return elements;
}

/**
 * 격자 조각들을 순서대로 받습니다.
 * @param {{s:number,w:number,n:number,e:number}} bbox
 * @param {(msg:string)=>void} log
 */
export async function fetchOsmApi(bbox, { cols = 6, rows = 6, log = console.log } = {}) {
  const parts = grid(bbox, cols, rows);
  // 노드 표는 조각 전체에서 공유합니다. 조각 경계에 걸친 way 의 좌표가
  // 옆 조각에서 채워지기 때문입니다.
  const nodeTable = new Map();
  const seen = new Set();
  const all = [];
  let failed = 0;

  // 경계에 걸친 way 를 살리려면 노드를 먼저 다 모아야 합니다.
  // 그래서 두 번 돕니다 — 1차에서 노드 표를 채우고, 2차에서 way 를 만듭니다.
  const bodies = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    const url = `${ENDPOINT}?bbox=${p.w.toFixed(5)},${p.s.toFixed(5)},${p.e.toFixed(5)},${p.n.toFixed(5)}`;
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'application/xml',
            'User-Agent': 'apgujeong-ebook/1.0 (static site build; contact via repository)',
          },
          signal: AbortSignal.timeout(90000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const xml = await res.text();
        bodies.push(xml);
        // 1차: 노드만 표에 올립니다.
        parseOsmXml(xml.replace(/<way[\s\S]*$/, ''), nodeTable);
        log(`  osm-api ${i + 1}/${parts.length} ... ${Math.round(xml.length / 1024)}KB`);
        ok = true;
      } catch (err) {
        log(`  osm-api ${i + 1}/${parts.length} ... 실패 (${err.message})`);
        await sleep(2000 * attempt);
      }
    }
    if (!ok) failed += 1;
    await sleep(400); // 공식 API 는 대량 내려받기용이 아니므로 천천히 요청합니다.
  }

  // 2차: 노드 표가 다 찼으므로 way 를 만듭니다.
  for (const xml of bodies) {
    for (const el of parseOsmXml(xml, nodeTable)) {
      const key = `${el.type}${el.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(el);
    }
  }

  log(`  osm-api 합계 ${all.length}개 (실패한 조각 ${failed}/${parts.length})`);
  if (failed > parts.length / 3) throw new Error(`조각 실패가 너무 많습니다 (${failed}/${parts.length})`);
  return all;
}
