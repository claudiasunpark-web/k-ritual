// 압구정 6개 구역 개념도 (인라인 SVG).
// 실제 축척·경계가 아니라 '순서와 인접 관계, 주요 입지 요소의 방향'을 보여 주는 개념도입니다.
// 지도 API나 지도 이미지를 쓰지 않으므로 저작권 제약이 없고 인쇄·PDF에도 그대로 들어갑니다.

import { comma, escapeHtml } from './format.mjs';

const RISK_TOKEN = { low: 'var(--good)', medium: 'var(--warning)', high: 'var(--critical)' };
const RISK_LABEL = { low: '낮음', medium: '중간', high: '높음' };

/**
 * @param {{zones:object, trades?:object, title?:string, id?:string}} opts
 */
export function zoneMap({ zones, title = '압구정 6개 구역 개념도', id = 'zone-map' }) {
  const W = 980;
  const H = 500;

  // ── 세로 구성 ────────────────────────────────────────────
  const river = { y: 0, h: 72 };
  const expressway = { y: 78, h: 13 };
  const guide = 110; // 방향·계획 라벨 줄 (올림픽대로 라벨과 겹치지 않는 높이)
  const band = { y: 126, h: 216 }; // 구역 블록
  const street = { y: 360, h: 13 }; // 압구정로
  const south = 392; // 남측 시설 라벨

  const left = 56;
  const right = 24;
  const gap = 7;
  const list = zones.zones;
  const blockW = (W - left - right - gap * (list.length - 1)) / list.length;
  const xOf = (i) => left + i * (blockW + gap);

  // ── 한강 ─────────────────────────────────────────────────
  const riverPath = (() => {
    const pts = [];
    for (let x = 0; x <= W; x += 40) {
      pts.push(`${x} ${river.h - 8 + Math.sin(x / 90) * 5}`);
    }
    return `M0 0 H${W} V${river.h - 8} L${pts.reverse().join(' L')} Z`;
  })();

  // ── 한강 위 다리 (서→동) ─────────────────────────────────
  const bridges = [
    { x: 52, label: '한남대교' },
    { x: 340, label: '동호대교' },
    { x: 720, label: '성수대교' },
  ];

  // ── 남측 시설 (역·상권·학교) ─────────────────────────────
  const facilities = [
    { x: 236, label: '3호선 압구정역', kind: 'transit' },
    { x: 700, label: '수인분당선 압구정로데오역', kind: 'transit', anchor: 'end' },
    { x: 700, label: '갤러리아백화점', kind: 'retail', dy: 40, anchor: 'end' },
    { x: 470, label: '압구정초·중·고', kind: 'school', dy: 40 },
  ];

  const ICON = {
    transit:
      '<circle r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M-3.2 -2.6h6.4M-3.2 1.4h6.4" stroke="currentColor" stroke-width="1.6"/>',
    retail:
      '<path d="M-6 -4h12v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1-6 5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M-3 -4a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    school:
      '<path d="M-7 2 0 -5l7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M-4.5 1.5v4.5h9V1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  };

  const blocks = list
    .map((z, i) => {
      const x = xOf(i);
      const risk = RISK_TOKEN[z.riskLevel] ?? 'var(--baseline)';
      const early = z.stageDone !== undefined && z.stageDone <= 3; // 1·6구역 = 초기 단계
      const names = z.complexAlias ?? z.complexes.map((c) => c.name).join(' · ');

      // 단지명은 좁은 블록에 넣어야 하므로 줄 단위로 쪼갭니다(클리핑 방지).
      const lines = [];
      let cur = '';
      for (const part of names.split(' · ')) {
        if ((cur + part).length > 9 && cur) {
          lines.push(cur);
          cur = part;
        } else {
          cur = cur ? `${cur} · ${part}` : part;
        }
      }
      if (cur) lines.push(cur);
      const shown = lines.slice(0, 5);
      if (lines.length > 5) shown[4] = `${shown[4]} 외`;

      return `<g class="zm__zone" data-zone="${z.id}">
    <rect x="${x}" y="${band.y}" width="${blockW}" height="${band.h}" rx="7"
      fill="var(--surface-1)" stroke="${risk}" stroke-width="2"
      ${early ? 'stroke-dasharray="5 4"' : ''}></rect>
    <rect x="${x}" y="${band.y}" width="${blockW}" height="5" rx="2.5" fill="${risk}"></rect>
    <text class="zm__no" x="${x + blockW / 2}" y="${band.y + 30}" text-anchor="middle">${escapeHtml(z.shortName)}</text>
    ${shown
      .map(
        (l, n) =>
          `<text class="zm__cx" x="${x + blockW / 2}" y="${band.y + 50 + n * 13}" text-anchor="middle">${escapeHtml(l)}</text>`,
      )
      .join('')}
    <line x1="${x + 12}" y1="${band.y + 122}" x2="${x + blockW - 12}" y2="${band.y + 122}" stroke="var(--grid)" stroke-width="1"></line>
    <text class="zm__k" x="${x + blockW / 2}" y="${band.y + 140}" text-anchor="middle">${z.unitsAfter ? `${comma(z.unitsAfter)}세대` : '세대수 미확정'}</text>
    <text class="zm__k" x="${x + blockW / 2}" y="${band.y + 156}" text-anchor="middle">${z.maxFloors ? `최고 ${z.maxFloors}층` : '층수 미확정'}</text>
    <text class="zm__b" x="${x + blockW / 2}" y="${band.y + 176}" text-anchor="middle">${escapeHtml(z.builder ?? '시공사 미선정')}</text>
    <text class="zm__r" x="${x + blockW / 2}" y="${band.y + 198}" text-anchor="middle" fill="${risk}">리스크 ${RISK_LABEL[z.riskLevel] ?? '—'}</text>
  </g>`;
    })
    .join('');

  const tableRows = list.map((z) => [
    z.shortName,
    z.complexAlias ?? z.complexes.map((c) => c.name).join(', '),
    z.unitsAfter ? comma(z.unitsAfter) : '미확정',
    z.maxFloors ? `${z.maxFloors}층` : '미확정',
    z.builder ?? '미선정',
    RISK_LABEL[z.riskLevel] ?? '—',
  ]);

  return `<figure class="chart chart--map" id="${id}">
  <figcaption class="chart__title">${escapeHtml(title)}<span class="chart__sub">서쪽 한남대교 쪽 1구역에서 동쪽 청담동 쪽 6구역까지</span></figcaption>
  <div class="chart__plot">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(title)} — 서쪽부터 1구역 미성, 2구역 신현대, 3구역 구현대, 4구역 현대8차·한양3·4·6차, 5구역 한양1·2차, 6구역 한양5·7·8차 순으로 배치" preserveAspectRatio="xMidYMid meet">
      <!-- 한강 -->
      <path d="${riverPath}" fill="var(--zm-river)"></path>
      <text class="zm__river" x="${W / 2}" y="30" text-anchor="middle">한 강</text>
      <text class="zm__compass" x="${W - 40}" y="26" text-anchor="middle">북 ↑</text>
      ${bridges
        .map(
          (b) =>
            `<line x1="${b.x}" y1="0" x2="${b.x}" y2="${river.h + 4}" stroke="var(--zm-bridge)" stroke-width="7" stroke-linecap="round"></line>` +
            `<text class="zm__bridge" x="${b.x + 10}" y="${river.h - 22}">${escapeHtml(b.label)}</text>`,
        )
        .join('')}

      <!-- 올림픽대로: 단지와 한강을 가로막는 요소 -->
      <rect x="0" y="${expressway.y}" width="${W}" height="${expressway.h}" fill="var(--zm-road)"></rect>
      <text class="zm__road" x="12" y="${expressway.y + 10}">올림픽대로 — 단지와 한강을 가로막는 벽</text>

      <!-- 연결공원·보행교 계획: 단지 → 올림픽대로 위 → 한강 건너 -->
      <g class="zm__plan">
        <path d="M470 ${band.y - 4} V4" stroke="var(--series-1)" stroke-width="2.5" stroke-dasharray="6 4"></path>
        <circle cx="470" cy="${band.y - 4}" r="4.5" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2"></circle>
        <text class="zm__planlabel" x="482" y="${guide + 4}">연결공원 · 서울숲 보행교 (계획)</text>
      </g>

      <!-- 구역 블록 -->
      ${blocks}
      <text class="zm__dir" x="${left}" y="${guide + 4}">← 서 (한남대교)</text>
      <text class="zm__dir" x="${W - right}" y="${guide + 4}" text-anchor="end">동 (청담동) →</text>

      <!-- 압구정로 -->
      <rect x="0" y="${street.y}" width="${W}" height="${street.h}" fill="var(--zm-road)"></rect>
      <text class="zm__road" x="12" y="${street.y + 10}">압구정로</text>

      <!-- 남측 시설 -->
      ${facilities
        .map(
          (f) => `<g class="zm__fac zm__fac--${f.kind}" transform="translate(${f.x} ${south + (f.dy ?? 0)})">
        <g class="zm__icon">${ICON[f.kind]}</g>
        <text class="zm__faclabel" x="${f.anchor === 'end' ? -14 : 14}" y="4"${f.anchor === 'end' ? ' text-anchor="end"' : ''}>${escapeHtml(f.label)}</text>
      </g>`,
        )
        .join('')}

      <!-- 범례 -->
      <g transform="translate(${left} ${H - 22})">
        <rect x="0" y="-9" width="13" height="13" rx="3" fill="none" stroke="var(--good)" stroke-width="2"></rect>
        <text class="zm__leg" x="19" y="2">진행 리스크 낮음</text>
        <rect x="128" y="-9" width="13" height="13" rx="3" fill="none" stroke="var(--warning)" stroke-width="2"></rect>
        <text class="zm__leg" x="147" y="2">중간</text>
        <rect x="196" y="-9" width="13" height="13" rx="3" fill="none" stroke="var(--critical)" stroke-width="2"></rect>
        <text class="zm__leg" x="215" y="2">높음</text>
        <rect x="264" y="-9" width="13" height="13" rx="3" fill="none" stroke="var(--critical)" stroke-width="2" stroke-dasharray="4 3"></rect>
        <text class="zm__leg" x="283" y="2">점선 = 조합 초기 단계</text>
        <path d="M440 -3 h22" stroke="var(--series-1)" stroke-width="2.5" stroke-dasharray="6 4"></path>
        <text class="zm__leg" x="470" y="2">점선 파랑 = 계획 단계</text>
      </g>
    </svg>
  </div>
  <p class="chart__unit"><strong>개념도입니다.</strong> 구역의 순서와 인접 관계, 주요 입지 요소의 방향을 나타내며 <strong>실제 축척·경계·거리가 아닙니다.</strong> 블록 너비는 규모와 무관합니다. 정확한 경계는 서울시 정비구역 고시 도면을 확인하세요.</p>
  <details class="table-view"><summary>표로 보기 — ${escapeHtml(title)}</summary><div class="table-wrap"><table>
    <thead><tr><th>구역</th><th>구성 단지</th><th style="text-align:right">계획 세대</th><th>최고 층수</th><th>시공사</th><th>리스크</th></tr></thead>
    <tbody>${tableRows
      .map(
        (r) =>
          `<tr>${r.map((c, i) => `<td${i === 2 ? ' style="text-align:right"' : ''}>${escapeHtml(c)}</td>`).join('')}</tr>`,
      )
      .join('')}</tbody>
  </table></div></details>
</figure>`;
}
