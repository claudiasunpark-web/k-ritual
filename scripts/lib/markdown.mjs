// 전자책 원고용 최소 마크다운 → HTML 변환기. 외부 의존성 없음.
// 지원: 제목, 단락, 목록, 표(GFM), 인용, 구분선, 코드, 각주식 출처 표기,
//       그리고 ::: 블록(위젯 삽입 / 콜아웃).

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

/**
 * 인라인 문법을 변환합니다.
 * `code`, **bold**, *italic*, [text](url), [^src:key] 출처 참조, 줄바꿈 두 칸.
 */
function inline(text, ctx) {
  const codeStash = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codeStash.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000${codeStash.length - 1}\u0000`;
  });

  s = escapeHtml(s);

  // 출처 참조: [^src:hankyung-2026-07-03]
  s = s.replace(/\[\^src:([A-Za-z0-9_.-]+)\]/g, (_, key) => {
    const src = ctx?.sources?.[key];
    if (!src) {
      ctx?.warnings?.push(`알 수 없는 출처 키: ${key}`);
      return `<sup class="src src--missing" title="출처 키 없음: ${key}">?</sup>`;
    }
    const n = ctx.citeOrder.indexOf(key) === -1
      ? (ctx.citeOrder.push(key), ctx.citeOrder.length)
      : ctx.citeOrder.indexOf(key) + 1;
    const label = `${src.publisher}, ${src.title}`;
    return `<sup class="src"><a href="${src.url}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(label)}">${n}</a></sup>`;
  });

  s = s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, t, href) =>
        /^https?:/.test(href)
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${t}</a>`
          : `<a href="${href}">${t}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/ {2}$/gm, '<br>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codeStash[Number(i)]);
}

const CALLOUT_LABEL = {
  note: '참고',
  warn: '주의',
  risk: '리스크',
  tip: '체크포인트',
  data: '데이터 기준',
};

/**
 * @param {string} src 마크다운 원문
 * @param {{sources?:object, widgets?:Record<string,(args:string)=>string>, warnings?:string[]}} ctx
 * @returns {{html:string, headings:{level:number,text:string,id:string}[], citeOrder:string[]}}
 */
export function render(src, ctx = {}) {
  const context = {
    sources: ctx.sources ?? {},
    widgets: ctx.widgets ?? {},
    warnings: ctx.warnings ?? [],
    citeOrder: [],
  };
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (buf.length) out.push(`<p>${inline(buf.join('\n'), context)}</p>`);
    buf.length = 0;
  };
  const para = [];

  while (i < lines.length) {
    const line = lines[i];

    // ── ::: 블록 ────────────────────────────────────────────
    const blockOpen = line.match(/^:::\s*([a-z0-9-]+)\s*(.*)$/i);
    if (blockOpen) {
      flushParagraph(para);
      const kind = blockOpen[1].toLowerCase();
      const args = blockOpen[2].trim();
      const body = [];
      i += 1;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // 닫는 :::

      if (context.widgets[kind]) {
        out.push(context.widgets[kind](args, body.join('\n')));
      } else if (CALLOUT_LABEL[kind]) {
        const inner = render(body.join('\n'), { ...ctx, sources: context.sources });
        context.citeOrder.push(...inner.citeOrder.filter((k) => !context.citeOrder.includes(k)));
        out.push(
          `<aside class="callout callout--${kind}"><p class="callout__label">${CALLOUT_LABEL[kind]}</p>${inner.html}</aside>`,
        );
      } else {
        context.warnings.push(`알 수 없는 ::: 블록: ${kind}`);
        out.push(`<!-- unknown block: ${kind} -->`);
      }
      continue;
    }

    // ── 코드 펜스 ───────────────────────────────────────────
    if (/^```/.test(line)) {
      flushParagraph(para);
      const lang = line.slice(3).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(
        `<pre class="code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(body.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // ── 표 ─────────────────────────────────────────────────
    if (/^\|/.test(line) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      flushParagraph(para);
      const cells = (row) =>
        row
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const header = cells(line);
      const aligns = cells(lines[i + 1]).map((a) =>
        a.startsWith(':') && a.endsWith(':') ? 'center' : a.endsWith(':') ? 'right' : 'left',
      );
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      const th = header
        .map((h, n) => `<th style="text-align:${aligns[n] ?? 'left'}">${inline(h, context)}</th>`)
        .join('');
      const tb = rows
        .map(
          (r) =>
            `<tr>${r
              .map((c, n) => `<td style="text-align:${aligns[n] ?? 'left'}">${inline(c, context)}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      out.push(
        `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`,
      );
      continue;
    }

    // ── 제목 ───────────────────────────────────────────────
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushParagraph(para);
      const level = h[1].length;
      const text = h[2].trim();
      const id = slugify(text);
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(text, context)}</h${level}>`);
      i += 1;
      continue;
    }

    // ── 구분선 ─────────────────────────────────────────────
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph(para);
      out.push('<hr>');
      i += 1;
      continue;
    }

    // ── 인용 ───────────────────────────────────────────────
    if (/^>\s?/.test(line)) {
      flushParagraph(para);
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      const inner = render(body.join('\n'), { ...ctx, sources: context.sources });
      context.citeOrder.push(...inner.citeOrder.filter((k) => !context.citeOrder.includes(k)));
      out.push(`<blockquote>${inner.html}</blockquote>`);
      continue;
    }

    // ── 목록 ───────────────────────────────────────────────
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flushParagraph(para);
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const indent = lines[i].match(/^\s*/)[0].length;
        let content = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        i += 1;
        // 다음 줄이 더 들여쓰기된 본문이면 같은 항목에 이어붙입니다.
        while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          content += `\n${lines[i].trim()}`;
          i += 1;
        }
        items.push({ indent, content });
      }
      const base = Math.min(...items.map((it) => it.indent));
      const tag = ordered ? 'ol' : 'ul';
      // 들여쓰기된 항목은 직전 <li> 안에 중첩 목록으로 넣습니다(유효한 HTML 유지).
      const html = [];
      let nested = false;
      for (const it of items) {
        const isChild = it.indent > base;
        if (isChild && !nested) {
          html.push(`<${tag}>`);
          nested = true;
        } else if (!isChild && nested) {
          html.push(`</${tag}></li>`);
          nested = false;
        } else if (!isChild && html.length) {
          html.push('</li>');
        }
        if (isChild) html.push(`<li>${inline(it.content, context)}</li>`);
        else html.push(`<li>${inline(it.content, context)}`);
      }
      if (nested) html.push(`</${tag}>`);
      if (html.length) html.push('</li>');
      out.push(`<${tag}>${html.join('')}</${tag}>`);
      continue;
    }

    // ── 빈 줄 / 단락 ───────────────────────────────────────
    if (line.trim() === '') {
      flushParagraph(para);
    } else {
      para.push(line);
    }
    i += 1;
  }
  flushParagraph(para);

  return { html: out.join('\n'), headings, citeOrder: context.citeOrder };
}
