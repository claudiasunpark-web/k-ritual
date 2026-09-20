// 캐릭터 일러스트를 public/assets/ 로 내려받는 스크립트
//   node scripts/fetch-art.mjs
// URL 은 생성된 원본 이미지 주소입니다. 네트워크가 막힌 환경에서는
// 이미지를 직접 저장해 public/assets/{hari,doyun,mio,jay}.png 로 넣어도 됩니다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'assets');

const ART = {
  hari: 'https://d8j0ntlcm91z4.cloudfront.net/user_3H4QLRROILnSUhHh4O4DOxZLTkj/hf_20260920_061723_bec0b444-39ec-459d-94ac-52be32a7aee3.png',
  doyun: 'https://d8j0ntlcm91z4.cloudfront.net/user_3H4QLRROILnSUhHh4O4DOxZLTkj/hf_20260920_061723_98a8e421-01ec-467c-9c2b-65506a959006.png',
  mio: 'https://d8j0ntlcm91z4.cloudfront.net/user_3H4QLRROILnSUhHh4O4DOxZLTkj/hf_20260920_061723_8786a831-1ebc-4d78-a9ea-0c7b29f687ab.png',
  jay: 'https://d8j0ntlcm91z4.cloudfront.net/user_3H4QLRROILnSUhHh4O4DOxZLTkj/hf_20260920_061723_2817f3a1-eb49-485a-a6c0-88f6f9d4084f.png',
};

await fs.mkdir(OUT, { recursive: true });

for (const [name, url] of Object.entries(ART)) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(OUT, `${name}.png`);
    await fs.writeFile(file, buf);
    console.log(`✓ ${name}.png  (${(buf.length / 1024).toFixed(0)}KB)`);
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
  }
}
