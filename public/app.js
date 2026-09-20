// K-RITUAL · 연애 상담 캐릭터챗
// 대화는 "스크롤하면 한 컷씩 풀리는" 웹툰식으로 진행된다.

import { CHARACTERS, getCharacter } from './data/characters.js';
import {
  STAGES, CONCERNS, CONTACT_LEVELS, MBTI, CHAPTERS, ADVICE,
  REACTIONS, FOLLOWUPS, KEYWORDS,
} from './data/scenarios.js';
import {
  readSaju, buildReport, checkAI, aiAvailable, askAI, voiced,
  ELEMENT_INFO, makeRng, hashSeed,
} from './engine.js';

const STORE_KEY = 'kritual:v1';
const $app = document.getElementById('app');
const $dock = document.getElementById('dock');

/* ------------------------------------------------------------------ *
 * 상태
 * ------------------------------------------------------------------ */
const blankProfile = () => ({
  nickname: '', birth: '', birthTime: '', gender: '', mbti: '모름',
  stage: '', partnerName: '', partnerBirth: '', partnerMbti: '모름',
  duration: '', contact: '', contactLabel: '', concerns: [], situation: '',
});

const state = {
  screen: 'home',
  step: 0,
  profile: blankProfile(),
  charId: null,
  chapterIdx: 0,
  answers: [],
  history: [],
  report: null,
  freeMode: false,
  busy: false,
  used: new Set(),
};

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { profile: null, reports: [] }; }
  catch { return { profile: null, reports: [] }; }
}

function saveStore(patch) {
  const next = { ...loadStore(), ...patch };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* 시크릿 모드 등 */ }
  return next;
}

/* ------------------------------------------------------------------ *
 * 유틸
 * ------------------------------------------------------------------ */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 캐릭터 일러스트. 파일이 없으면 캐릭터 색 그라디언트로 조용히 폴백한다.
function artTag(char, cls = '') {
  return `<img class="${cls}" src="${char.image}" alt="${esc(char.name)}"
    onerror="this.style.display='none';this.parentElement.classList.add('no-art')" />`;
}

function applyPalette(char) {
  const r = document.documentElement.style;
  r.setProperty('--accent', char ? char.palette.primary : '#ff6f91');
  r.setProperty('--accent-soft', char ? char.palette.soft : '#ffe3ea');
  r.setProperty('--accent-deep', char ? char.palette.deep : '#3a1526');
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function go(screen) {
  state.screen = screen;
  window.scrollTo(0, 0);
  render();
}

function freshLine(pool, rng) {
  const unused = pool.filter((l) => l && !state.used.has(l));
  const list = unused.length ? unused : pool.filter(Boolean);
  if (!list.length) return '';
  const line = list[Math.floor(rng() * list.length) % list.length];
  state.used.add(line);
  return line;
}

function guessConcern(text, fallback) {
  for (const [id, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => text.includes(w))) return id;
  }
  return fallback || 'signal';
}

/* ------------------------------------------------------------------ *
 * 렌더 진입점
 * ------------------------------------------------------------------ */
function render() {
  applyPalette(state.charId ? getCharacter(state.charId) : null);
  ({
    home: renderHome,
    onboard: renderOnboard,
    chat: renderChat,
    report: renderReport,
    history: renderHistory,
  }[state.screen] || renderHome)();
}

function topbar(opts = {}) {
  return `<div class="topbar">
    ${opts.back ? '<button class="icon-btn" data-act="back">←</button>' : ''}
    <div class="brand">K RITUAL<span>.</span></div>
    <div class="spacer"></div>
    ${opts.right ?? '<button class="icon-btn" data-act="history" title="지난 상담">🗂</button>'}
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 홈
 * ------------------------------------------------------------------ */
function renderHome() {
  const store = loadStore();
  const reports = store.reports || [];

  $app.innerHTML = `
    ${topbar()}
    <div class="home-hero">
      <div class="kicker">밤  열 두 시 의 상 담 소</div>
      <h1>연애, 혼자<br /><em>해석하지마</em>.</h1>
      <p class="sub">네 얘기를 끝까지 듣는 상담사 네 명.<br />스크롤할수록 대화가 한 컷씩 이어져.</p>
    </div>

    <div class="deck" id="deck">
      ${CHARACTERS.map((c, i) => `
        <div class="deck-card" data-act="pick-home" data-val="${c.id}"
             style="--card-accent:${c.palette.primary};--card-deep:${c.palette.deep}">
          ${artTag(c)}
          <div class="scrim"></div>
          <div class="idx">${i + 1} / ${CHARACTERS.length}</div>
          <div class="meta">
            <div class="k">${esc(c.kicker)}</div>
            <div class="n">${esc(c.name)}</div>
            <div class="t">${esc(c.headline)}</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="dots" id="dots">${CHARACTERS.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>

    <div class="panel" style="margin-top:16px">
      <div class="sec-title">이렇게 진행돼</div>
      <div class="muted">
        나와 그 사람의 정보를 알려주면<br />
        상담사가 네 사주와 상황을 먼저 읽어.<br />
        그 다음엔 스크롤하면서 대화가 이어지고,<br />
        마지막에 <b>이번 주 처방전</b>이 나와.
      </div>
    </div>

    ${reports.length ? `
    <div class="panel">
      <div class="sec-title">지난 처방전</div>
      ${reports.slice(0, 3).map((r, i) => histRow(r, i)).join('')}
    </div>` : ''}
    <div class="bottom-space"></div>
  `;

  $dock.innerHTML = `<div class="dock"><div class="dock-inner">
    <button class="btn" data-act="start">상담 시작하기</button>
  </div></div>`;

  // 캐러셀 인디케이터
  const deck = document.getElementById('deck');
  const dots = document.getElementById('dots');
  deck?.addEventListener('scroll', () => {
    const i = Math.round(deck.scrollLeft / (deck.scrollWidth / CHARACTERS.length));
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
}

function histRow(r, i) {
  const c = getCharacter(r.charId);
  return `<button class="hist-item" data-act="open-report" data-idx="${i}">
    ${artTag(c)}
    <div>
      <div style="font-size:13.5px;font-weight:700">${esc(r.stageLabel)} · ${esc(r.charName)}</div>
      <div class="faint">${new Date(r.createdAt).toLocaleDateString('ko-KR')}</div>
    </div>
    <div class="s">${r.score}</div>
  </button>`;
}

/* ------------------------------------------------------------------ *
 * 온보딩
 * ------------------------------------------------------------------ */
const STEPS = ['나', '관계', '상대', '고민', '상담사'];

function renderOnboard() {
  const p = state.profile;
  const step = state.step;
  const body = [stepMe, stepStage, stepPartner, stepConcern, stepCharacter][step](p);

  $app.innerHTML = `
    ${topbar({ back: true })}
    <div class="progress">${STEPS.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
    <div class="panel">${body}</div>
    <div class="bottom-space"></div>
  `;

  $dock.innerHTML = `<div class="dock"><div class="dock-inner">
    ${step > 0 ? '<button class="btn btn-ghost" style="flex:0 0 92px" data-act="prev">이전</button>' : ''}
    <button class="btn" data-act="next" ${validateStep(step, p) ? '' : 'disabled'}>
      ${step === 4 ? '상담 시작' : '다음'}
    </button>
  </div></div>`;
}

function validateStep(step, p) {
  if (step === 0) return p.nickname.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.birth);
  if (step === 1) return !!p.stage;
  if (step === 3) return p.concerns.length > 0;
  if (step === 4) return !!state.charId;
  return true;
}

function stepMe(p) {
  return `
    <h2 class="step-title">먼저 너부터 알려줘</h2>
    <p class="step-desc">생년월일은 사주(오행) 궁합을 보는 데 써. 이 기기에만 저장돼.</p>
    <div class="field">
      <label>닉네임 <span class="hint">상담사가 부를 이름</span></label>
      <input class="input" data-field="nickname" value="${esc(p.nickname)}" placeholder="예) 밤비" maxlength="12" />
    </div>
    <div class="field">
      <label>생년월일 <span class="hint">필수</span></label>
      <input class="input" type="date" data-field="birth" value="${esc(p.birth)}" min="1940-01-01" max="2012-12-31" />
    </div>
    <div class="row-2">
      <div class="field">
        <label>태어난 시간 <span class="hint">선택</span></label>
        <input class="input" type="time" data-field="birthTime" value="${esc(p.birthTime)}" />
      </div>
      <div class="field">
        <label>내 MBTI <span class="hint">선택</span></label>
        <select class="input" data-field="mbti">
          ${MBTI.map((m) => `<option ${p.mbti === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>`;
}

function stepStage(p) {
  return `
    <h2 class="step-title">지금 어떤 사이야?</h2>
    <p class="step-desc">단계에 따라 상담 스토리가 통째로 달라져.</p>
    <div class="choice-grid">
      ${STAGES.map((s) => `
        <button class="choice ${p.stage === s.id ? 'on' : ''}" data-set="stage" data-val="${s.id}">
          <span class="e">${s.emoji}</span>
          <span class="l">${s.label}</span>
          <span class="d">${s.desc}</span>
        </button>`).join('')}
    </div>`;
}

function stepPartner(p) {
  return `
    <h2 class="step-title">그 사람 얘기</h2>
    <p class="step-desc">아는 것만 채워도 돼. 생년월일이 있으면 궁합이 훨씬 정확해져.</p>
    <div class="field">
      <label>뭐라고 부를까 <span class="hint">선택</span></label>
      <input class="input" data-field="partnerName" value="${esc(p.partnerName)}" placeholder="예) 그 선배" maxlength="12" />
    </div>
    <div class="row-2">
      <div class="field">
        <label>상대 생년월일 <span class="hint">선택</span></label>
        <input class="input" type="date" data-field="partnerBirth" value="${esc(p.partnerBirth)}" min="1940-01-01" max="2012-12-31" />
      </div>
      <div class="field">
        <label>상대 MBTI <span class="hint">선택</span></label>
        <select class="input" data-field="partnerMbti">
          ${MBTI.map((m) => `<option ${p.partnerMbti === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field">
      <label>알고 지낸 기간 <span class="hint">선택</span></label>
      <input class="input" data-field="duration" value="${esc(p.duration)}" placeholder="예) 3개월" maxlength="20" />
    </div>
    <div class="field">
      <label>요즘 연락 빈도</label>
      <div class="pill-wrap">
        ${CONTACT_LEVELS.map((c) => `
          <button class="pill ${p.contact === c.id ? 'on' : ''}" data-set="contact" data-val="${c.id}" data-label="${esc(c.label)}">${c.label}</button>
        `).join('')}
      </div>
    </div>`;
}

function stepConcern(p) {
  return `
    <h2 class="step-title">뭐가 제일 답답해?</h2>
    <p class="step-desc">최대 3개까지. 처방전이 이 기준으로 나와.</p>
    <div class="field">
      <div class="pill-wrap">
        ${CONCERNS.map((c) => `
          <button class="pill ${p.concerns.includes(c.id) ? 'on' : ''}" data-toggle="concern" data-val="${c.id}">${c.emoji} ${c.label}</button>
        `).join('')}
      </div>
    </div>
    <div class="field">
      <label>무슨 일이 있었는지 편하게 써줘 <span class="hint">선택 · 길수록 정확해져</span></label>
      <textarea class="input" data-field="situation" placeholder="예) 두 달째 썸인데 먼저 연락은 항상 저예요. 지난주에 영화 보고 온 뒤로 답장이 느려졌어요.">${esc(p.situation)}</textarea>
    </div>`;
}

function stepCharacter() {
  return `
    <h2 class="step-title">누구한테 상담받을래?</h2>
    <p class="step-desc">같은 상황도 상담사에 따라 완전히 다른 답이 나와.</p>
    ${CHARACTERS.map((c) => `
      <button class="pick ${state.charId === c.id ? 'on' : ''}" data-set="char" data-val="${c.id}"
              style="--pick-accent:${c.palette.primary}">
        ${artTag(c)}
        <div class="scrim"></div>
        <div class="body">
          <div class="k">${esc(c.kicker)}</div>
          <div class="n">${esc(c.name)}<small>${esc(c.title)}</small></div>
          <div class="q">"${esc(c.tagline)}"</div>
        </div>
      </button>`).join('')}`;
}

/* ------------------------------------------------------------------ *
 * 챗 — 웹툰 스크롤
 * ------------------------------------------------------------------ */
// 스크롤 위치 기준 리빌.
// (IntersectionObserver 는 scrollTo 로 훌쩍 건너뛴 컷을 놓칠 수 있어서 직접 계산한다)
let revealTicking = false;

function revealPassed() {
  document.querySelectorAll('.cut:not(.in)').forEach((el) => {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.88) el.classList.add('in');
  });
}

function onScrollReveal() {
  if (revealTicking) return;
  revealTicking = true;
  requestAnimationFrame(() => { revealPassed(); revealTicking = false; });
}

function chapterList() {
  return CHAPTERS[state.profile.stage] || CHAPTERS.talking;
}

function renderChat() {
  const char = getCharacter(state.charId);
  $app.innerHTML = `
    <div class="stage">${artTag(char)}<div class="veil"></div></div>
    ${topbar({ back: true, right: `<span class="tag">${aiAvailable() ? 'AI 상담' : '스토리'}</span>` })}
    <div class="chat-wrap">
      <section class="curtain">
        <div class="portrait">${artTag(char)}</div>
        <div class="who">
          <div class="k">${esc(char.kicker)}</div>
          <div class="n">${esc(char.name)}</div>
          <div class="t">${esc(char.title)} · ${esc(state.profile.nickname)}님의 상담</div>
        </div>
        <div class="scroll-hint">아래로 스크롤 ↓</div>
      </section>
      <div id="reel"></div>
      <div id="prompt-area"></div>
      <div class="bottom-space"></div>
    </div>`;
  $dock.innerHTML = '';

  window.removeEventListener('scroll', onScrollReveal);
  window.addEventListener('scroll', onScrollReveal, { passive: true });
  window.removeEventListener('resize', onScrollReveal);
  window.addEventListener('resize', onScrollReveal, { passive: true });
}

function observe(el) {
  // 이미 화면 안에 들어와 있으면 바로 노출, 아니면 스크롤을 기다린다
  requestAnimationFrame(() => {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.88) el.classList.add('in');
  });
}

function addCut(text, who, mine = false) {
  const reel = document.getElementById('reel');
  if (!reel) return null;
  const el = document.createElement('div');
  el.className = `cut${mine ? ' mine' : ''}`;
  el.innerHTML = `<div class="line" data-who="${esc(who)}">${esc(text)}</div>`;
  reel.appendChild(el);
  observe(el);
  return el;
}

function addNarr(text) {
  const reel = document.getElementById('reel');
  if (!reel) return null;
  const el = document.createElement('div');
  el.className = 'cut narr';
  el.innerHTML = `<div class="txt">${esc(text)}</div>`;
  reel.appendChild(el);
  observe(el);
  return el;
}

function clearPrompt() {
  const el = document.getElementById('prompt-area');
  if (el) el.innerHTML = '';
}

function showThinking(on) {
  const el = document.getElementById('prompt-area');
  if (!el) return;
  el.innerHTML = on ? '<div class="thinking"><i></i><i></i><i></i></div>' : '';
}

function showOptions(choices) {
  const el = document.getElementById('prompt-area');
  el.innerHTML = `<div class="pickers">
    <div class="ask">탭해서 대답하기</div>
    ${choices.map((c, i) => `<button class="opt" data-choice="${i}">${esc(c.label)}</button>`).join('')}
  </div>`;
}

function showWriter(placeholder, free = false) {
  const el = document.getElementById('prompt-area');
  el.innerHTML = `<div class="writer">
    <textarea id="free-text" placeholder="${esc(placeholder || '편하게 적어줘')}"></textarea>
    <button class="btn send" data-act="send" data-free="${free ? 1 : 0}">보내기</button>
  </div>`;
}

function showFinish() {
  const el = document.getElementById('prompt-area');
  el.innerHTML = `<div class="pickers">
    <button class="opt" data-act="to-report" style="text-align:center;font-weight:700">📜 이번 주 처방전 받기</button>
  </div>`;
}

// 새 컷이 시작되는 지점으로 부드럽게 이동 (나머지는 사용자가 스크롤하며 본다)
function driftTo(el) {
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.55;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

async function startChat() {
  const char = getCharacter(state.charId);
  const p = state.profile;
  const meSaju = readSaju(p.birth);
  const partner = readSaju(p.partnerBirth);
  const rng = makeRng(hashSeed(p.nickname + char.id));

  state.history = [];
  state.answers = [];
  state.chapterIdx = 0;
  state.freeMode = false;
  state.used = new Set();
  renderChat();

  addNarr(`${p.nickname}는 자리에 앉았다.`);
  say(char.openers[Math.floor(rng() * char.openers.length)]);

  if (meSaju) {
    const el = ELEMENT_INFO[meSaju.dayElement];
    say({
      mio: `${p.nickname}, 너는 ${meSaju.label}. 일간의 기운은 ${meSaju.dayElement}${el ? ` ${el.emoji}` : ''}이야. ${el ? el.love : ''}.`,
      hari: `${meSaju.zodiac}띠구나. ${meSaju.dayElement} 기운 센 사람들 특징 알지? ${el ? el.keyword : ''}. 너도 그래.`,
      doyun: `${meSaju.label}이네요. ${meSaju.dayElement}의 기운이라 ${el ? el.love : ''}. 그래서 더 지쳤을 거예요.`,
      jay: `${meSaju.zodiac}띠, ${meSaju.dayElement} 기운. 참고만 할게. 중요한 건 실제 데이터니까.`,
    }[char.id]);
  }
  if (partner) {
    say(`${p.partnerName || '그 사람'}은 ${partner.label}, ${partner.dayElement}의 기운이야. 기억해 둘게.`);
  }
  if (p.situation) {
    say({
      hari: '상황 다 읽었어. 솔직히 말할 테니까 각오해.',
      doyun: '써준 글 잘 읽었어요. 혼자 오래 삼켰겠네요.',
      mio: '네가 남긴 이야기를 읽었어. 결이 흔들리고 있구나.',
      jay: '상황 파악 완료. 팩트부터 하나씩 확인하자.',
    }[char.id]);
  }

  nextChapter();
}

function say(text) {
  if (!text) return null;
  const char = getCharacter(state.charId);
  state.history.push({ role: 'assistant', content: text });
  return addCut(text, char.name);
}

function mine(text) {
  state.history.push({ role: 'user', content: text });
  return addCut(text, '나', true);
}

function nextChapter() {
  const ch = chapterList()[state.chapterIdx];
  if (!ch) return finishChat();
  say(voiced(getCharacter(state.charId), ch.ask, state.profile));
  if (ch.free) showWriter(ch.placeholder);
  else showOptions(ch.choices);
}

async function react(answer, ch) {
  const char = getCharacter(state.charId);
  const p = state.profile;

  if (aiAvailable()) {
    showThinking(true);
    const ai = await askAI(char, p, state.history.slice(0, -1), answer.text || answer.label, state.report);
    showThinking(false);
    if (ai) { say(ai); return; }
  }

  const rng = makeRng(hashSeed((answer.text || answer.label || '') + char.id + state.chapterIdx));
  const base = p.concerns[state.chapterIdx % Math.max(1, p.concerns.length)] || 'signal';
  const concern = answer.text ? guessConcern(answer.text, base) : base;

  const openers = {
    hari: ['그래. 그건 인정.', '음, 예상했어.', '솔직히 그럴 줄 알았어.', '자, 정리해보자.'],
    doyun: ['그랬구나.', '말해줘서 고마워요.', '많이 고민했겠네요.', '충분히 그럴 수 있어요.'],
    mio: ['…보인다.', '흐름이 그렇게 흐르고 있었구나.', '역시.', '기운이 한쪽으로 기울어 있어.'],
    jay: ['오케이, 기록했어.', '패턴 하나 보인다.', '이건 꽤 흔한 케이스야.', '자, 해석해볼게.'],
  }[char.id];

  const line1 = freshLine(openers, rng) || openers[0];
  const line2 = answer.note ? `${answer.note}.` : freshLine(REACTIONS[concern] || REACTIONS.signal, rng);
  say([line1, line2].filter(Boolean).join(' '));

  if (ch.free && answer.text) {
    const quote = answer.text.slice(0, 28) + (answer.text.length > 28 ? '…' : '');
    say(voiced(char, `"${quote}" — 이 문장, 네가 진짜 하고 싶은 말이지.`, p));
  } else {
    const move = freshLine(REACTIONS[concern] || REACTIONS.signal, rng);
    if (move) say(voiced(char, move, p));
  }
}

async function submitAnswer(answer) {
  if (state.busy) return;
  state.busy = true;
  const ch = chapterList()[state.chapterIdx];
  clearPrompt();
  const myCut = mine(answer.text || answer.label);
  driftTo(myCut);
  state.answers.push({ ...answer, chapter: ch.id, free: !!ch.free });
  await sleep(260);
  await react(answer, ch);
  state.chapterIdx += 1;
  state.busy = false;
  nextChapter();
}

function finishChat() {
  const char = getCharacter(state.charId);
  say({
    hari: '자, 여기까지 듣고 나니까 답 나왔어. 처방전 써줄게.',
    doyun: '이제 정리해볼게요. 오늘 한 얘기 다 담았어요.',
    mio: '흐름을 다 읽었어. 네 처방을 적어줄게.',
    jay: '데이터 충분해. 결론 정리해서 보여줄게.',
  }[char.id]);
  showFinish();
}

async function freeAsk(text) {
  if (state.busy) return;
  state.busy = true;
  clearPrompt();
  driftTo(mine(text));
  const char = getCharacter(state.charId);

  if (aiAvailable()) {
    showThinking(true);
    const ai = await askAI(char, state.profile, state.history.slice(0, -1), text, state.report);
    showThinking(false);
    say(ai || '지금은 말이 잘 안 나오네. 다시 한번 물어봐 줄래?');
  } else {
    const rng = makeRng(hashSeed(text + char.id + state.history.length));
    const concern = guessConcern(text, state.profile.concerns[0]);
    const hint = ADVICE[concern];
    say(freshLine([...(REACTIONS[concern] || REACTIONS.signal), hint.read], rng));
    say(voiced(char, freshLine([hint.move, ...(FOLLOWUPS[state.profile.stage] || [])], rng), state.profile));
  }
  state.busy = false;
  showWriter('더 물어보고 싶은 거 있어?', true);
}

/* ------------------------------------------------------------------ *
 * 처방전
 * ------------------------------------------------------------------ */
function renderReport() {
  const r = state.report;
  const char = getCharacter(state.charId);
  const p = state.profile;
  const meEl = r.me ? ELEMENT_INFO[r.me.dayElement] : null;
  const paEl = r.partner ? ELEMENT_INFO[r.partner.dayElement] : null;
  const circ = 2 * Math.PI * 62;
  const dash = (r.compat.score / 100) * circ;

  $app.innerHTML = `
    ${topbar({ back: true })}
    <div class="report-hero">
      <div class="bg"></div>
      <div class="kicker">${esc(char.name)} 의 처 방 전</div>
      <h2>${esc(p.nickname)}의 연애 진단</h2>
      <div class="faint">${esc(r.stage.label)} · ${new Date(r.createdAt).toLocaleDateString('ko-KR')}</div>
      <div class="score-ring">
        <svg width="148" height="148">
          <circle cx="74" cy="74" r="62" stroke="rgba(255,255,255,0.09)" stroke-width="10" fill="none"/>
          <circle cx="74" cy="74" r="62" stroke="url(#ring)" stroke-width="10" fill="none"
                  stroke-linecap="round" stroke-dasharray="${dash} ${circ}"/>
          <defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${char.palette.primary}"/><stop offset="100%" stop-color="#ffb36b"/>
          </linearGradient></defs>
        </svg>
        <div class="val"><div class="num">${r.compat.score}</div><div class="unit">궁 합</div></div>
      </div>
      <div class="tag" style="border-color:${char.palette.primary};color:var(--ink)">${r.compat.grade.emoji} ${esc(r.compat.grade.label)}</div>
    </div>

    <div class="panel">
      <div class="sec-title">기운으로 보는 두 사람</div>
      <div class="elem-row">
        <div class="elem">
          <div class="e">${meEl ? meEl.emoji : '❔'}</div>
          <div class="k2">${r.me ? r.me.dayElement : '?'}</div>
          <div class="w">${esc(p.nickname)}${meEl ? ` · ${meEl.keyword}` : ''}</div>
        </div>
        <div class="elem-vs">VS</div>
        <div class="elem">
          <div class="e">${paEl ? paEl.emoji : '❔'}</div>
          <div class="k2">${r.partner ? r.partner.dayElement : '?'}</div>
          <div class="w">${esc(p.partnerName || '그 사람')}${paEl ? ` · ${paEl.keyword}` : ''}</div>
        </div>
      </div>
      <div class="note-list">${r.compat.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</div>
    </div>

    <div class="panel">
      <div class="sec-title">네 연애 성향</div>
      <div style="display:flex;gap:13px;align-items:center">
        <div style="font-size:32px">${r.tone.type.emoji}</div>
        <div>
          <div style="font-family:var(--font-display);font-size:21px">${esc(r.tone.type.label)}</div>
          <div class="muted" style="margin-top:5px">${esc(r.tone.type.desc)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px">
        <div class="read-card" style="margin:0"><div class="h">지켜야 할 것</div><div class="r">${esc(r.tone.type.keep)}</div></div>
        <div class="read-card" style="margin:0"><div class="h">조심할 것</div><div class="r">${esc(r.tone.type.watch)}</div></div>
      </div>
    </div>

    <div class="panel">
      <div class="sec-title">지금 흐름 읽기</div>
      ${r.reads.map((x) => `
        <div class="read-card">
          <div class="h">${x.emoji} ${esc(x.label)}</div>
          <div class="r">${esc(x.read)}</div>
          <div class="m">💡 ${esc(x.move)}</div>
        </div>`).join('')}
    </div>

    <div class="panel">
      <div class="sec-title">이번 주 미션</div>
      ${r.missions.map((m, i) => `<div class="mission"><div class="no">${i + 1}</div><div class="txt">${esc(m)}</div></div>`).join('')}
    </div>

    <div class="panel">
      <div class="sec-title">절대 하지 말 것</div>
      ${r.donts.map((d) => `<div class="dont">🚫 ${esc(d)}</div>`).join('')}
    </div>

    <div class="panel">
      <div class="sec-title">이번 주 기류</div>
      <div class="week">
        ${r.week.map((w) => `
          <div class="d ${w.hot ? 'hot' : ''}">
            <div class="bar" style="height:${16 + w.level * 13}px"></div>
            <div class="lb">${w.day}</div>
          </div>`).join('')}
      </div>
      <div class="faint" style="margin-top:10px">${esc(r.week.find((w) => w.hot)?.day || '토')}요일에 기운이 가장 세. 중요한 얘긴 그날에.</div>
    </div>

    <div class="panel charm">
      <div class="t">오 늘 의 부 적</div>
      <div class="p">"${esc(r.charm)}"</div>
    </div>
    <div class="bottom-space"></div>
  `;

  $dock.innerHTML = `<div class="dock"><div class="dock-inner">
    <button class="btn btn-ghost" data-act="back-chat">더 물어보기</button>
    <button class="btn" data-act="copy">요약 복사</button>
  </div></div>`;
}

function reportText(r) {
  const p = r.profile;
  return [
    '🔮 K-RITUAL 연애 처방전',
    `${p.nickname} · ${r.stage.label} · ${getCharacter(state.charId).name} 상담`,
    '',
    `궁합 ${r.compat.score}점 (${r.compat.grade.label})`,
    ...r.compat.notes.map((n) => `- ${n}`),
    '',
    `성향: ${r.tone.type.label} — ${r.tone.type.desc}`,
    '',
    '[이번 주 미션]',
    ...r.missions.map((m, i) => `${i + 1}. ${m}`),
    '',
    '[하지 말 것]',
    ...r.donts.map((d) => `- ${d}`),
    '',
    `부적: "${r.charm}"`,
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * 기록
 * ------------------------------------------------------------------ */
function renderHistory() {
  const list = loadStore().reports || [];
  $app.innerHTML = `
    ${topbar({ back: true, right: '<span></span>' })}
    <div class="panel">
      <div class="sec-title">지난 처방전</div>
      ${list.length ? list.map((r, i) => histRow(r, i)).join('') : '<div class="muted">아직 기록이 없어. 첫 상담을 시작해봐.</div>'}
    </div>
    <div class="bottom-space"></div>`;
  $dock.innerHTML = list.length ? `<div class="dock"><div class="dock-inner">
    <button class="btn btn-ghost" data-act="clear-history">기록 전체 삭제</button>
  </div></div>` : '';
}

/* ------------------------------------------------------------------ *
 * 이벤트
 * ------------------------------------------------------------------ */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act], [data-set], [data-toggle], [data-choice]');
  if (!t) return;

  if (t.dataset.set) {
    const key = t.dataset.set;
    if (key === 'char') state.charId = t.dataset.val;
    else if (key === 'contact') {
      state.profile.contact = t.dataset.val;
      state.profile.contactLabel = t.dataset.label;
    } else state.profile[key] = t.dataset.val;
    render();
    return;
  }

  if (t.dataset.toggle === 'concern') {
    const cs = state.profile.concerns;
    const i = cs.indexOf(t.dataset.val);
    if (i >= 0) cs.splice(i, 1);
    else if (cs.length >= 3) toast('3개까지만 고를 수 있어');
    else cs.push(t.dataset.val);
    render();
    return;
  }

  if (t.dataset.choice !== undefined) {
    await submitAnswer(chapterList()[state.chapterIdx].choices[Number(t.dataset.choice)]);
    return;
  }

  switch (t.dataset.act) {
    case 'start': {
      const store = loadStore();
      if (store.profile) state.profile = { ...blankProfile(), ...store.profile };
      state.step = 0;
      go('onboard');
      break;
    }
    case 'pick-home': {
      const store = loadStore();
      if (store.profile) state.profile = { ...blankProfile(), ...store.profile };
      state.charId = t.dataset.val;
      state.step = 0;
      go('onboard');
      break;
    }
    case 'next':
      if (state.step < 4) { state.step += 1; render(); break; }
      saveStore({ profile: state.profile });
      state.screen = 'chat';
      window.scrollTo(0, 0);
      startChat();
      break;
    case 'prev':
      state.step = Math.max(0, state.step - 1);
      render();
      break;
    case 'back':
      if (state.screen === 'onboard' && state.step > 0) { state.step -= 1; render(); }
      else if (state.screen === 'report') { state.freeMode = true; go('chat'); rebuildChat(); }
      else go('home');
      break;
    case 'history':
      go('history');
      break;
    case 'send': {
      const el = document.getElementById('free-text');
      const text = (el?.value || '').trim();
      if (!text) { toast('한 줄이라도 적어줘'); break; }
      if (t.dataset.free === '1') await freeAsk(text);
      else await submitAnswer({ label: text, text, tone: null });
      break;
    }
    case 'to-report': {
      state.report = buildReport(state.profile, state.answers);
      const store = loadStore();
      const reports = [{
        createdAt: state.report.createdAt,
        charId: state.charId,
        charName: getCharacter(state.charId).name,
        stageLabel: state.report.stage.label,
        score: state.report.compat.score,
        data: state.report,
      }, ...(store.reports || [])].slice(0, 20);
      saveStore({ reports, profile: state.profile });
      go('report');
      break;
    }
    case 'open-report': {
      const item = (loadStore().reports || [])[Number(t.dataset.idx)];
      if (!item) break;
      state.report = item.data;
      state.charId = item.charId;
      state.profile = { ...blankProfile(), ...item.data.profile };
      go('report');
      break;
    }
    case 'back-chat':
      state.freeMode = true;
      go('chat');
      rebuildChat();
      break;
    case 'copy':
      try {
        await navigator.clipboard.writeText(reportText(state.report));
        toast('처방전을 복사했어 📋');
      } catch {
        toast('복사가 막혀 있어. 길게 눌러서 복사해줘');
      }
      break;
    case 'clear-history':
      saveStore({ reports: [] });
      toast('기록을 지웠어');
      render();
      break;
  }
});

// 처방전에서 돌아왔을 때 대화 흐름 복원 (지난 대사를 컷으로 다시 깔아준다)
function rebuildChat() {
  renderChat();
  state.history.forEach((m) => {
    if (m.role === 'assistant') addCut(m.content, getCharacter(state.charId).name);
    else addCut(m.content, '나', true);
  });
  showWriter('더 물어보고 싶은 거 있어?', true);
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
  requestAnimationFrame(revealPassed); // 지난 대사는 이미 본 것이므로 전부 펼쳐둔다
}

document.addEventListener('input', (e) => {
  const f = e.target.dataset?.field;
  if (!f) return;
  state.profile[f] = e.target.value;
  const btn = document.querySelector('[data-act="next"]');
  if (btn) btn.disabled = !validateStep(state.step, state.profile);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) document.querySelector('[data-act="send"]')?.click();
});

/* ------------------------------------------------------------------ *
 * 부팅
 * ------------------------------------------------------------------ */
(async function boot() {
  render();
  await checkAI();
  if (state.screen === 'home') render();
})();
