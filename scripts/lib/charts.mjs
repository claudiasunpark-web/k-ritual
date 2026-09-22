// 인라인 SVG 차트 생성기. 라이브러리 의존성 없음.
// 규칙: 2px 라인 / ≥8px 마커(2px 서피스 링) / 헤어라인 실선 그리드 /
//       2개 이상 시리즈는 항상 범례 / 모든 차트에 표(table view) 트윈.

import { comma, perPyeong, ymShort, escapeHtml } from './format.mjs';

export const SERIES_VAR = (i) => `var(--series-${(i % 8) + 1})`;

const PAD = { top: 16, right: 28, bottom: 42, left: 72 };

/** 축 눈금을 깔끔한 수로 끊습니다. */
function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min || 0];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** 값 끝만 4px 둥글게, 기준선 쪽은 각진 수평 막대 경로 */
function hBarPath(x0, y, w, h, r = 4) {
  const rr = Math.min(r, Math.max(0, w), h / 2);
  if (w <= 0.5) return `M${x0} ${y}H${x0}`;
  return [
    `M${x0} ${y}`,
    `H${x0 + w - rr}`,
    `a${rr} ${rr} 0 0 1 ${rr} ${rr}`,
    `V${y + h - rr}`,
    `a${rr} ${rr} 0 0 1 ${-rr} ${rr}`,
    `H${x0}`,
    'Z',
  ].join(' ');
}

function tableTwin(caption, head, rows) {
  const th = head.map((h, i) => `<th${i ? ' style="text-align:right"' : ''}>${h}</th>`).join('');
  const tb = rows
    .map(
      (r) =>
        `<tr>${r.map((c, i) => `<td${i ? ' style="text-align:right"' : ''}>${c}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<details class="table-view"><summary>표로 보기 — ${escapeHtml(caption)}</summary><div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div></details>`;
}

/**
 * 하나의 라인 플롯(svg + 호버 데이터)을 만듭니다.
 * 평형대마다 값의 범위가 달라 축 눈금도 달라지므로, 플롯을 평형대별로
 * 따로 그려 두고 전환합니다. 클라이언트에서 좌표를 다시 계산하지 않아
 * 축과 선이 어긋날 여지가 없습니다.
 */
function linePlot({ series, ymList, label, unitNote }) {
  const W = 880;
  const H = 400;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = series.flatMap((s) => s.points.map((p) => p.value)).filter((v) => Number.isFinite(v));
  if (values.length === 0) {
    return { empty: true, label, html: `<p class="chart__empty">${escapeHtml(label)}: 표시할 실거래가 없습니다.</p>` };
  }
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const ticks = niceTicks(dataMin * 0.96, dataMax * 1.02, 4);
  const yMin = Math.min(...ticks, dataMin);
  const yMax = Math.max(...ticks, dataMax);

  const x = (i) => PAD.left + (ymList.length === 1 ? plotW / 2 : (i / (ymList.length - 1)) * plotW);
  const y = (v) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const grid = ticks
    .map(
      (t) =>
        `<line class="grid" x1="${PAD.left}" y1="${y(t).toFixed(1)}" x2="${PAD.left + plotW}" y2="${y(t).toFixed(1)}"></line>` +
        `<text class="axis" x="${PAD.left - 10}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${comma(t)}</text>`,
    )
    .join('');

  const tickEvery = Math.max(1, Math.ceil(ymList.length / 9));
  const xLabels = ymList
    .map((ym, i) =>
      i % tickEvery === 0 || i === ymList.length - 1
        ? `<text class="axis" x="${x(i).toFixed(1)}" y="${PAD.top + plotH + 24}" text-anchor="middle">${ymShort(ym)}</text>`
        : '',
    )
    .join('');

  const paths = series
    .map((s, si) => {
      // 결측 구간은 선을 끊습니다(0으로 보간하지 않습니다).
      const segments = [];
      let cur = [];
      s.points.forEach((p, i) => {
        if (Number.isFinite(p.value)) cur.push({ i, v: p.value });
        else if (cur.length) {
          segments.push(cur);
          cur = [];
        }
      });
      if (cur.length) segments.push(cur);

      const d = segments
        .filter((seg) => seg.length > 1)
        .map((seg) => `M${seg.map((pt) => `${x(pt.i).toFixed(1)} ${y(pt.v).toFixed(1)}`).join('L')}`)
        .join(' ');

      const lone = segments
        .filter((seg) => seg.length === 1)
        .map(
          (seg) =>
            `<circle class="marker" cx="${x(seg[0].i).toFixed(1)}" cy="${y(seg[0].v).toFixed(1)}" r="4.5" fill="${SERIES_VAR(si)}"></circle>`,
        )
        .join('');

      const lastIdx = (() => {
        for (let i = s.points.length - 1; i >= 0; i -= 1) if (Number.isFinite(s.points[i].value)) return i;
        return -1;
      })();
      const endMarker =
        lastIdx >= 0
          ? `<circle class="marker" cx="${x(lastIdx).toFixed(1)}" cy="${y(s.points[lastIdx].value).toFixed(1)}" r="4.5" fill="${SERIES_VAR(si)}"></circle>`
          : '';

      return `<g class="series" data-key="${escapeHtml(s.key)}"><path d="${d}" fill="none" stroke="${SERIES_VAR(si)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>${lone}${endMarker}</g>`;
    })
    .join('');

  const hoverData = JSON.stringify({
    ymList,
    pad: PAD,
    plotW,
    plotH,
    series: series.map((s, si) => ({
      key: s.key,
      label: s.label,
      slot: (si % 8) + 1,
      points: s.points.map((p) => p.value),
      counts: s.points.map((p) => p.count ?? null),
    })),
  });

  const rows = ymList.map((ym, i) => [
    ym,
    ...series.map((s) => {
      const p = s.points[i];
      if (!Number.isFinite(p?.value)) return '—';
      return `${comma(p.value)}${(p.count ?? 99) <= 2 ? ` <span class="muted">(${p.count}건)</span>` : ''}`;
    }),
  ]);

  return {
    empty: false,
    label,
    html: `<div class="chart__plot" data-hover='${escapeHtml(hoverData)}'>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label)}" preserveAspectRatio="xMidYMid meet">
      <g class="grid-group">${grid}</g>
      <line class="baseline" x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}"></line>
      ${xLabels}
      <g class="series-group">${paths}</g>
      <g class="crosshair" hidden><line y1="${PAD.top}" y2="${PAD.top + plotH}"></line></g>
      <rect class="hit" x="${PAD.left}" y="${PAD.top}" width="${plotW}" height="${plotH}" fill="transparent"></rect>
    </svg>
    <div class="tooltip" hidden></div>
  </div>
  <p class="chart__unit">${escapeHtml(unitNote)}</p>
  <p class="chart__scrollhint">좁은 화면에서는 차트를 좌우로 밀어 볼 수 있습니다.</p>
  ${tableTwin(label, ['기준월', ...series.map((s) => s.label)], rows)}`,
  };
}

/**
 * 평형대 전환이 가능한 구역별 평당가 추이 차트.
 * @param {{views:{key:string,label:string,series:any[],note?:string}[], defaultView:string, ymList:string[], title:string, subtitle?:string, legendSeries:{key:string,label:string}[]}} opts
 */
export function lineChart({ views, defaultView, ymList, title, subtitle = '', legendSeries, id = 'line' }) {
  const plots = views.map((v) => ({
    key: v.key,
    ...linePlot({
      series: v.series,
      ymList,
      label: `${title} — ${v.label}`,
      unitNote: v.note ?? '단위: 만원 / 전용면적 1평 · 월별 중위값',
    }),
  }));

  if (plots.every((p) => p.empty)) {
    return `<figure class="chart chart--empty" id="${id}"><figcaption>${escapeHtml(title)}</figcaption><p class="chart__empty">표시할 실거래 데이터가 없습니다.</p></figure>`;
  }

  const active = plots.some((p) => p.key === defaultView && !p.empty)
    ? defaultView
    : plots.find((p) => !p.empty).key;

  const bandOptions = views
    .map(
      (v, i) =>
        `<option value="${escapeHtml(v.key)}"${v.key === active ? ' selected' : ''}${plots[i].empty ? ' disabled' : ''}>${escapeHtml(v.label)}</option>`,
    )
    .join('');

  const legend = legendSeries
    .map(
      (s, si) =>
        `<button type="button" class="legend__item" data-key="${escapeHtml(s.key)}" aria-pressed="true"><span class="legend__swatch" style="background:${SERIES_VAR(si)}"></span>${escapeHtml(s.label)}</button>`,
    )
    .join('');

  return `<figure class="chart" id="${id}" data-chart="line">
  <figcaption class="chart__title">${escapeHtml(title)}${subtitle ? `<span class="chart__sub">${escapeHtml(subtitle)}</span>` : ''}</figcaption>
  <div class="filters filters--chart">
    <label class="filters__field"><span>평형대</span>
      <select data-band-select>${bandOptions}</select>
    </label>
  </div>
  <div class="legend" role="group" aria-label="구역 선택">${legend}</div>
  ${plots
    .map(
      (p) =>
        `<div class="chart__view" data-band="${escapeHtml(p.key)}"${p.key === active ? '' : ' hidden'}>${p.html}</div>`,
    )
    .join('')}
</figure>`;
}

/**
 * 단지별 평당가 수평 막대. 단일 색(slot 1) + 구역 그룹 헤더로 식별.
 * @param {{groups:{label:string,items:{label:string,value:number|null,note?:string}[]}[], title:string, subtitle?:string}} opts
 */
export function groupedBarChart({ groups, title, subtitle = '', id = 'bar' }) {
  const items = groups.flatMap((g) => g.items);
  const values = items.map((i) => i.value).filter((v) => Number.isFinite(v));
  if (values.length === 0) {
    return `<figure class="chart chart--empty"><figcaption>${escapeHtml(title)}</figcaption><p class="chart__empty">표시할 실거래 데이터가 없습니다.</p></figure>`;
  }
  const max = Math.max(...values);
  const ticks = niceTicks(0, max * 1.04, 4);
  const xMax = Math.max(...ticks, max);

  const BAR = 18;
  const GAP = 8;
  const GROUP_HEAD = 30;
  const W = 880;
  const left = 132;
  const right = 96;
  const plotW = W - left - right;
  let yCur = 12;
  const rowsSvg = [];
  const tableRows = [];

  for (const g of groups) {
    rowsSvg.push(
      `<text class="bar__group" x="12" y="${yCur + 16}">${escapeHtml(g.label)}</text>`,
      `<line class="grid" x1="12" y1="${yCur + 23}" x2="${W - 12}" y2="${yCur + 23}"></line>`,
    );
    yCur += GROUP_HEAD;
    for (const it of g.items) {
      const v = Number.isFinite(it.value) ? it.value : 0;
      const w = (v / xMax) * plotW;
      rowsSvg.push(
        `<text class="bar__label" x="${left - 12}" y="${yCur + BAR - 4}" text-anchor="end">${escapeHtml(it.label)}</text>`,
        Number.isFinite(it.value)
          ? `<path class="bar" d="${hBarPath(left, yCur, w, BAR)}" fill="var(--series-1)" data-label="${escapeHtml(it.label)}" data-value="${v}"></path>` +
            `<text class="bar__value" x="${left + w + 10}" y="${yCur + BAR - 4}">${comma(v)}</text>`
          : `<text class="bar__value bar__value--none" x="${left + 10}" y="${yCur + BAR - 4}">최근 실거래 없음</text>`,
      );
      tableRows.push([`${g.label} · ${it.label}`, Number.isFinite(it.value) ? comma(it.value) : '—']);
      yCur += BAR + GAP;
    }
    yCur += 10;
  }
  const H = yCur + 34;

  const xGrid = ticks
    .map(
      (t) =>
        `<line class="grid" x1="${(left + (t / xMax) * plotW).toFixed(1)}" y1="6" x2="${(left + (t / xMax) * plotW).toFixed(1)}" y2="${H - 30}"></line>` +
        `<text class="axis" x="${(left + (t / xMax) * plotW).toFixed(1)}" y="${H - 12}" text-anchor="middle">${comma(t)}</text>`,
    )
    .join('');

  return `<figure class="chart" id="${id}" data-chart="bar">
  <figcaption class="chart__title">${escapeHtml(title)}${subtitle ? `<span class="chart__sub">${escapeHtml(subtitle)}</span>` : ''}</figcaption>
  <div class="chart__plot">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(title)}" preserveAspectRatio="xMidYMid meet">
      <g class="grid-group">${xGrid}</g>
      <line class="baseline" x1="${left}" y1="6" x2="${left}" y2="${H - 30}"></line>
      ${rowsSvg.join('')}
    </svg>
    <div class="tooltip" hidden></div>
  </div>
  <p class="chart__unit">단위: 만원 / 전용면적 1평 · 최근 12개월 중위값</p>
  <p class="chart__scrollhint">좁은 화면에서는 차트를 좌우로 밀어 볼 수 있습니다.</p>
  ${tableTwin(title, ['단지', '평당가(만원)'], tableRows)}
</figure>`;
}

/** 구역별 사업 진행 게이지. 채움/트랙 모두 같은 블루 램프의 다른 단계. */
export function progressMeters({ zones, ladder, title, id = 'meters' }) {
  const total = ladder.length;
  const rows = zones
    .map((z) => {
      const done = z.stageDone ?? 0;
      const ratio = done / total;
      const nextStep = ladder.find((s) => s.step === done + 1);
      return `<li class="meter">
      <div class="meter__head">
        <span class="meter__name">${escapeHtml(z.shortName)}</span>
        <span class="meter__stage">${escapeHtml(ladder.find((s) => s.step === done)?.label ?? '—')} 완료<span class="meter__of">(${done}/${total})</span></span>
      </div>
      <div class="meter__track" role="img" aria-label="${escapeHtml(z.shortName)} 진행 ${done}/${total} 단계">
        <div class="meter__fill" style="width:${(ratio * 100).toFixed(1)}%"></div>
      </div>
      <p class="meter__next">다음 단계: <strong>${escapeHtml(nextStep?.label ?? '준공')}</strong></p>
    </li>`;
    })
    .join('');

  const tableRows = zones.map((z) => [
    z.shortName,
    `${z.stageDone ?? 0}/${total}`,
    ladder.find((s) => s.step === z.stageDone)?.label ?? '—',
  ]);

  return `<figure class="chart chart--meters" id="${id}">
  <figcaption class="chart__title">${escapeHtml(title)}</figcaption>
  <ol class="meters">${rows}</ol>
  <p class="chart__unit">10단계 재건축 절차 기준. 단계 정의는 아래 표 참조.</p>
  ${tableTwin(title, ['구역', '진행 단계', '완료된 최근 단계'], tableRows)}
</figure>`;
}

/** 구역별 마일스톤 타임라인. 상태는 아이콘 + 라벨을 항상 동반합니다. */
export function timeline({ zones, title, id = 'timeline' }) {
  const ICON = {
    done: '<svg class="tl__icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    progress:
      '<svg class="tl__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 4v4l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    target:
      '<svg class="tl__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="2.5 2.5"/></svg>',
  };
  const STATUS_LABEL = { done: '완료', progress: '진행 중', target: '목표' };

  const blocks = zones
    .filter((z) => (z.milestones ?? []).length)
    .map(
      (z) => `<section class="tl__zone">
    <h4 class="tl__zoneName">${escapeHtml(z.name)}<span class="tl__builder">${escapeHtml(z.builder ?? '시공사 미정')}</span></h4>
    <ol class="tl__list">
      ${z.milestones
        .map(
          (m) => `<li class="tl__item tl__item--${m.status}">
        <span class="tl__badge" aria-hidden="true">${ICON[m.status] ?? ''}</span>
        <span class="tl__date">${escapeHtml(m.date)}</span>
        <span class="tl__label">${escapeHtml(m.label)}</span>
        <span class="tl__status">${STATUS_LABEL[m.status] ?? ''}</span>
      </li>`,
        )
        .join('')}
    </ol>
  </section>`,
    )
    .join('');

  const tableRows = zones.flatMap((z) =>
    (z.milestones ?? []).map((m) => [z.shortName, m.date, m.label, STATUS_LABEL[m.status] ?? '']),
  );

  return `<figure class="chart chart--timeline" id="${id}">
  <figcaption class="chart__title">${escapeHtml(title)}</figcaption>
  <div class="tl">${blocks}</div>
  <p class="chart__unit">'목표'는 조합·서울시가 공개적으로 제시한 시점이며 확정 일정이 아닙니다.</p>
  ${tableTwin(title, ['구역', '시점', '내용', '상태'], tableRows)}
</figure>`;
}

export { tableTwin, perPyeong };
