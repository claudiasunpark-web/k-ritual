// 원고의 ::: 블록에 대응하는 인터랙티브 컴포넌트 생성기.
import { lineChart, groupedBarChart, progressMeters, timeline } from './charts.mjs';
import { comma, eok, perPyeong, billionKRW, escapeHtml } from './format.mjs';

const RISK_LABEL = { low: '낮음', medium: '중간', high: '높음' };

/** 202609 → 2026.09 */
const ymDot = (ym) => (ym && String(ym).length === 6 ? `${String(ym).slice(0, 4)}.${String(ym).slice(4)}` : (ym ?? '—'));

export function makeWidgets({ zones, complexes, trades, location, policy, sources, meta, pageIndex = [] }) {
  const zoneById = new Map(zones.zones.map((z) => [z.id, z]));
  const tradesByZone = new Map((trades?.zoneMonthly ?? []).map((z) => [z.zone, z]));
  const tradeComplexes = trades?.complexes ?? [];

  const zoneLabel = (id) => zoneById.get(id)?.shortName ?? id;

  return {
    /** 표지의 장별 카드 목차 */
    'toc-grid': () =>
      `<div class="toc-grid">${pageIndex
        .filter((p) => p.kind !== 'cover')
        .map(
          (p) =>
            `<a class="toc-card" href="${p.slug}/index.html">${p.chapter ? `<span class="toc-card__no">${escapeHtml(p.chapter)}</span>` : ''}<p class="toc-card__title">${escapeHtml(p.title)}</p>${p.desc ? `<p class="toc-card__desc">${escapeHtml(p.desc)}</p>` : ''}</a>`,
        )
        .join('')}</div>`,

    /** 데이터 기준일자 · 출처 배너 */
    'data-status': () => {
      const sample = trades?.isSample;
      const src = trades?.source;
      return `<div class="databar${sample ? ' databar--sample' : ''}">
  <div class="databar__row"><span class="databar__k">시세 데이터</span><span class="databar__v">${escapeHtml(src?.name ?? '미수집')}</span></div>
  <div class="databar__row"><span class="databar__k">수집 기간</span><span class="databar__v">${escapeHtml(trades?.range ? `${ymDot(trades.range.from)} ~ ${ymDot(trades.range.to)} (${trades.range.months}개월)` : '—')}</span></div>
  <div class="databar__row"><span class="databar__k">갱신 시각</span><span class="databar__v">${escapeHtml(trades?.generatedAt?.slice(0, 16).replace('T', ' ') ?? '—')}</span></div>
  <div class="databar__row"><span class="databar__k">사업 정보 기준</span><span class="databar__v">${escapeHtml(zones.asOf)}</span></div>
  ${sample ? `<p class="databar__warn">${escapeHtml(trades.sampleWarning)}</p>` : `<p class="databar__note">${escapeHtml(src?.note ?? '')}</p>`}
</div>`;
    },

    /** 구역별 카드 */
    'zone-cards': (args) => {
      const only = args ? args.split(/[\s,]+/).filter(Boolean) : null;
      const list = zones.zones.filter((z) => !only || only.includes(z.id) || only.includes(z.shortName));
      return `<div class="zonecards">${list
        .map((z) => {
          const t = tradesByZone.get(z.id);
          const latest = [...(t?.series ?? [])].reverse().find((p) => Number.isFinite(p.medianPerPyeongManKRW));
          return `<article class="zonecard zonecard--risk-${z.riskLevel ?? 'medium'}" id="zone-${z.id}">
  <header class="zonecard__head">
    <h4 class="zonecard__name">${escapeHtml(z.name)}</h4>
    <span class="zonecard__risk" title="사업 진행 불확실성">진행 리스크 ${RISK_LABEL[z.riskLevel] ?? '—'}</span>
  </header>
  <p class="zonecard__complexes">${escapeHtml(z.complexAlias ?? z.complexes.map((c) => c.name).join(' · '))}</p>
  <dl class="zonecard__stats">
    <div><dt>기존 세대</dt><dd>${z.unitsBefore ? `${comma(z.unitsBefore)}세대` : '미확인'}</dd></div>
    <div><dt>계획 세대</dt><dd>${z.unitsAfter ? `${comma(z.unitsAfter)}세대` : '미확정'}</dd></div>
    <div><dt>최고 층수</dt><dd>${z.maxFloors ? `${z.maxFloors}층` : '미확정'}</dd></div>
    <div><dt>시공사</dt><dd>${escapeHtml(z.builder ?? '미선정')}</dd></div>
    <div><dt>총공사비</dt><dd>${z.constructionCostBillionKRW ? billionKRW(z.constructionCostBillionKRW) : '미확정'}</dd></div>
    <div><dt>평당 시세</dt><dd>${latest ? perPyeong(latest.medianPerPyeongManKRW) : '—'}</dd></div>
  </dl>
  <p class="zonecard__stage">${escapeHtml(z.stageStatus ?? '')}</p>
  <ul class="zonecard__highlights">${(z.highlights ?? []).map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
</article>`;
        })
        .join('')}</div>`;
    },

    /** 구역 비교표 */
    'zone-compare': () => {
      const cols = zones.zones;
      const row = (label, fn) =>
        `<tr><th scope="row">${label}</th>${cols.map((z) => `<td>${fn(z)}</td>`).join('')}</tr>`;
      return `<div class="table-wrap table-wrap--compare"><table class="compare">
  <thead><tr><th scope="col">항목</th>${cols.map((z) => `<th scope="col">${escapeHtml(z.shortName)}</th>`).join('')}</tr></thead>
  <tbody>
    ${row('구성 단지', (z) => `<span class="compare__complexes">${escapeHtml(z.complexAlias ?? z.complexes.map((c) => c.name).join(' · '))}</span>`)}
    ${row('기존 세대', (z) => (z.unitsBefore ? comma(z.unitsBefore) : '—'))}
    ${row('계획 세대', (z) => (z.unitsAfter ? comma(z.unitsAfter) : '—'))}
    ${row('증가 세대', (z) => (z.unitsBefore && z.unitsAfter ? `+${comma(z.unitsAfter - z.unitsBefore)}` : '—'))}
    ${row('최고 층수', (z) => (z.maxFloors ? `${z.maxFloors}층` : '—'))}
    ${row('시공사', (z) => escapeHtml(z.builder ?? '미선정'))}
    ${row('총공사비', (z) => (z.constructionCostBillionKRW ? billionKRW(z.constructionCostBillionKRW) : '—'))}
    ${row('진행 단계', (z) => `${z.stageDone ?? 0}/${zones.stageLadder.length}`)}
    ${row('진행 리스크', (z) => RISK_LABEL[z.riskLevel] ?? '—')}
  </tbody>
</table></div>`;
    },

    /** 재건축 10단계 절차 설명표 */
    'stage-ladder': () =>
      `<div class="table-wrap"><table><thead><tr><th>단계</th><th>절차</th><th>투자자 관점 의미</th></tr></thead><tbody>${zones.stageLadder
        .map(
          (s) =>
            `<tr><td>${s.step}</td><td>${escapeHtml(s.label)}</td><td>${escapeHtml(STAGE_MEANING[s.step] ?? '')}</td></tr>`,
        )
        .join('')}</tbody></table></div>`,

    /** 구역별 평당가 추이 라인 차트 */
    'price-trend': () =>
      lineChart({
        id: 'chart-price-trend',
        title: '구역별 전용면적 평당 실거래가 추이',
        subtitle: '월별 중위값 · 거래가 없는 달은 선이 끊깁니다',
        ymList: trades?.ymList ?? [],
        series: (trades?.zoneMonthly ?? []).map((z) => ({
          key: z.zone,
          label: zoneLabel(z.zone),
          points: z.series.map((p) => ({ ym: p.ym, value: p.medianPerPyeongManKRW })),
        })),
      }),

    /** 단지별 평당가 비교 막대 */
    'complex-prices': () =>
      groupedBarChart({
        id: 'chart-complex-prices',
        title: '단지별 전용면적 평당 실거래가',
        subtitle: '최근 12개월 중위값 · 구역별 묶음',
        groups: zones.zones
          .map((z) => ({
            // 그룹 라벨은 막대 라벨과 겹치지 않게 구역 요약 정보를 담습니다.
            label: [
              z.shortName,
              z.builder ?? '시공사 미선정',
              z.unitsAfter ? `${comma(z.unitsAfter)}세대 계획` : '세대수 미확정',
            ].join(' · '),
            items: tradeComplexes
              .filter((c) => c.zone === z.id)
              .map((c) => ({ label: c.label, value: c.medianPerPyeongManKRW })),
          }))
          .filter((g) => g.items.length),
      }),

    /** 단지 × 평형별 시세표 (검색·필터) */
    'complex-table': () => {
      const rows = tradeComplexes.flatMap((c) =>
        c.sizes.map((s) => ({
          zone: c.zone,
          zoneLabel: zoneLabel(c.zone),
          complex: c.label,
          pyeong: s.pyeongLabel,
          pyeongNum: s.pyeong,
          area: s.area,
          amount: s.medianAmountManKRW,
          perPyeong: s.medianPerPyeongManKRW,
          count: s.count,
          last: s.lastTrade?.date ?? '',
          landShare: s.landSharePyeong,
        })),
      );
      const options = zones.zones
        .filter((z) => tradeComplexes.some((c) => c.zone === z.id))
        .map((z) => `<option value="${z.id}">${escapeHtml(z.shortName)}</option>`)
        .join('');
      return `<div class="datatable" data-widget="complex-table">
  <div class="filters">
    <label class="filters__field"><span>구역</span>
      <select data-filter="zone"><option value="">전체</option>${options}</select>
    </label>
    <label class="filters__field"><span>단지·평형 검색</span>
      <input type="search" data-filter="q" placeholder="예: 현대7차, 50평">
    </label>
    <label class="filters__field"><span>정렬</span>
      <select data-filter="sort">
        <option value="perPyeong-desc">평당가 높은 순</option>
        <option value="perPyeong-asc">평당가 낮은 순</option>
        <option value="amount-desc">거래금액 높은 순</option>
        <option value="amount-asc">거래금액 낮은 순</option>
        <option value="pyeongNum-asc">평형 작은 순</option>
        <option value="pyeongNum-desc">평형 큰 순</option>
      </select>
    </label>
  </div>
  <div class="table-wrap">
    <table class="datatable__table">
      <thead><tr><th>구역</th><th>단지</th><th>평형</th><th style="text-align:right">전용(㎡)</th><th style="text-align:right">중위 거래가</th><th style="text-align:right">평당가(만원)</th><th style="text-align:right">거래건수</th><th>최근 거래</th><th style="text-align:right">지분당 단가</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr data-zone="${r.zone}" data-search="${escapeHtml(`${r.zoneLabel} ${r.complex} ${r.pyeong}`)}"
        data-perpyeong="${r.perPyeong ?? 0}" data-amount="${r.amount ?? 0}" data-pyeongnum="${r.pyeongNum ?? 0}">
        <td>${escapeHtml(r.zoneLabel)}</td><td>${escapeHtml(r.complex)}</td><td>${escapeHtml(r.pyeong)}</td>
        <td style="text-align:right">${r.area}</td>
        <td style="text-align:right">${eok(r.amount)}</td>
        <td style="text-align:right">${comma(r.perPyeong)}</td>
        <td style="text-align:right">${comma(r.count)}</td>
        <td>${escapeHtml(r.last)}</td>
        <td style="text-align:right">${
          r.landShare && r.amount
            ? `${comma(Math.round(r.amount / r.landShare))}만`
            : '<span class="muted" title="data/complexes.json 의 landSharePyeong 을 채우면 계산됩니다">미입력</span>'
        }</td>
      </tr>`,
        )
        .join('')}</tbody>
    </table>
  </div>
  <p class="datatable__empty" hidden>조건에 맞는 행이 없습니다.</p>
</div>`;
    },

    /** 지분 대비 가격 계산기 */
    'share-calculator': () => {
      const optgroups = zones.zones
        .map((z) => {
          const cs = tradeComplexes.filter((c) => c.zone === z.id);
          if (!cs.length) return '';
          return `<optgroup label="${escapeHtml(z.shortName)}">${cs
            .map((c) =>
              c.sizes
                .map(
                  (s) =>
                    `<option value="${s.medianAmountManKRW ?? ''}" data-pyeong="${s.pyeong}" data-share="${s.landSharePyeong ?? ''}">${escapeHtml(`${c.label} ${s.pyeongLabel} (전용 ${s.area}㎡)`)}</option>`,
                )
                .join(''),
            )
            .join('')}</optgroup>`;
        })
        .join('');
      return `<form class="calc" data-widget="share-calculator" novalidate>
  <h4 class="calc__title">지분 대비 가격 계산기</h4>
  <p class="calc__lead">재건축은 건물이 아니라 <strong>땅을 사는 거래</strong>입니다. 같은 가격이어도 대지지분이 크면 종전자산평가액이 커지고 분담금이 줄어듭니다.</p>
  <div class="calc__grid">
    <label class="calc__field calc__field--wide"><span>매물 선택 (실거래 중위값 자동 입력)</span>
      <select data-calc="preset"><option value="">직접 입력</option>${optgroups}</select>
    </label>
    <label class="calc__field"><span>매매가 <em>만원</em></span>
      <input type="number" data-calc="price" min="0" step="1000" value="">
      <small class="calc__hint" data-hint="price"></small>
    </label>
    <label class="calc__field"><span>전용면적 <em>평</em></span>
      <input type="number" data-calc="pyeong" min="0" step="0.1" value="">
    </label>
    <label class="calc__field"><span>대지지분 <em>평</em></span>
      <input type="number" data-calc="share" min="0" step="0.1" value="" placeholder="등기부등본 대지권 면적">
    </label>
  </div>
  <output class="calc__out" data-calc="out">
    <div class="stat"><span class="stat__label">전용면적 평당가</span><span class="stat__value" data-out="perPyeong">—</span></div>
    <div class="stat stat--hero"><span class="stat__label">대지지분 평당가</span><span class="stat__value" data-out="perShare">—</span></div>
    <div class="stat"><span class="stat__label">대지지분 / 전용면적</span><span class="stat__value" data-out="ratio">—</span></div>
  </output>
  <p class="calc__note">대지지분은 <a href="https://www.iros.go.kr" target="_blank" rel="noopener noreferrer">등기부등본</a> 표제부의 '대지권의 표시'(가장 확정적), 또는 무료로는 <a href="https://www.kras.go.kr" target="_blank" rel="noopener noreferrer">일사편리 부동산종합증명서</a>·<a href="https://seereal.lh.or.kr" target="_blank" rel="noopener noreferrer">씨:리얼</a>에서 확인하세요. 같은 구역 안에서 <strong>대지지분 평당가가 낮은 매물</strong>이 상대적으로 저평가된 구간입니다.</p>
</form>`;
    },

    /** 분담금 추정 계산기 (전용면적 기준으로 단위를 통일) */
    'contribution-calculator': () => {
      const a = policy.assumptions;
      const zoneOpts = zones.zones
        .map((z) => {
          const t = tradesByZone.get(z.id);
          const latest = [...(t?.series ?? [])]
            .reverse()
            .find((p) => Number.isFinite(p.medianPerPyeongManKRW));
          const cx = tradeComplexes.filter((c) => c.zone === z.id);
          const recent = cx
            .map((c) => c.medianPerPyeongManKRW)
            .filter((v) => Number.isFinite(v));
          const median = recent.length
            ? [...recent].sort((x, y) => x - y)[recent.length >> 1]
            : (latest?.medianPerPyeongManKRW ?? '');
          return `<option value="${z.id}" data-price="${median}">${escapeHtml(z.shortName)}${z.builder ? ` · ${escapeHtml(z.builder)}` : ''}</option>`;
        })
        .join('');
      return `<form class="calc calc--contrib" data-widget="contribution-calculator" novalidate>
  <h4 class="calc__title">분담금 추정 계산기</h4>
  <p class="calc__lead">조합의 확정 수치가 아닌 <strong>추정 모델</strong>입니다. 네 개의 입력값을 바꿔 시나리오를 비교하는 용도로 설계했습니다. <strong>모든 면적과 단가는 전용면적 기준</strong>으로 통일했습니다.</p>
  <div class="calc__grid">
    <label class="calc__field"><span>구역 <em>선택 시 단가 자동 입력</em></span><select data-calc="zone">${zoneOpts}</select></label>
    <label class="calc__field"><span>내 종전자산 감정가 <em>만원</em></span>
      <input type="number" data-calc="prior" min="0" step="1000" value="200000">
      <small class="calc__hint" data-hint="prior"></small>
    </label>
    <label class="calc__field"><span>비례율 <em>%</em></span>
      <input type="number" data-calc="rate" min="50" max="200" step="1" value="${Math.round(a.proportionalRate.value * 100)}">
    </label>
    <label class="calc__field"><span>신청 평형 <em>전용 평</em></span>
      <input type="number" data-calc="newPyeong" min="10" max="150" step="1" value="40">
    </label>
    <label class="calc__field"><span>조합원 분양가 단가 <em>만원 / 전용 평</em></span>
      <input type="number" data-calc="salePrice" min="0" step="100" value="">
      <small class="calc__hint" data-hint="salePrice"></small>
    </label>
  </div>
  <output class="calc__out calc__out--contrib">
    <div class="stat"><span class="stat__label">권리가액 (종전자산 × 비례율)</span><span class="stat__value" data-out="right">—</span></div>
    <div class="stat"><span class="stat__label">조합원 분양가</span><span class="stat__value" data-out="newPrice">—</span></div>
    <div class="stat stat--hero"><span class="stat__label">추정 분담금</span><span class="stat__value" data-out="contrib">—</span></div>
  </output>
  <div class="calc__formula">
    <p><strong>계산식</strong></p>
    <ol>
      <li>권리가액 = 내 종전자산 감정가 × 비례율</li>
      <li>조합원 분양가 = 신청 평형(전용) × 조합원 분양가 단가</li>
      <li>분담금 = 조합원 분양가 − 권리가액 <span class="muted">(음수면 환급)</span></li>
    </ol>
  </div>
  <div class="sens">
    <p class="sens__title">비례율 민감도 — 같은 조건에서 비례율만 바꿨을 때</p>
    <div class="table-wrap"><table class="sens__table">
      <thead><tr><th>비례율</th><th style="text-align:right">권리가액</th><th style="text-align:right">추정 분담금</th></tr></thead>
      <tbody data-out="sens"></tbody>
    </table></div>
  </div>
  <aside class="callout callout--warn">
    <p class="callout__label">주의</p>
    <p>이 계산에서 <strong>조합원 분양가 단가는 확정된 값이 아닙니다.</strong> 기본값으로는 해당 구역의 <strong>현재 전용 평당 실거래가</strong>를 넣었습니다. 실제 조합원 분양가는 재건축 후 종후자산평가 결과로 책정되며 현재 시세와 다릅니다. 반드시 직접 조정해 여러 시나리오를 보세요.</p>
    <p>또한 <strong>재건축초과이익환수제 부담금, 이주비 대출 이자, 취득세 등이 포함되어 있지 않습니다.</strong> 실제 총 부담은 이 값보다 큽니다. 비례율 기본값 100%의 근거는 다음과 같습니다 — ${escapeHtml(a.proportionalRate.basis)}</p>
  </aside>
</form>`;
    },

    /** 구역별 공사비 규모 — 공개된 총공사비와 계획 세대수로 산출 */
    'construction-cost': () => {
      const rows = zones.zones
        .filter((z) => z.constructionCostBillionKRW || z.constructionCostPerPyeongManKRW)
        .map((z) => {
          const perUnit =
            z.constructionCostBillionKRW && z.unitsAfter
              ? z.constructionCostBillionKRW / z.unitsAfter
              : null;
          return `<tr>
        <td>${escapeHtml(z.shortName)}</td>
        <td>${escapeHtml(z.builder ?? '미선정')}</td>
        <td style="text-align:right">${z.constructionCostBillionKRW ? billionKRW(z.constructionCostBillionKRW) : '미공개'}</td>
        <td style="text-align:right">${z.unitsAfter ? comma(z.unitsAfter) : '—'}</td>
        <td style="text-align:right">${perUnit ? `${perUnit.toFixed(1)}억원` : '—'}</td>
        <td style="text-align:right">${z.constructionCostPerPyeongManKRW ? `${comma(z.constructionCostPerPyeongManKRW)}만원` : '미공개'}</td>
      </tr>`;
        })
        .join('');
      return `<div class="table-wrap"><table>
  <thead><tr><th>구역</th><th>시공사</th><th style="text-align:right">총공사비</th><th style="text-align:right">계획 세대</th><th style="text-align:right">세대당 평균 공사비</th><th style="text-align:right">3.3㎡당 단가</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>
<p class="chart__unit">세대당 평균 공사비 = 총공사비 ÷ 계획 세대수. 일반분양 세대를 포함한 값이므로 조합원 1인 부담액이 아니며, <strong>사업 규모를 비교하는 지표</strong>입니다. 일반분양 수익이 이 비용의 상당 부분을 상쇄합니다.</p>`;
    },

    /** 진행 게이지 */
    /** 진행 게이지 */
    'progress-meters': () =>
      progressMeters({
        id: 'chart-progress',
        title: '구역별 재건축 진행 단계',
        zones: zones.zones,
        ladder: zones.stageLadder,
      }),

    /** 마일스톤 타임라인 */
    timeline: () =>
      timeline({ id: 'chart-timeline', title: '구역별 확인된 일정과 목표 시점', zones: zones.zones }),

    /** 입지 카드 */
    'location-cards': (args) => {
      const only = args ? args.split(/[\s,]+/).filter(Boolean) : null;
      const cats = location.categories.filter((c) => !only || only.includes(c.id));
      return `<div class="loccats">${cats
        .map(
          (c) => `<section class="loccat" id="loc-${c.id}">
  <h4 class="loccat__title">${escapeHtml(c.title)}</h4>
  <ul class="loccat__items">${c.items
    .map(
      (it) => `<li class="locitem locitem--${it.impact}">
    <div class="locitem__head"><span class="locitem__name">${escapeHtml(it.name)}</span><span class="locitem__impact">영향도 ${it.impact === 'high' ? '높음' : it.impact === 'medium' ? '중간' : '낮음'}</span></div>
    <p class="locitem__detail">${escapeHtml(it.detail)}</p>
    ${it.note ? `<p class="locitem__note">${escapeHtml(it.note)}</p>` : ''}
    <p class="locitem__zones">해당 구역: ${(it.zones ?? []).map((z) => escapeHtml(zoneLabel(z))).join(', ') || '전체'}</p>
    ${(it.sources ?? []).length ? `<p class="locitem__src">출처: ${it.sources.map((k) => (sources.sources[k] ? `<a href="${sources.sources[k].url}" target="_blank" rel="noopener noreferrer">${escapeHtml(sources.sources[k].publisher)}</a>` : escapeHtml(k))).join(' · ')}</p>` : ''}
  </li>`,
    )
    .join('')}</ul>
</section>`,
        )
        .join('')}</div>`;
    },

    /** 재초환 요약 */
    'policy-jaechohwan': () => {
      const j = policy.jaechohwan;
      return `<div class="policybox">
  <h4 class="policybox__title">${escapeHtml(j.name)}</h4>
  <dl class="policybox__stats">
    <div><dt>면제 기준</dt><dd>조합원 1인당 평균 초과이익 ${comma(j.exemptionThresholdManKRW)}만원</dd></div>
    <div><dt>부과율</dt><dd>${escapeHtml(j.rateRange)}</dd></div>
    <div><dt>현재 상태</dt><dd>${escapeHtml(j.status)}</dd></div>
  </dl>
  <ul class="policybox__facts">${j.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
  <p class="policybox__src">출처: ${j.sources.map((k) => (sources.sources[k] ? `<a href="${sources.sources[k].url}" target="_blank" rel="noopener noreferrer">${escapeHtml(sources.sources[k].publisher)}</a>` : escapeHtml(k))).join(' · ')}</p>
</div>`;
    },

    /** 전체 출처 목록 */
    'sources-list': () =>
      `<div class="table-wrap"><table class="sources"><thead><tr><th>매체</th><th>제목</th><th>일자</th></tr></thead><tbody>${Object.entries(
        sources.sources,
      )
        .sort((a, b) => String(b[1].date).localeCompare(String(a[1].date)))
        .map(
          ([, s]) =>
            `<tr><td>${escapeHtml(s.publisher)}</td><td><a href="${s.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a></td><td>${escapeHtml(String(s.date))}</td></tr>`,
        )
        .join('')}</tbody></table></div>`,
  };
}

const STAGE_MEANING = {
  1: '용도지역·용적률·층수 등 사업의 상한이 정해집니다. 이 단계 전 매수는 계획 변경 위험을 그대로 감수하는 것입니다.',
  2: '주민 동의를 모으는 단계. 내부 갈등이 표면화되는 구간으로 지연 위험이 가장 큽니다.',
  3: '조합원 지위가 생깁니다. 투기과열지구에서는 이 시점 이후 조합원 지위 양도가 원칙적으로 제한됩니다.',
  4: '공사비 단가가 계약으로 확정되기 시작합니다. 분담금 추정의 첫 실질 근거가 나옵니다.',
  5: '건축·경관·교통·환경 심의를 한 번에 처리합니다. 통과하면 설계와 세대수가 사실상 굳어집니다.',
  6: '사업 내용이 인가로 확정됩니다. 종전자산 감정평가가 이어지며 분담금 윤곽이 나옵니다.',
  7: '조합원별 분담금이 확정 통보됩니다. 재초환 예정액도 이 시점 기준으로 산정됩니다.',
  8: '이주비 대출과 전세 수요 이동이 발생합니다. 주변 임대료에 영향을 주는 구간입니다.',
  9: '공사 기간이 시작됩니다. 공사비 상승분은 이후 분담금 변동으로 이어집니다.',
  10: '입주와 함께 재초환 부담금이 확정 부과됩니다.',
};
