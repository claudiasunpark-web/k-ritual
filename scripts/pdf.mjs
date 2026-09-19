#!/usr/bin/env node
/**
 * 전자책 전체를 인쇄용 PDF 한 권으로 내보냅니다.
 *   npm i -D playwright        # 최초 1회 (브라우저 자동 설치)
 *   node scripts/serve.mjs &   # 별도 터미널
 *   node scripts/pdf.mjs
 *
 * playwright가 없으면 브라우저의 '인쇄 → PDF로 저장'을 쓰세요.
 * 인쇄용 스타일(assets/style.css의 @media print)이 이미 적용되어 있습니다.
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(`playwright가 설치되어 있지 않습니다.

  npm i -D playwright

또는 브라우저에서 각 장을 열고 '인쇄 → PDF로 저장'을 사용하세요.
인쇄용 레이아웃은 이미 준비되어 있습니다(목차·버튼 숨김, 링크 주소 표시, 표 전체 펼침).`);
  process.exit(1);
}

const ROOT = new URL('..', import.meta.url);
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const outDir = new URL('dist-pdf/', ROOT);
mkdirSync(outDir, { recursive: true });

// content 파일 순서를 그대로 따릅니다.
const files = readdirSync(new URL('content/', ROOT)).filter((f) => f.endsWith('.md')).sort();
const slugs = files.map((f) => {
  const raw = readFileSync(new URL(`content/${f}`, ROOT), 'utf8');
  const slug = raw.match(/^slug:\s*(.+)$/m)?.[1]?.trim();
  const isCover = /^kind:\s*cover\s*$/m.test(raw);
  return isCover ? '' : (slug ?? f.replace(/^\d+-/, '').replace(/\.md$/, ''));
});

const browser = await chromium.launch();
const page = await browser.newPage();
const opts = {
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-size:9px;color:#888;padding:0 16mm;display:flex;justify-content:space-between"><span>압구정 아파트 재건축 투자 지도</span><span class="pageNumber"></span></div>',
};

for (const slug of slugs) {
  const url = slug ? `${base}/${slug}/` : `${base}/`;
  await page.goto(url, { waitUntil: 'networkidle' });
  // '표로 보기'를 모두 펼쳐 인쇄본에 데이터가 빠지지 않게 합니다.
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  });
  const name = slug || '00-cover';
  await page.pdf({ ...opts, path: new URL(`${name}.pdf`, outDir).pathname });
  console.log(`  ${name}.pdf`);
}

await browser.close();
console.log(`\n완료: dist-pdf/ (장별 PDF). 한 권으로 합치려면 pdfunite 등을 사용하세요.`);
