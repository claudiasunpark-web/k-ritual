// 금액·숫자 표기 헬퍼. 국토부 실거래 금액 단위는 만원입니다.

export const comma = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('ko-KR');

/** 만원 → "85억 3,000" 형태. 억 단위 절사 없이 읽히게 합니다. */
export function eok(manKRW, { digits = 1 } = {}) {
  if (!Number.isFinite(Number(manKRW))) return '—';
  const v = Number(manKRW);
  const e = v / 10000;
  if (e >= 100) return `${Math.round(e).toLocaleString('ko-KR')}억`;
  if (e >= 1) {
    const s = e.toFixed(digits).replace(/\.0$/, '');
    return `${s}억`;
  }
  return `${comma(v)}만`;
}

/** 평당 만원 → "1억 4,320만" (평당가는 억 단위가 되므로 분리 표기) */
export function perPyeong(manKRW) {
  if (!Number.isFinite(Number(manKRW))) return '—';
  const v = Math.round(Number(manKRW));
  if (v < 10000) return `${comma(v)}만원`;
  const e = Math.floor(v / 10000);
  const rest = v % 10000;
  return rest ? `${e}억 ${comma(rest)}만원` : `${e}억원`;
}

/** 억원 단위 사업비: 55610(억) → "5조 5,610억원" */
export function billionKRW(eokValue) {
  if (!Number.isFinite(Number(eokValue))) return '—';
  const v = Number(eokValue);
  if (v >= 10000) {
    const jo = Math.floor(v / 10000);
    const rest = v % 10000;
    return rest ? `${jo}조 ${comma(rest)}억원` : `${jo}조원`;
  }
  return `${comma(v)}억원`;
}

export const pct = (v, digits = 1) =>
  Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(digits).replace(/\.0$/, '')}%` : '—';

/** 2026-08 → "26.8" (축 라벨용) */
export const ymShort = (ym) => {
  const [y, m] = ym.split('-');
  return `${y.slice(2)}.${Number(m)}`;
};

export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
