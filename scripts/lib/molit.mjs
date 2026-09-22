// 국토교통부 아파트 매매 실거래가 상세 자료 Open API 클라이언트
// 공공데이터포털: https://www.data.go.kr/data/15126468/openapi.do
// 의존성 없음 — Node 20+ 내장 fetch만 사용합니다.

const ENDPOINT =
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

/** <item>…</item> 블록을 태그명→값 객체로 변환합니다. 외부 XML 파서를 쓰지 않습니다. */
export function parseItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const row = {};
    const tagRe = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let t;
    while ((t = tagRe.exec(m[1])) !== null) {
      row[t[1]] = t[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    }
    items.push(row);
  }
  return items;
}

function tagValue(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}

/** 응답 필드명이 개정되어도 견디도록 후보 키를 순서대로 찾습니다. */
function pick(row, candidates) {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return null;
}

const FIELD = {
  aptName: ['aptNm', 'aptName', '아파트'],
  aptSeq: ['aptSeq', '단지일련번호'],
  area: ['excluUseAr', 'excluUseAr1', '전용면적'],
  amount: ['dealAmount', '거래금액'],
  year: ['dealYear', '년'],
  month: ['dealMonth', '월'],
  day: ['dealDay', '일'],
  floor: ['floor', '층'],
  buildYear: ['buildYear', '건축년도'],
  umd: ['umdNm', '법정동'],
  jibun: ['jibun', '지번'],
  cancelType: ['cdealType', '해제여부'],
  cancelDay: ['cdealDay', '해제사유발생일'],
  dealType: ['dealingGbn', '거래유형'],
  registerDate: ['rgstDate', '등기일자'],
};

/** 원시 item 한 건을 정규화합니다. 파싱 불가한 행은 null을 반환합니다. */
export function normalize(row) {
  const amountRaw = pick(row, FIELD.amount);
  const areaRaw = pick(row, FIELD.area);
  const name = pick(row, FIELD.aptName);
  if (!amountRaw || !areaRaw || !name) return null;

  const amountManKRW = Number(String(amountRaw).replace(/[,\s]/g, ''));
  const area = Number(areaRaw);
  if (!Number.isFinite(amountManKRW) || !Number.isFinite(area) || area <= 0) return null;

  const y = Number(pick(row, FIELD.year));
  const mo = Number(pick(row, FIELD.month));
  const d = Number(pick(row, FIELD.day));
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return null;

  const pyeong = area / 3.3058;
  return {
    aptName: name,
    aptSeq: pick(row, FIELD.aptSeq),
    umd: pick(row, FIELD.umd),
    jibun: pick(row, FIELD.jibun),
    area: Math.round(area * 100) / 100,
    pyeong: Math.round(pyeong * 100) / 100,
    amountManKRW,
    perPyeongManKRW: Math.round(amountManKRW / pyeong),
    date: `${y}-${String(mo).padStart(2, '0')}-${String(Number.isFinite(d) ? d : 1).padStart(2, '0')}`,
    ym: `${y}-${String(mo).padStart(2, '0')}`,
    floor: Number(pick(row, FIELD.floor)) || null,
    buildYear: Number(pick(row, FIELD.buildYear)) || null,
    dealType: pick(row, FIELD.dealType),
    registerDate: pick(row, FIELD.registerDate),
    cancelled: String(pick(row, FIELD.cancelType) || '').toUpperCase() === 'O',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 제한시간과 재시도를 걸어 한 번 요청합니다.
 * 이 API는 간헐적으로 응답을 끝내지 않는 경우가 있어, 타임아웃이 없으면
 * 프로세스가 무한정 매달립니다(CI에서 작업이 멈추는 원인).
 */
async function fetchWithRetry(href, { timeoutMs = 20000, attempts = 3, label = '' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(href, {
        headers: { Accept: 'application/xml' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status} ${res.statusText}`);
        // 인증·권한·요청 오류는 재시도해도 같은 결과이므로 즉시 올립니다.
        e.noRetry = res.status >= 400 && res.status < 500 && res.status !== 429;
        throw e;
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      if (err.noRetry) throw err;
      const reason = err.name === 'TimeoutError' || err.name === 'AbortError' ? '응답 시간 초과' : err.message;
      if (attempt < attempts) {
        process.stdout.write(`    ${label} ${attempt}차 실패(${reason}) — ${attempt * 2}초 후 재시도\n`);
        await sleep(attempt * 2000);
      }
    }
  }
  throw new Error(`${attempts}회 시도 모두 실패: ${lastError?.message ?? 'unknown'}`);
}

/**
 * 한 달치 거래를 모두 가져옵니다(페이지네이션 포함).
 * @param {{serviceKey:string, lawdCd:string, dealYmd:string, numOfRows?:number, timeoutMs?:number}} opts
 */
export async function fetchMonth({ serviceKey, lawdCd, dealYmd, numOfRows = 1000, timeoutMs = 20000 }) {
  const rows = [];
  let page = 1;
  let total = Infinity;

  while (rows.length < total) {
    const url = new URL(ENDPOINT);
    // serviceKey는 포털이 이미 인코딩한 값을 주므로 이중 인코딩을 피합니다.
    url.searchParams.set('LAWD_CD', lawdCd);
    url.searchParams.set('DEAL_YMD', dealYmd);
    url.searchParams.set('numOfRows', String(numOfRows));
    url.searchParams.set('pageNo', String(page));
    const href = `${url.href}&serviceKey=${serviceKey}`;

    const xml = await fetchWithRetry(href, { timeoutMs, label: `${dealYmd} p${page}` });

    const resultCode = tagValue(xml, 'resultCode');
    if (resultCode && !['00', '0'].includes(resultCode)) {
      const msg = tagValue(xml, 'resultMsg') || tagValue(xml, 'returnAuthMsg') || 'unknown';
      throw new Error(`API 오류 ${resultCode}: ${msg} (${dealYmd})`);
    }
    if (/<returnReasonCode>/.test(xml) && !/<resultCode>/.test(xml)) {
      throw new Error(
        `API 인증 오류: ${tagValue(xml, 'returnAuthMsg') || 'serviceKey를 확인하세요'}`,
      );
    }

    const batch = parseItems(xml);
    rows.push(...batch);

    const totalCount = Number(tagValue(xml, 'totalCount'));
    total = Number.isFinite(totalCount) ? totalCount : rows.length;
    if (batch.length === 0 || rows.length >= total) break;
    page += 1;
    if (page > 50) break; // 안전장치
  }

  return rows;
}

/** YYYYMM 문자열 목록을 만듭니다. months개월치, 가장 오래된 달부터. */
export function monthRange(endYear, endMonth, months) {
  const out = [];
  let y = endYear;
  let m = endMonth;
  for (let i = 0; i < months; i += 1) {
    out.unshift(`${y}${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
