// 전자책 인터랙션: 목차 토글, 테마, 차트 호버, 계산기, 표 필터.
// 빌드 도구 없이 브라우저에서 바로 실행되는 ES 모듈입니다.

const comma = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('ko-KR') : '—');

function perPyeong(manKRW) {
  if (!Number.isFinite(Number(manKRW))) return '—';
  const v = Math.round(Number(manKRW));
  if (v < 10000) return `${comma(v)}만원`;
  const e = Math.floor(v / 10000);
  const rest = v % 10000;
  return rest ? `${e}억 ${comma(rest)}만원` : `${e}억원`;
}

function eok(manKRW) {
  if (!Number.isFinite(Number(manKRW))) return '—';
  const v = Number(manKRW);
  const e = v / 10000;
  if (Math.abs(e) >= 100) return `${comma(Math.round(e))}억원`;
  if (Math.abs(e) >= 1) return `${e.toFixed(1).replace(/\.0$/, '')}억원`;
  return `${comma(Math.round(v))}만원`;
}

/** 숫자 입력 옆에 억원 환산을 보여 줍니다. */
function setHint(form, name, manKRW) {
  const el = form.querySelector(`[data-hint="${name}"]`);
  if (!el) return;
  el.textContent = Number(manKRW) > 0 ? `= ${eok(manKRW)}` : '';
}

/* ── 모바일 목차 ──────────────────────────────────────── */
(() => {
  const toggle = document.querySelector('.navtoggle');
  const nav = document.getElementById('sidenav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
})();

/* ── 테마 토글 ────────────────────────────────────────── */
(() => {
  const btn = document.querySelector('.themetoggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = cur ? (cur === 'dark' ? 'light' : 'dark') : prefersDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch (e) {
      /* 프라이빗 모드 등에서 저장이 막혀도 전환은 동작합니다. */
    }
  });
})();

/* ── 라인 차트: 평형대 전환 + 범례 토글 + 크로스헤어 툴팁 ── */
document.querySelectorAll('figure[data-chart="line"]').forEach((fig) => {
  const hidden = new Set();

  // 범례는 그림 전체에 하나. 모든 평형대 뷰의 시리즈에 함께 적용합니다.
  const legendButtons = [...fig.querySelectorAll('.legend__item')];
  const applyHidden = () => {
    fig.querySelectorAll('.series').forEach((g) => {
      g.classList.toggle('is-dim', hidden.has(g.dataset.key));
    });
  };
  legendButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const on = btn.getAttribute('aria-pressed') === 'true';
      // 마지막 하나를 끄면 읽을 게 없어지므로 막습니다.
      if (on && hidden.size >= legendButtons.length - 1) return;
      btn.setAttribute('aria-pressed', String(!on));
      if (on) hidden.add(key);
      else hidden.delete(key);
      applyHidden();
    });
  });

  // 평형대 전환
  const select = fig.querySelector('[data-band-select]');
  select?.addEventListener('change', () => {
    fig.querySelectorAll('.chart__view').forEach((v) => {
      v.hidden = v.dataset.band !== select.value;
    });
    applyHidden();
  });

  // 뷰별 크로스헤어 툴팁
  fig.querySelectorAll('.chart__view .chart__plot').forEach((plot) => {
    let cfg;
    try {
      cfg = JSON.parse(plot.dataset.hover);
    } catch (e) {
      return;
    }
    const svg = plot.querySelector('svg');
    const hit = plot.querySelector('.hit');
    const cross = plot.querySelector('.crosshair');
    const crossLine = cross?.querySelector('line');
    const tip = plot.querySelector('.tooltip');
    if (!svg || !hit || !tip || !crossLine) return;

    const xOf = (i) =>
      cfg.pad.left + (cfg.ymList.length === 1 ? cfg.plotW / 2 : (i / (cfg.ymList.length - 1)) * cfg.plotW);

    const show = (clientX) => {
      const box = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const svgX = ((clientX - box.left) / box.width) * vb.width;
      const t = (svgX - cfg.pad.left) / cfg.plotW;
      const idx = Math.max(0, Math.min(cfg.ymList.length - 1, Math.round(t * (cfg.ymList.length - 1))));

      const rows = cfg.series
        .filter((s) => !hidden.has(s.key) && Number.isFinite(s.points[idx]))
        .sort((a, b) => b.points[idx] - a.points[idx]);
      if (rows.length === 0) {
        tip.hidden = true;
        cross.hidden = true;
        return;
      }

      const cx = xOf(idx);
      crossLine.setAttribute('x1', cx);
      crossLine.setAttribute('x2', cx);
      cross.hidden = false;

      tip.innerHTML =
        `<p class="tooltip__ym">${cfg.ymList[idx]} · 전용 평당 중위값</p>` +
        rows
          .map((s) => {
            const n = s.counts?.[idx];
            const few = Number.isFinite(n) && n <= 2 ? `<span class="tooltip__few">${n}건</span>` : '';
            return `<span class="tooltip__row"><span class="tooltip__dot" style="background:var(--series-${s.slot})"></span>${s.label}${few}<span class="tooltip__v">${comma(s.points[idx])}만</span></span>`;
          })
          .join('');
      tip.hidden = false;
      const pct = (cx / vb.width) * 100;
      tip.style.left = `${pct}%`;
      tip.style.top = '6px';
      tip.style.transform = pct > 50 ? 'translate(calc(-100% - 14px), 0)' : 'translate(14px, 0)';
    };

    const hide = () => {
      tip.hidden = true;
      cross.hidden = true;
    };

    hit.addEventListener('pointermove', (e) => show(e.clientX));
    hit.addEventListener('pointerdown', (e) => show(e.clientX));
    hit.addEventListener('pointerleave', hide);
    svg.addEventListener('blur', hide);
  });
});

/* ── 막대 차트 호버 툴팁 ──────────────────────────────── */
document.querySelectorAll('figure[data-chart="bar"]').forEach((fig) => {
  const tip = fig.querySelector('.tooltip');
  if (!tip) return;
  fig.querySelectorAll('.bar').forEach((bar) => {
    const enter = (e) => {
      tip.innerHTML = `<span class="tooltip__row">${bar.dataset.label}<span class="tooltip__v">${comma(bar.dataset.value)}만/평</span></span>`;
      tip.hidden = false;
      const box = fig.querySelector('.chart__plot').getBoundingClientRect();
      tip.style.left = `${((e.clientX - box.left) / box.width) * 100}%`;
      tip.style.top = `${e.clientY - box.top - 12}px`;
    };
    bar.addEventListener('pointerenter', enter);
    bar.addEventListener('pointermove', enter);
    bar.addEventListener('pointerleave', () => {
      tip.hidden = true;
    });
  });
});

/* ── 지분 대비 가격 계산기 ────────────────────────────── */
document.querySelectorAll('[data-widget="share-calculator"]').forEach((form) => {
  const get = (name) => form.querySelector(`[data-calc="${name}"]`);
  const out = (name) => form.querySelector(`[data-out="${name}"]`);
  const preset = get('preset');

  const recalc = () => {
    const price = Number(get('price').value);
    const pyeong = Number(get('pyeong').value);
    const share = Number(get('share').value);

    setHint(form, 'price', price);
    out('perPyeong').textContent = price > 0 && pyeong > 0 ? perPyeong(price / pyeong) : '—';

    const shareReady = price > 0 && share > 0;
    const perShare = out('perShare');
    perShare.textContent = shareReady ? perPyeong(price / share) : '대지지분 입력 필요';
    // 숫자가 아닌 안내 문구일 때는 히어로 크기를 줄여 줄바꿈이 깨지지 않게 합니다.
    perShare.classList.toggle('stat__value--hint', !shareReady);

    out('ratio').textContent = pyeong > 0 && share > 0 ? `${(share / pyeong).toFixed(2)}배` : '—';
  };

  preset?.addEventListener('change', () => {
    const opt = preset.selectedOptions[0];
    if (!opt || !opt.value) return;
    get('price').value = opt.value;
    get('pyeong').value = opt.dataset.pyeong ?? '';
    if (opt.dataset.share) get('share').value = opt.dataset.share;
    recalc();
  });
  form.querySelectorAll('input').forEach((el) => el.addEventListener('input', recalc));
  form.addEventListener('submit', (e) => e.preventDefault());
  recalc();
});

/* ── 분담금 추정 계산기 ──────────────────────────────── */
document.querySelectorAll('[data-widget="contribution-calculator"]').forEach((form) => {
  const get = (name) => form.querySelector(`[data-calc="${name}"]`);
  const out = (name) => form.querySelector(`[data-out="${name}"]`);
  const zone = get('zone');

  const fillFromZone = () => {
    const opt = zone?.selectedOptions[0];
    const price = Number(opt?.dataset.price);
    if (Number.isFinite(price) && price > 0) get('salePrice').value = String(price);
  };

  const recalc = () => {
    const prior = Number(get('prior').value);
    const rate = Number(get('rate').value) / 100;
    const newPyeong = Number(get('newPyeong').value);
    const unit = Number(get('salePrice').value);

    setHint(form, 'prior', prior);
    setHint(form, 'salePrice', unit);
    const ready = prior > 0 && newPyeong > 0 && unit > 0;
    const right = prior * rate;
    const newPrice = newPyeong * unit;
    const contrib = newPrice - right;

    out('right').textContent = prior > 0 ? eok(right) : '—';
    out('newPrice').textContent = newPyeong > 0 && unit > 0 ? eok(newPrice) : '—';
    out('contrib').textContent = ready
      ? contrib >= 0
        ? eok(contrib)
        : `${eok(Math.abs(contrib))} 환급`
      : '—';

    // 비례율 민감도 표
    const body = out('sens');
    if (body) {
      body.innerHTML = [80, 90, 100, 110, 120]
        .map((r) => {
          const rr = (prior * r) / 100;
          const c = newPrice - rr;
          const label = ready ? (c >= 0 ? eok(c) : `${eok(Math.abs(c))} 환급`) : '—';
          const isCurrent = Math.round(rate * 100) === r;
          return `<tr${isCurrent ? ' class="is-current"' : ''}><td>${r}%</td><td style="text-align:right">${prior > 0 ? eok(rr) : '—'}</td><td style="text-align:right">${label}</td></tr>`;
        })
        .join('');
    }
  };

  zone?.addEventListener('change', () => {
    fillFromZone();
    recalc();
  });
  form.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', recalc));
  form.addEventListener('submit', (e) => e.preventDefault());
  fillFromZone();
  recalc();
});

/* ── 단지·평형 시세표 필터 ───────────────────────────── */
document.querySelectorAll('[data-widget="complex-table"], [data-widget="trade-log"]').forEach((root) => {
  const tbody = root.querySelector('tbody');
  const empty = root.querySelector('.datatable__empty');
  if (!tbody) return;
  const all = [...tbody.querySelectorAll('tr')];
  const f = (name) => root.querySelector(`[data-filter="${name}"]`);

  const apply = () => {
    const zone = f('zone')?.value ?? '';
    const q = (f('q')?.value ?? '').trim().toLowerCase();
    const [key, dir] = (f('sort')?.value ?? 'perPyeong-desc').split('-');
    const attr = { perPyeong: 'perpyeong', amount: 'amount', pyeongNum: 'pyeongnum', date: 'date' }[key];

    let visible = 0;
    for (const tr of all) {
      const okZone = !zone || tr.dataset.zone === zone;
      const okQ = !q || tr.dataset.search.toLowerCase().includes(q);
      const show = okZone && okQ;
      tr.hidden = !show;
      if (show) visible += 1;
    }
    if (empty) empty.hidden = visible > 0;

    const sorted = [...all].sort((a, b) => {
      // 계약일은 문자열 비교(YYYY-MM-DD 는 사전순 = 날짜순), 나머지는 수치 비교
      if (attr === 'date') {
        const av = a.dataset.date ?? '';
        const bv = b.dataset.date ?? '';
        return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = Number(a.dataset[attr]) || 0;
      const bv = Number(b.dataset[attr]) || 0;
      return dir === 'asc' ? av - bv : bv - av;
    });
    for (const tr of sorted) tbody.appendChild(tr);
  };

  root.querySelectorAll('[data-filter]').forEach((el) => {
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  });
  apply();
});
