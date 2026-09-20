#!/usr/bin/env node
/**
 * content/*.md + data/*.json → dist/ 정적 사이트
 *   node scripts/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { render, slugify } from './lib/markdown.mjs';
import { makeWidgets } from './lib/widgets.mjs';
import { escapeHtml } from './lib/format.mjs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const dist = new URL('dist/', ROOT);

// ── 데이터 로드 ────────────────────────────────────────────
const meta = read('data/meta.json');
const zones = read('data/zones.json');
const complexes = read('data/complexes.json');
const location = read('data/location.json');
const policy = read('data/policy.json');
const sources = read('data/sources.json');

const realTrades = new URL('data/trades/apgujeong.json', ROOT);
const sampleTrades = new URL('data/trades/sample.json', ROOT);
let trades = null;
if (existsSync(realTrades)) trades = JSON.parse(readFileSync(realTrades, 'utf8'));
else if (existsSync(sampleTrades)) trades = JSON.parse(readFileSync(sampleTrades, 'utf8'));

const warnings = [];
if (!trades) warnings.push('실거래 데이터가 없습니다. npm run fetch 또는 node scripts/make-sample.mjs 를 먼저 실행하세요.');
if (trades?.isSample) warnings.push('샘플(합성) 시세 데이터로 빌드했습니다. 판매·배포 전에 npm run fetch 로 실제 실거래를 채우세요.');

// ── 원고 로드 ──────────────────────────────────────────────
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { attrs: {}, body: raw };
  const attrs = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) attrs[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { attrs, body: raw.slice(m[0].length) };
}

const contentDir = new URL('content/', ROOT);
const files = readdirSync(contentDir).filter((f) => f.endsWith('.md')).sort();

// 1단계: 프런트매터만 읽어 페이지 인덱스를 만듭니다(목차 위젯이 이 정보를 씁니다).
const parsed = files.map((file) => {
  const raw = readFileSync(new URL(file, contentDir), 'utf8');
  const { attrs, body } = parseFrontmatter(raw);
  return {
    file,
    body,
    slug: attrs.slug ?? file.replace(/^\d+-/, '').replace(/\.md$/, ''),
    title: attrs.title ?? file,
    subtitle: attrs.subtitle ?? '',
    desc: attrs.desc ?? '',
    kind: attrs.kind ?? 'chapter',
    chapter: attrs.chapter ?? '',
  };
});

const pageIndex = parsed.map(({ slug, title, desc, kind, chapter }) => ({ slug, title, desc, kind, chapter }));
const widgets = makeWidgets({ zones, complexes, trades, location, policy, sources, meta, pageIndex });

// 2단계: 본문을 렌더링합니다.
const pages = parsed.map((p) => {
  const result = render(p.body, { sources: sources.sources, widgets, warnings });
  return {
    ...p,
    html: result.html,
    headings: result.headings.filter((h) => h.level === 2),
    cites: result.citeOrder,
  };
});

// ── 템플릿 ────────────────────────────────────────────────
const nav = (current) => `<nav class="sidenav" aria-label="목차">
  <a class="sidenav__brand" href="${linkTo(current, cover)}">
    <span class="sidenav__title">${escapeHtml(meta.title)}</span>
    <span class="sidenav__edition">${escapeHtml(meta.edition)}</span>
  </a>
  <ol class="sidenav__list">${pages
    .filter((p) => p.kind !== 'cover')
    .map((p) => {
      const active = p.slug === current.slug;
      return `<li class="sidenav__item${active ? ' is-active' : ''}">
      <a href="${linkTo(current, p)}">${p.chapter ? `<span class="sidenav__no">${escapeHtml(p.chapter)}</span>` : ''}${escapeHtml(p.title)}</a>
      ${active && p.headings.length ? `<ul class="sidenav__sub">${p.headings.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ul>` : ''}
    </li>`;
    })
    .join('')}</ol>
  <div class="sidenav__tools">
    <button class="themetoggle" type="button" aria-label="밝게/어둡게 전환">
      <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14"><path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5A5 5 0 0 1 8 1.5Z" fill="currentColor"/></svg>
      테마 전환
    </button>
  </div>
  <p class="sidenav__foot">기준일 ${escapeHtml(meta.asOf)}</p>
</nav>`;

/** 빌드 결과에서 각 페이지가 놓이는 경로. kind: cover 는 루트의 index.html 입니다. */
const pathOf = (page) => (page.kind === 'cover' ? 'index.html' : `${page.slug}/index.html`);

/** from 페이지에서 to 페이지로 가는 상대 경로. 표지만 루트에 있으므로 깊이가 다릅니다. */
function linkTo(from, to) {
  if (!to) return '#';
  const up = from.kind === 'cover' ? '' : '../';
  return `${up}${pathOf(to)}`;
}

const cover = parsed.find((p) => p.kind === 'cover') ?? parsed[0];

function layout(page) {
  const { title, subtitle, body, cites, prev, next } = page;
  const up = page.kind === 'cover' ? '' : '../';
  const citeList = cites?.length
    ? `<section class="refs"><h2 id="출처">이 장의 출처</h2><ol class="refs__list">${cites
        .map((k) => {
          const s = sources.sources[k];
          return s
            ? `<li id="ref-${k}"><a href="${s.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a> — ${escapeHtml(s.publisher)}${s.date ? `, ${escapeHtml(String(s.date))}` : ''}</li>`
            : `<li>${escapeHtml(k)}</li>`;
        })
        .join('')}</ol></section>`
    : '';

  return `<!DOCTYPE html>
<html lang="${meta.lang}" data-theme-default="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(meta.title)}</title>
<meta name="description" content="${escapeHtml(subtitle || meta.description)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%232a78d6'/%3E%3Cpath d='M7 23V13l5-4 5 4v10' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linejoin='round'/%3E%3Cpath d='M19 23V9l6 4.6V23' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="${up}assets/style.css">
<script>
  // 테마 깜빡임 방지 — 스타일 적용 전에 저장된 설정을 반영합니다.
  try { var t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
</script>
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
<button class="navtoggle" type="button" aria-expanded="false" aria-controls="sidenav">목차</button>
<div class="shell">
  <div id="sidenav" class="shell__nav">${nav(page)}</div>
  <main class="shell__main" id="main">
    <header class="pagehead">
      ${page.kind === 'cover' ? '' : `<p class="pagehead__kicker">${escapeHtml(meta.title)}</p>`}
      <h1 class="pagehead__title">${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="pagehead__sub">${escapeHtml(subtitle)}</p>` : ''}
    </header>
    <article class="prose">
${body}
    </article>
    ${citeList}
    <nav class="pager" aria-label="이전·다음">
      ${prev ? `<a class="pager__link pager__link--prev" href="${linkTo(page, prev)}"><span>이전</span>${escapeHtml(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a class="pager__link pager__link--next" href="${linkTo(page, next)}"><span>다음</span>${escapeHtml(next.title)}</a>` : '<span></span>'}
    </nav>
    <footer class="foot">
      <p>${escapeHtml(meta.title)} · ${escapeHtml(meta.edition)} · 기준일 ${escapeHtml(meta.asOf)}</p>
      <p class="foot__disc">이 자료는 투자 권유가 아니며, 공개 자료를 정리한 정보 제공 목적의 콘텐츠입니다.</p>
    </footer>
  </main>
</div>
<script src="${up}assets/app.js"></script>
</body>
</html>
`;
}

// ── 출력 ──────────────────────────────────────────────────
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(new URL('assets/', ROOT), new URL('assets/', dist), { recursive: true });

pages.forEach((p, i) => {
  const prev = pages[i - 1];
  const next = pages[i + 1];
  const html = layout({ ...p, body: p.html, prev, next });
  const dir = p.kind === 'cover' ? dist : new URL(`${p.slug}/`, dist);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('index.html', dir), html);
});

if (!pages.some((p) => p.kind === 'cover')) {
  warnings.push('kind: cover 인 페이지가 없어 index.html 이 생성되지 않았습니다.');
}

// 데이터도 함께 배포해 클라이언트 위젯이 읽을 수 있게 합니다.
mkdirSync(new URL('data/', dist), { recursive: true });
for (const [name, doc] of Object.entries({ zones, complexes, location, policy, sources, meta, trades })) {
  if (doc) writeFileSync(new URL(`data/${name}.json`, dist), JSON.stringify(doc));
}
writeFileSync(new URL('.nojekyll', dist), '');

console.log(`빌드 완료: ${pages.length}개 페이지 → dist/`);
for (const p of pages) console.log(`  ${p.kind === 'cover' ? 'index.html' : `${p.slug}/index.html`}  ${p.title}`);
if (warnings.length) {
  console.log('\n경고:');
  for (const w of [...new Set(warnings)]) console.log(`  - ${w}`);
}
