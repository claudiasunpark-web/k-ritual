// 대지지분 입력값 해석기.
// 씨:리얼의 '대지권지분비율'을 화면에 보이는 그대로 붙여넣을 수 있게 합니다.
// 손으로 ㎡→평 환산을 반복하면 실수가 나므로, 변환은 코드가 합니다.

const PYEONG_PER_SQM = 1 / 3.3058;

/**
 * 받아들이는 형태
 *   32.18                → 평 (숫자)
 *   "32.18평"            → 평
 *   "106.38/26830.06"    → 씨:리얼 대지권지분비율. 분자가 대지지분(㎡)
 *   "106.38㎡" / "106.38m2" → ㎡
 *   "26830.06분의 106.38"  → 등기부 표기
 * @returns {{pyeong:number, sqm:number|null, raw:string|number, source:string}|null}
 */
export function parseLandShare(input) {
  if (input === null || input === undefined || input === '') return null;

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null;
    return { pyeong: round2(input), sqm: null, raw: input, source: '평' };
  }

  const raw = String(input).trim();
  if (!raw) return null;

  // "26830.06분의 106.38" → 분자가 대지지분
  const bunui = raw.match(/^([\d,.]+)\s*분의\s*([\d,.]+)$/);
  if (bunui) {
    const sqm = num(bunui[2]);
    return sqm ? { pyeong: round2(sqm * PYEONG_PER_SQM), sqm, raw, source: '대지권비율' } : null;
  }

  // "106.38/26830.06" → 분자가 대지지분
  const ratio = raw.match(/^([\d,.]+)\s*\/\s*([\d,.]+)$/);
  if (ratio) {
    const sqm = num(ratio[1]);
    const total = num(ratio[2]);
    if (!sqm || !total) return null;
    if (sqm >= total) return null; // 분자가 분모보다 크면 잘못 넣은 값입니다.
    return { pyeong: round2(sqm * PYEONG_PER_SQM), sqm, raw, source: '대지권지분비율' };
  }

  // "106.38㎡" / "106.38 m2"
  const sqmOnly = raw.match(/^([\d,.]+)\s*(?:㎡|m2|m²|제곱미터)$/i);
  if (sqmOnly) {
    const sqm = num(sqmOnly[1]);
    return sqm ? { pyeong: round2(sqm * PYEONG_PER_SQM), sqm, raw, source: '㎡' } : null;
  }

  // "32.18평" 또는 숫자만
  const pyeongOnly = raw.match(/^([\d,.]+)\s*평?$/);
  if (pyeongOnly) {
    const p = num(pyeongOnly[1]);
    return p ? { pyeong: round2(p), sqm: null, raw, source: '평' } : null;
  }

  return null;
}

const num = (s) => {
  const v = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
};
const round2 = (v) => Math.round(v * 100) / 100;
