"""표지 이미지를 내려받아 작은 썸네일(가로 96px)로 줄여 web/.covers/ 에 저장한다.

미리보기 페이지는 외부 이미지를 불러오지 못해서, 빌드할 때 이 썸네일을 페이지 안에 넣는다.
(EMBED_COVERS=1 npm run build). 실제 앱은 시트의 원래 표지 주소를 쓴다.

    python3 -I scripts/cache-covers.py
"""
import csv, io, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", ".covers")
os.makedirs(OUT, exist_ok=True)

urls = set()
for name in ("books.csv", "series.csv"):
    with open(os.path.join(ROOT, "data", name), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            u = (r.get("표지") or "").strip()
            if u.startswith("https://"):
                urls.add(u)

def key(url):
    return "".join(c if c.isalnum() else "_" for c in url.split("//", 1)[1])[-80:] + ".jpg"

def fetch(url):
    path = os.path.join(OUT, key(url))
    if os.path.exists(path):
        return "cached"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "secret-book-club-catalog/1.0"})
        data = urllib.request.urlopen(req, timeout=30).read()
        img = Image.open(io.BytesIO(data)).convert("RGB")
        if img.width < 20:  # Open Library가 표지가 없을 때 주는 1px 이미지
            return "empty"
        img.thumbnail((96, 144))
        img.save(path, "JPEG", quality=72, optimize=True)
        return "ok"
    except Exception as e:  # noqa: BLE001
        return f"fail {e}"

with ThreadPoolExecutor(3) as pool:
    results = list(pool.map(fetch, sorted(urls)))
fails = [r for r in results if r.startswith("fail")]
print(fails[:3])
summary = {}
for r in results:
    k = r.split(" ")[0]
    summary[k] = summary.get(k, 0) + 1
print(f"표지 {len(urls)}개: {summary}")
size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print(f"썸네일 합계 {size/1024/1024:.1f} MB")
