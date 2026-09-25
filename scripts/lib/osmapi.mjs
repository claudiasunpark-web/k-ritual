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

// 한강처럼 '관계(relation)'로 올라간 것들. 관계에 태그가 있고, 실제 좌표를
// 가진 구성원 way 에는 태그가 없습니다. 그래서 관계를 읽지 않으면 강의 물가
// 선이 통째로 사라집니다(강이 가는 중심선 하나로만 남습니다).
const RELATION_WANTED = (t = {}) => t.natural === 'water' || t.waterway === 'riverbank';

/**
 * OSM XML → Overpass 와 같은 모양의 elements 배열.
 * way 는 node 표를 참조해 geometry 를 채워 넣습니다(Overpass 의 `out geom` 과 동일).
 *
 * phase 로 나눠 도는 이유: 조각(tile) 경계에 걸친 way·relation 의 좌표가
 * 옆 조각에서 채워지므로, 노드를 전부 모은 뒤에 way 를, way 를 전부 모은 뒤에
 * relation 을 만들어야 합니다.
 *
 * @param {{nodes:Map, ways:Map}} ctx 조각 전체에서 공유하는 표
 */
export function parseOsmXml(xml, ctx, phase = 'all') {
  const nodeTable = ctx instanceof Map ? ctx : ctx.nodes;
  const wayGeom = ctx instanceof Map ? new Map() : ctx.ways;
  const elements = [];

  if (phase === 'all' || phase === 'nodes') {
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
  }

  if (phase === 'all' || phase === 'ways') {
    for (const m of xml.matchAll(/<way\s([^>]*?)>([\s\S]*?)<\/way>/g)) {
      const id = attr(`<way ${m[1]}>`, 'id');
      const body = m[2];
      if (!id) continue;
      const geometry = [];
      let complete = true;
      for (const nd of body.matchAll(/<nd\s[^>]*\/?>/g)) {
        const ref = attr(nd[0], 'ref');
        const p = ref && nodeTable.get(ref);
        // 조각 경계 밖 노드는 표에 없을 수 있습니다. 그런 way 는 버립니다.
        if (!p) { complete = false; break; }
        geometry.push(p);
      }
      if (!complete || geometry.length < 2) continue;
      // 태그 없는 way 도 표에 담아 둡니다 — 관계의 구성원으로 쓰입니다.
      wayGeom.set(id, geometry);
      const tags = tagsOf(body);
      if (Object.keys(tags).length) elements.push({ type: 'way', id: Number(id), tags, geometry });
    }
  }

  if (phase === 'all' || phase === 'relations') {
    for (const m of xml.matchAll(/<relation\s([^>]*?)>([\s\S]*?)<\/relation>/g)) {
      const id = attr(`<relation ${m[1]}>`, 'id');
      const body = m[2];
      const tags = tagsOf(body);
      if (!id || !RELATION_WANTED(tags)) continue;
      let part = 0;
      for (const mem of body.matchAll(/<member\s[^>]*\/?>/g)) {
        if (attr(mem[0], 'type') !== 'way') continue;
        const role = attr(mem[0], 'role');
        if (role && role !== 'outer') continue;
        const geometry = wayGeom.get(attr(mem[0], 'ref'));
        if (!geometry || geometry.length < 2) continue;
        // 구성원은 열린 선입니다(물가 선). 면으로 닫는 일은 그리는 쪽에서 합니다.
        part += 1;
        elements.push({
          type: 'way',
          id: Number(`${id}${String(part).padStart(3, '0')}`),
          tags: { ...tags, bank: 'yes' },
          geometry,
        });
      }
    }
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
  // 노드·way 표는 조각 전체에서 공유합니다. 조각 경계에 걸친 way·relation 의
  // 좌표가 옆 조각에서 채워지기 때문입니다.
  const ctx = { nodes: new Map(), ways: new Map() };
  const seen = new Set();
  const all = [];
  let failed = 0;

  // 노드 → way → relation 순서로 세 바퀴 돕니다 (parseOsmXml 주석 참고).
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
        parseOsmXml(xml, ctx, 'nodes');
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

  for (const phase of ['ways', 'relations']) {
    for (const xml of bodies) {
      for (const el of parseOsmXml(xml, ctx, phase)) {
        const key = `${el.type}${el.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(el);
      }
    }
  }

  const banks = all.filter((el) => el.tags?.bank === 'yes').length;
  log(`  osm-api 합계 ${all.length}개 (물가 선 ${banks}개, 실패한 조각 ${failed}/${parts.length})`);
  if (failed > parts.length / 3) throw new Error(`조각 실패가 너무 많습니다 (${failed}/${parts.length})`);
  return all;
}
