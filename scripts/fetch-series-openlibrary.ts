// Open Library에서 시리즈 낱권 목록(제목·출간 연도·표지)을 받아 data/books.csv에 덧붙인다.
//
//   node scripts/fetch-series-openlibrary.ts            # 미리보기만 (파일 안 바꿈)
//   node scripts/fetch-series-openlibrary.ts --write    # 저장
//   node scripts/fetch-series-openlibrary.ts --write "Magic Tree House"   # 한 시리즈만
//   node scripts/fetch-series-openlibrary.ts --write --only-empty         # 낱권이 없는 시리즈만
//
// Open Library의 시리즈 태그는 빈 곳이 많아서, 시리즈마다 "저자 + 제목 키워드" 규칙으로 찾는다.
// 상자 세트·합본·활동지·번역본 같은 건 걸러낸다. 그래도 섞일 수 있으니 메모에 출처를 남긴다.

import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvRecords, stringifyCsv } from "../src/catalog/csv.ts";
import { BOOK_COLUMNS, slugify } from "../src/catalog/sheet.ts";

interface Rule {
  author: string;
  /** 제목에 이 중 하나가 들어가야 시리즈 책으로 본다. 비우면 그 저자의 영어 책 전부 */
  keywords?: string[];
  /** 제목에 들어가면 빼는 말 (같은 저자의 다른 시리즈 등) */
  exclude?: string[];
}

// 시리즈 시트의 시리즈명 → 찾는 규칙. 여기 없는 시리즈는 건너뛴다.
// (작가 모음, 단계별 리더스, 그리고 제목에 시리즈 이름이 없고 작가가 다른 책도 많이 쓴
//  Magic Tree House·A to Z Mysteries·Goosebumps·Warriors·Wings of Fire는 섞임이 심해서 제외)
const RULES: Record<string, Rule> = {
  "Elephant & Piggie": { author: "Mo Willems", keywords: ["elephant", "piggie", "gerald"], exclude: ["pigeon", "knuffle", "cat the cat", "squirrel"] },
  "Mo Willems Pigeon": { author: "Mo Willems", keywords: ["pigeon", "duckling"] },
  "Unlimited Squirrels": { author: "Mo Willems", keywords: ["squirrel"] },
  "Fly Guy": { author: "Tedd Arnold", keywords: ["fly guy"], exclude: ["presents"] },
  "Fly Guy Presents": { author: "Tedd Arnold", keywords: ["fly guy presents"] },
  Biscuit: { author: "Alyssa Satin Capucilli", keywords: ["biscuit"] },
  "Henry and Mudge": { author: "Cynthia Rylant", keywords: ["henry and mudge"] },
  "Mr. Putter & Tabby": { author: "Cynthia Rylant", keywords: ["putter"] },
  Poppleton: { author: "Cynthia Rylant", keywords: ["poppleton"] },
  "Amelia Bedelia I Can Read": { author: "Peggy Parish", keywords: ["amelia bedelia"] },
  "Fancy Nancy I Can Read": { author: "Jane O'Connor", keywords: ["fancy nancy"] },
  "Pinkalicious I Can Read": { author: "Victoria Kann", keywords: ["pinkalicious"] },
  "Splat the Cat I Can Read": { author: "Rob Scotton", keywords: ["splat"] },
  "Pete the Cat I Can Read": { author: "James Dean", keywords: ["pete the cat"] },
  "Curious George": { author: "H. A. Rey", keywords: ["curious george"] },
  "Llama Llama": { author: "Anna Dewdney", keywords: ["llama"] },
  Froggy: { author: "Jonathan London", keywords: ["froggy"] },
  Maisy: { author: "Lucy Cousins", keywords: ["maisy"] },
  "Little Bear": { author: "Else Holmelund Minarik", keywords: ["bear"] },
  "Danny and the Dinosaur": { author: "Syd Hoff", keywords: ["danny and the dinosaur"] },
  "Frog and Toad": { author: "Arnold Lobel", keywords: ["frog and toad"] },
  "Nate the Great": { author: "Marjorie Weinman Sharmat", keywords: ["nate the great"] },
  "Young Cam Jansen": { author: "David A. Adler", keywords: ["young cam jansen"] },
  "Cam Jansen": { author: "David A. Adler", keywords: ["cam jansen"], exclude: ["young cam"] },
  "Junie B. Jones": { author: "Barbara Park", keywords: ["junie b"] },
  "Mercy Watson": { author: "Kate DiCamillo", keywords: ["mercy watson"] },
  "The Princess in Black": { author: "Shannon Hale", keywords: ["princess in black"] },
  "Dog Man": { author: "Dav Pilkey", keywords: ["dog man"] },
  "Captain Underpants": { author: "Dav Pilkey", keywords: ["captain underpants"] },
  "Ricky Ricotta's Mighty Robot": { author: "Dav Pilkey", keywords: ["ricky ricotta"] },
  "Cat Kid Comic Club": { author: "Dav Pilkey", keywords: ["cat kid comic club"] },
  "Narwhal and Jelly": { author: "Ben Clanton", keywords: ["narwhal", "jelly"] },
  "The Bad Guys": { author: "Aaron Blabey", keywords: ["bad guys"] },
  "Owl Diaries": { author: "Rebecca Elliott", keywords: ["eva", "owl diaries"] },
  "Unicorn Diaries": { author: "Rebecca Elliott", keywords: ["bo ", "unicorn diaries"] },
  "Dragon Masters": { author: "Tracey West", keywords: ["dragon"] },
  "Horrid Henry": { author: "Francesca Simon", keywords: ["horrid henry"] },
  "Judy Moody": { author: "Megan McDonald", keywords: ["judy moody"] },
  Stink: { author: "Megan McDonald", keywords: ["stink"] },
  "Ivy + Bean": { author: "Annie Barrows", keywords: ["ivy", "bean"] },
  "Big Nate": { author: "Lincoln Peirce", keywords: ["big nate"] },
  "Calendar Mysteries": { author: "Ron Roy", keywords: ["january", "february", "march", "april", "may magic", "june", "july", "august", "september", "october", "november", "december", "new year"] },
  "Boxcar Children": { author: "Gertrude Chandler Warner", keywords: [] },
  "Geronimo Stilton": { author: "Geronimo Stilton", keywords: [] },
  "Thea Stilton": { author: "Thea Stilton", keywords: [] },
  "Rainbow Magic": { author: "Daisy Meadows", keywords: ["fairy"] },
  "Flat Stanley": { author: "Jeff Brown", keywords: ["stanley"] },
  Clementine: { author: "Sara Pennypacker", keywords: ["clementine"] },
  "Franny K. Stein": { author: "Jim Benton", keywords: ["fran"] },
  "Encyclopedia Brown": { author: "Donald J. Sobol", keywords: ["encyclopedia brown"] },
  "Bad Kitty": { author: "Nick Bruel", keywords: ["bad kitty"] },
  "The Treehouse Books": { author: "Andy Griffiths", keywords: ["treehouse"] },
  "Wayside School": { author: "Louis Sachar", keywords: ["wayside"] },
  "Marvin Redpost": { author: "Louis Sachar", keywords: ["marvin redpost"] },
  Ramona: { author: "Beverly Cleary", keywords: ["ramona", "beezus"] },
  Fudge: { author: "Judy Blume", keywords: ["fudge", "fourth grade nothing", "sheila"] },
  "I Survived": { author: "Lauren Tarshis", keywords: ["i survived"] },
  "Percy Jackson and the Olympians": { author: "Rick Riordan", keywords: ["lightning thief", "sea of monsters", "titan's curse", "labyrinth", "last olympian"] },
  "Harry Potter": { author: "J. K. Rowling", keywords: ["harry potter"] },
  "The Chronicles of Narnia": { author: "C. S. Lewis", keywords: ["lion, the witch", "prince caspian", "dawn treader", "silver chair", "horse and his boy", "magician's nephew", "last battle"] },
  "Diary of a Wimpy Kid": { author: "Jeff Kinney", keywords: [] },
  "Dork Diaries": { author: "Rachel Renée Russell", keywords: [] },
  "The Last Kids on Earth": { author: "Max Brallier", keywords: ["last kids on earth"] },
  "The Spiderwick Chronicles": { author: "Tony DiTerlizzi", keywords: ["field guide", "seeing stone", "lucinda", "ironwood", "mulgarath"] },
  "Hilo": { author: "Judd Winick", keywords: ["hilo"] },
  "InvestiGators": { author: "John Patrick Green", keywords: ["investigators"] },
  "Lunch Lady": { author: "Jarrett J. Krosoczka", keywords: ["lunch lady"] },
  // 2026-10: 낱권이 하나도 없던 시리즈들
  "Anthony Browne 그림책": { author: "Anthony Browne", keywords: [], exclude: ["lib ed", "willy y hugo", "picturemacs", "alice's adventures", "through the magic"] },
  "Little Critter": { author: "Mercer Mayer", keywords: ["little critter", "just "], exclude: ["i can read"] },
  "Pete the Cat 그림책": { author: "James Dean", keywords: ["white shoes", "school shoes", "groovy buttons", "magic sunglasses", "saves christmas", "wheels on the bus", "twelve groovy days", "big easter adventure", "valentine's day is cool", "first day of school", "trick or pete", "crayons rock", "construction destruction", "pete the cat's", "the great leprechaun chase"] },
  "Bob Books": { author: "Bobby Lynn Maslen", keywords: [], exclude: ["bob books for", "bob books first", "bob bks", "more bob books", "bob books plus", "cut-ups"] },
  Mittens: { author: "Lola M. Schaefer", keywords: ["mittens"] },
  "Clifford Phonics & Readers": { author: "Norman Bridwell", keywords: ["clifford"] },
  "Berenstain Bears I Can Read": { author: "Stan Berenstain", keywords: ["berenstain"], exclude: ["baby book", "b book"] },
  "Ling & Ting": { author: "Grace Lin", keywords: ["ling & ting", "ling and ting"] },
  "The Baby-Sitters Club Graphix": { author: "Ann M. Martin", keywords: ["kristy's great idea", "truth about stacey", "mary anne saves the day", "claudia and mean janine", "dawn and the impossible three", "kristy's big day", "boy-crazy stacey", "logan likes mary anne", "claudia and the new girl", "kristy and the snobs", "good-bye stacey", "jessi's secret language", "claudia and the bad joke"] },
  "Ready, Freddy!": { author: "Abby Klein", keywords: [], exclude: ["caterpillars on the move"] },
  "Notebook of Doom": { author: "Troy Cummings", keywords: [], exclude: ["can i be your dog", "little red gliding hood", "giddy-up", "binky", "flyaway katie", "more-igami", "hide and seek", "eat your science", "eensy weensy", "branches book"] },
  "Eerie Elementary": { author: "Jack Chabert", keywords: [], exclude: ["branches book", "recreo"] },
  "Kung Pow Chicken": { author: "Cyndi Marko", keywords: [] },
  "Black Lagoon Adventures": { author: "Mike Thaler", keywords: ["black lagoon"] },
  "Horrible Harry": { author: "Suzy Kline", keywords: ["horrible harry"] },
  "Arthur Chapter Books": { author: "Marc Brown", keywords: ["mystery envelope", "scare-your-pants-off", "makes the team", "crunch cereal", "arthur accused", "locked in the library", "dino dilemma", "stolen bike", "lost diary", "in love with arthur", "rocks with binky", "francine, believe", "cootie-catcher", "buster makes the grade", "muffy's secret admirer", "popularity test", "big, bad teacher", "cat saver", "double dare", "big blow-up", "no-go rule", "recess rookie", "poetry contest", "comet crisis", "seventh arthur", "big snow", "perfect brother", "goalie ghost", "pen pal playoff", "bad-luck brain"] },
  "Heidi Heckelbeck": { author: "Wanda Coven", keywords: ["heidi heckelbeck"] },
  "Nancy Drew Clue Book": { author: "Carolyn Keene", keywords: ["pool party puzzler", "last lemonade standing", "a star witness", "big top flop", "movie madness", "pets on parade", "candy kingdom chaos", "world record mystery", "springtime crime", "boo crew", "the tortoise and the scare", "turkey trouble", "puppy love prank", "the big island burglary"] },
  "Kingdom of Wrenly": { author: "Jordan Quinn", keywords: [], exclude: ["books in 1", "poppin"] },
  "Jigsaw Jones": { author: "James Preller", keywords: ["jigsaw", "case of the"] },
  "The Zack Files": { author: "Dan Greenburg", keywords: ["litter box", "medicine cabinet", "ghost named wanda", "mind reader", "orthodontist", "out of my body", "cat who wears earrings", "time traveler", "volcano goddess", "bozo the clone", "bad to verse", "turnip", "greenish eggs", "league slugger", "unnatural history", "my mummy", "misfortune cookie", "your butt will grow", "grandma's a teenager", "just add water", "left at venus", "queen tut", "speak dolphin", "now you see me", "join the nerd", "space cadet", "how to scare the pants", "the zack files"] },
  "Dinosaur Cove": { author: "Rex Stone", keywords: [] },
  "Capital Mysteries": { author: "Ron Roy", keywords: ["cloned the president", "kidnapped at the capital", "smithsonian", "spy in the white house", "lincoln's thumb", "fbi", "treasury", "washington monument", "national zoo", "election-day", "jefferson's mansion", "camp david", "d.c. train", "national mall"] },
  "The Magic School Bus Chapter Books": { author: "Joanna Cole", keywords: ["magic school bus"], exclude: ["lesson plan", "riding the magic school bus"] },
  "Secrets of Droon": { author: "Tony Abbott", keywords: ["droon", "hidden stairs", "mysterious island", "city in the clouds", "great ice battle", "sleeping giant of goll", "golden wasp", "tower of the elf king", "quest for the queen", "hawk bandits of tarkoom", "under the serpent sea", "mask of maliban", "voyage of the jaffa wind", "moon scroll", "knights of silversnow", "dream thief", "search for the dragon ship", "coiled viper", "in the ice caves of krog", "flight of the genie", "crown of wizards"] },
  "Magic Tree House Merlin Missions": { author: "Mary Pope Osborne", keywords: ["christmas in camelot", "haunted castle on hallows eve", "summer of the sea serpent", "winter of the ice wizard", "carnival at candlelight", "season of the sandstorms", "night of the new magicians", "blizzard of the blue moon", "dragon of the red dawn", "monday with a mad genius", "dark day in the deep sea", "eve of the emperor penguin", "moonlight on the magic flute", "a good night for ghosts", "leprechaun in late winter", "a ghost tale for christmas time", "a crazy day with cobras", "dogs in the dead of night", "abe lincoln at last", "a perfect time for pandas", "stallion by starlight", "hurry up, houdini", "high time for heroes", "soccer on sunday", "shadow of the shark", "balto of the blue dawn", "night of the ninth dragon"] },
};

// 상자 세트·합본·부록·번역본처럼 시리즈 낱권이 아닌 것
const JUNK = /box(ed)? set|boxset|collection|collector|omnibus|books? \d|#\s?\d|volumes?\s\d|complete|\/|\d+-book|\bset\b|bind-?up|treasury|activity|sticker|colou?ring|journal|cookbook|calendar 20|guide|handbook|poster|postcard|audio|cd\b|[À-ɏ]{2,}|spanish|edición|español|display|cut ?out|sparknotes|board book|graphic novel|movie|party pack|do-it-yourself|diary$|book and doll|\(series\)|series$|big book|library|one-act|novel by|play script|summary|study|workbook|3-d|pop-up|lift-the-flap|puzzle|craft|game|ultimate|official|annual|deluxe|illustrated edition|special edition|anniversary|\bvol\b|vol\.|part \d|painting|pos pack|transforming|funfax|box of|backlst|stckp|cutting up|and friends$|wimpy kid$|notebook|scrapbook|quiz|trivia|joke|fact file|cards?$|paper dolls?|mini |little golden|graphic|pack\b|clip strip|books in a|edition|magical year|walls of|true stories|bestest|[;\[\]]|\.\.\.|calendar|\bbox\b|package|cassette|keepsake|mysteries$|\bvols?\b|\bx \d|s\'wrap|\btbp\b|header|badges?|plush|\bdoll\b|calandar|puppet|magnet|event kit|friendship kit|\bkit$|flash ?cards?|\bdvd\b|video|\bluch\b|\bagus\b|se viste|standee|display|prepack|bookmark/i;
// 영어가 아닌 판 (아프리칸스어·스페인어·프랑스어·독일어 등에서 자주 나오는 말)
const FOREIGN = /\b(en die|die|van|het|de la|del|el|los|las|le|les|du|des|der|und|och|och|och)\b/i;
// 로마자로 쓴 중국어 판 같은 것
const PINYIN = /\b(de|zhi|yu|jie|qing|bian|diao|xiao|shi|wo|ni)\b.*\b(de|zhi|yu|jie|qing|bian|diao|xiao|shi|wo|ni)\b/i;

/** 비교용 키: 괄호·앞쪽 시리즈 이름·문장부호를 떼고 */
function titleKey(title: string, series: string): string {
  // 괄호, 끝에 붙은 연도("…, 1912", "AD 79")는 같은 책의 다른 표기로 본다
  let t = title.replace(/\(.*$/g, " ").replace(/,?\s*(\d{4}|ad \d+)\s*$/i, "");
  const sk = series.toLowerCase().replace(/ i can read$/, "");
  if (t.toLowerCase().startsWith(sk)) t = t.slice(sk.length);
  return norm(t) || norm(title.replace(/\(.*?\)/g, " "));
}

const norm = (t: string) => t.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");

interface Doc { title: string; author_name?: string[]; first_publish_year?: number; cover_i?: number; language?: string[] }

/** 이름 글자만 비교 ("J. K. Rowling" = "J.K. Rowling") */
function sameAuthor(a: string, b: string): boolean {
  const k = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");
  return k(a) === k(b);
}

async function search(author: string): Promise<Doc[]> {
  const out: Doc[] = [];
  for (let page = 1; page <= 3; page++) {
    const url = new URL("https://openlibrary.org/search.json");
    url.searchParams.set("author", author);
    url.searchParams.set("language", "eng");
    url.searchParams.set("fields", "title,author_name,first_publish_year,cover_i,language");
    url.searchParams.set("limit", "200");
    url.searchParams.set("page", String(page));
    const res = await fetch(url, { headers: { "User-Agent": "secret-book-club-catalog/1.0" } });
    if (!res.ok) throw new Error(`Open Library ${res.status}`);
    const body = (await res.json()) as { docs: Doc[] };
    // 줄바꿈·여러 칸 띄어쓰기가 섞인 제목이 있어 정리
    out.push(...body.docs.map((d) => ({ ...d, title: d.title.replace(/\s+/g, " ").trim() })));
    if (body.docs.length < 200) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return out;
}

const write = process.argv.includes("--write");
const only = process.argv.slice(2).find((a) => !a.startsWith("--"));

const dir = new URL("../data/", import.meta.url);
const books = parseCsvRecords(readFileSync(new URL("books.csv", dir), "utf8"));
const seriesRows = parseCsvRecords(readFileSync(new URL("series.csv", dir), "utf8"));
const columns = [...BOOK_COLUMNS, "표지"];
// 기존 책과 비교할 때도 괄호·시리즈 이름을 뗀 키로 (예: "Pete the Cat: Sir Pete the Brave" = "Pete the Cat. Sir Pete the Brave")
const byTitle = new Map<string, Record<string, string>>();
for (const r of books) {
  byTitle.set(norm(r["제목"]), r);
  byTitle.set(titleKey(r["제목"], r["시리즈"] || ""), r);
}
const ids = new Set(books.map((r) => r["id"]));
// --only-empty: 낱권이 한 권도 없는 시리즈만 (이미 채운 시리즈는 다시 건드리지 않는다)
const onlyEmpty = process.argv.includes("--only-empty");
const filled = new Set(books.map((r) => r["시리즈"]).filter(Boolean));

const detail: string[] = [];
let totalAdded = 0;
let coversAdded = 0;
for (const s of seriesRows) {
  const name = s["시리즈명"];
  const rule = RULES[name];
  if (!rule || (only && only !== name) || (onlyEmpty && filled.has(name))) continue;
  const max = Math.max(Number(s["권수"]) || 0, 10) + 5;

  const seen = new Set<string>();
  const docs = (await search(rule.author))
    // 저자 이름 전체가 맞고, 여러 작가 합본(앤솔러지)이 아닌 것
    .filter((d) => (d.author_name ?? []).length <= 2 && (d.author_name ?? []).some((a) => sameAuthor(a, rule.author)))
    .filter((d) => !JUNK.test(d.title) && !PINYIN.test(d.title) && !FOREIGN.test(d.title) && norm(d.title) !== norm(name))
    .filter((d) => {
      const t = d.title.toLowerCase();
      if (rule.exclude?.some((x) => t.includes(x))) return false;
      return !rule.keywords?.length || rule.keywords.some((k) => t.includes(k));
    })
    .sort((a, b) => (a.first_publish_year ?? 9999) - (b.first_publish_year ?? 9999))
    .filter((d) => {
      const k = titleKey(d.title, name);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);

  let added = 0;
  for (const d of docs) {
    const cover = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "";
    const existing = byTitle.get(norm(d.title)) ?? byTitle.get(titleKey(d.title, name));
    if (existing) {
      if (!existing["시리즈"]) existing["시리즈"] = name;
      if (!existing["표지"] && cover) {
        existing["표지"] = cover;
        coversAdded++;
      }
      continue;
    }
    let id = slugify(d.title);
    if (ids.has(id)) id = `${slugify(name)}-${id}`;
    if (ids.has(id)) continue;
    ids.add(id);
    const row: Record<string, string> = Object.fromEntries(columns.map((c) => [c, ""]));
    Object.assign(row, {
      id, 제목: d.title, 저자: s["저자"], 시리즈: name, 지수확인: "N", 표지: cover,
      메모: `Open Library 자동 수집·확인 필요${d.first_publish_year ? ` (${d.first_publish_year})` : ""}`,
    });
    books.push(row);
    byTitle.set(norm(d.title), row);
    byTitle.set(titleKey(d.title, name), row);
    added++;
  }
  totalAdded += added;
  detail.push(`## ${name} (${docs.length})`, ...docs.map((d) => `- ${d.first_publish_year ?? "?"} ${d.title}`));
  console.log(`${name}: 찾음 ${docs.length}, 새로 ${added}  예) ${docs.slice(0, 3).map((d) => d.title).join(" / ")}`);
  await new Promise((r) => setTimeout(r, 700));
}

if (process.env.DETAIL) writeFileSync(process.env.DETAIL, detail.join("\n") + "\n");
console.log(`합계: 새 낱권 ${totalAdded}권, 기존 책 표지 ${coversAdded}개`);
if (write) {
  writeFileSync(new URL("books.csv", dir), stringifyCsv(columns, books));
  console.log("data/books.csv 저장");
} else {
  console.log("미리보기예요. 저장하려면 --write");
}
