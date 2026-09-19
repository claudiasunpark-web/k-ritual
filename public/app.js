// K-RITUAL · 연애 상담 캐릭터챗
// 화면 전환 + 스토리 진행 + 리포트 렌더링

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
  nickname: '',
  birth: '',
  birthTime: '',
  gender: '',
  mbti: '모름',
  stage: '',
  partnerName: '',
  partnerBirth: '',
  partnerMbti: '모름',
  duration: '',
  contact: '',
  contactLabel: '',
  concerns: [],
  situation: '',
});

const state = {
  screen: 'home',
  step: 0,
  profile: blankProfile(),
  charId: null,
  chapterIdx: 0,
  answers: [],
  messages: [],
  history: [],
  report: null,
  freeMode: false,
  busy: false,
  used: new Set(), // 한 상담 안에서 같은 문장을 두 번 쓰지 않기 위한 기록
};

// 아직 쓰지 않은 문장을 고른다. 전부 썼으면 가장 덜 어색한 걸로 폴백.
function freshLine(pool, rng) {
  const unused = pool.filter((l) => l && !state.used.has(l));
  const list = unused.length ? unused : pool.filter(Boolean);
  if (!list.length) return '';
  const line = list[Math.floor(rng() * list.length) % list.length];
  state.used.add(line);
  return line;
}

// 자유 입력 문장에서 고민 카테고리 추정 (로컬 모드)
function guessConcern(text, fallback) {
  for (const [id, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => text.includes(w))) return id;
  }
  return fallback || 'signal';
}

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { profile: null, reports: [] };
  } catch {
    return { profile: null, reports: [] };
  }
}

function saveStore(patch) {
  const cur = loadStore();
  const next = { ...cur, ...patch };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch { /* 저장 실패는 조용히 무시 (시크릿 모드 등) */ }
  return next;
}

/* ------------------------------------------------------------------ *
 * 아바타 (이미지 에셋 없이 SVG로 그림 — 나중에 일러스트로 교체 가능)
 * ------------------------------------------------------------------ */
function avatarSVG(char, size = 72) {
  const { skin, hair, accent, eyes } = char.face;
  const back = {
    hari: `<ellipse cx="40" cy="50" rx="27" ry="31" fill="${hair}"/>`,
    doyun: `<ellipse cx="40" cy="46" rx="23" ry="25" fill="${hair}"/>`,
    mio: `<ellipse cx="40" cy="50" rx="26" ry="30" fill="${hair}"/>
          <circle cx="12" cy="46" r="10" fill="${hair}"/><circle cx="68" cy="46" r="10" fill="${hair}"/>`,
    jay: `<ellipse cx="40" cy="44" rx="22" ry="23" fill="${hair}"/>`,
  }[char.id] || '';

  const front = {
    hari: `<path d="M18 36c4-16 40-16 44 0 0 0-8-6-14-4-4 1-6 5-6 5s-6-8-12-6-12 5-12 5z" fill="${hair}"/>`,
    doyun: `<path d="M19 38c1-16 41-16 42 0 0 0-6-9-21-9s-21 9-21 9z" fill="${hair}"/>`,
    mio: `<path d="M18 38c0-18 44-18 44 0 0 0-5-7-10-7H28c-5 0-10 7-10 7z" fill="${hair}"/>`,
    jay: `<path d="M19 38c2-15 40-15 42 0 0 0-7-7-21-7s-21 7-21 7z" fill="${hair}"/>
          <path d="M16 44a24 24 0 0 1 48 0" stroke="${accent}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <rect x="9" y="42" width="10" height="15" rx="5" fill="${accent}"/>
          <rect x="61" y="42" width="10" height="15" rx="5" fill="${accent}"/>`,
  }[char.id] || '';

  return `<svg viewBox="0 0 80 80" width="${size}" height="${size}" role="img" aria-label="${char.name}">
    <defs>
      <radialGradient id="bg-${char.id}" cx="50%" cy="30%">
        <stop offset="0%" stop-color="${char.palette.primary}" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="${char.palette.deep}" stop-opacity="0.9"/>
      </radialGradient>
    </defs>
    <circle cx="40" cy="40" r="39" fill="url(#bg-${char.id})"/>
    ${back}
    <ellipse cx="40" cy="44" rx="19" ry="21" fill="${skin}"/>
    ${front}
    <ellipse cx="32" cy="47" rx="3.6" ry="5" fill="${eyes}"/>
    <ellipse cx="48" cy="47" rx="3.6" ry="5" fill="${eyes}"/>
    <circle cx="33.2" cy="45" r="1.5" fill="#fff"/>
    <circle cx="49.2" cy="45" r="1.5" fill="#fff"/>
    <ellipse cx="26" cy="54" rx="4" ry="2.2" fill="${accent}" opacity="0.35"/>
    <ellipse cx="54" cy="54" rx="4" ry="2.2" fill="${accent}" opacity="0.35"/>
    <path d="M37 56q3 3 6 0" stroke="${eyes}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`;
}

function meAvatar(size = 42) {
  const initial = (state.profile.nickname || '나').slice(0, 1);
  return `<svg viewBox="0 0 80 80" width="${size}" height="${size}" role="img" aria-label="나">
    <defs><linearGradient id="megrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff4d87"/><stop offset="100%" stop-color="#a86cff"/>
    </linearGradient></defs>
    <circle cx="40" cy="40" r="39" fill="url(#megrad)"/>
    <text x="40" y="52" text-anchor="middle" font-size="34" font-family="Black Han Sans, sans-serif" fill="#fff">${esc(initial)}</text>
  </svg>`;
}

/* ------------------------------------------------------------------ *
 * 유틸
 * ------------------------------------------------------------------ */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function applyPalette(char) {
  const root = document.documentElement.style;
  if (!char) {
    root.setProperty('--char', '#a86cff');
    root.setProperty('--char-soft', '#efe4ff');
    root.setProperty('--char-deep', '#2a1246');
    return;
  }
  root.setProperty('--char', char.palette.primary);
  root.setProperty('--char-soft', char.palette.soft);
  root.setProperty('--char-deep', char.palette.deep);
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function go(screen) {
  state.screen = screen;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  render();
}

/* ------------------------------------------------------------------ *
 * 렌더 진입점
 * ------------------------------------------------------------------ */
function render() {
  applyPalette(state.charId ? getCharacter(state.charId) : null);
  const screens = {
    home: renderHome,
    onboard: renderOnboard,
    chat: renderChat,
    report: renderReport,
    history: renderHistory,
  };
  (screens[state.screen] || renderHome)();
}

function topbar(opts = {}) {
  return `<div class="topbar">
    ${opts.back ? `<button class="icon-btn" data-act="back">←</button>` : ''}
    <div class="brand">K·<span>RITUAL</span></div>
    <div class="spacer"></div>
    ${opts.right || `<button class="icon-btn" data-act="history" title="지난 상담">🗂</button>`}
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 홈
 * ------------------------------------------------------------------ */
function renderHome() {
  const store = loadStore();
  const hasHistory = (store.reports || []).length > 0;

  $app.innerHTML = `
    ${topbar()}
    <div class="panel hero">
      <div class="stamp">심야 1:1 상담</div>
      <h1>연애, 혼자 <em>해석</em>하지마.</h1>
      <p class="sub">
        만화 속 상담사 네 명이 기다리고 있어.<br />
        네 사주와 상황을 읽고, 스토리처럼 상담하고,<br />
        마지막엔 <b>이번 주 처방전</b>을 줄게.
      </p>
      <div class="char-strip">
        ${CHARACTERS.map((c) => `
          <div class="char-chip">
            ${avatarSVG(c, 56)}
            <div class="n">${esc(c.name)}</div>
            <div class="t">${esc(c.title)}</div>
          </div>`).join('')}
      </div>
    </div>

    <div class="panel">
      <div class="sec-title">이렇게 진행돼</div>
      <div class="muted">
        1. 나와 상대 정보를 입력해 (사주·MBTI·상황)<br />
        2. 상담사를 고르면 스토리 대화가 시작돼<br />
        3. 선택지와 네 이야기로 흐름이 바뀌어<br />
        4. 궁합 점수 + 이번 주 미션이 담긴 처방전이 나와
      </div>
    </div>

    ${hasHistory ? `
    <div class="panel">
      <div class="sec-title">지난 처방전</div>
      ${(store.reports || []).slice(0, 3).map((r, i) => `
        <button class="hist-item" data-act="open-report" data-idx="${i}">
          ${avatarSVG(getCharacter(r.charId), 34)}
          <div>
            <div style="font-size:13.5px;font-weight:700">${esc(r.stageLabel)} · ${esc(r.charName)}</div>
            <div class="faint">${new Date(r.createdAt).toLocaleDateString('ko-KR')}</div>
          </div>
          <div class="s">${r.score}</div>
        </button>`).join('')}
    </div>` : ''}
  `;

  $dock.innerHTML = `<div class="dock"><div class="dock-inner">
    <button class="btn" data-act="start">상담 시작하기 🔮</button>
  </div></div>`;
}

/* ------------------------------------------------------------------ *
 * 온보딩 (입력 수집)
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
  `;

  const canNext = validateStep(step, p);
  $dock.innerHTML = `<div class="dock"><div class="dock-inner">
    ${step > 0 ? `<button class="btn btn-ghost" style="flex:0 0 96px" data-act="prev">이전</button>` : ''}
    <button class="btn" data-act="next" ${canNext ? '' : 'disabled'}>
      ${step === 4 ? '상담 시작 ✨' : '다음'}
    </button>
  </div></div>`;
}

function validateStep(step, p) {
  if (step === 0) return p.nickname.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.birth);
  if (step === 1) return !!p.stage;
  if (step === 2) return true; // 상대 정보는 전부 선택 입력
  if (step === 3) return p.concerns.length > 0;
  if (step === 4) return !!state.charId;
  return true;
}

function stepMe(p) {
  return `
    <h2 class="step-title">먼저 너부터 알려줘</h2>
    <p class="step-desc">생년월일은 사주(오행) 궁합을 보는 데 써. 서버에 저장되지 않고 이 기기에만 남아.</p>
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
    </div>
  `;
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
    </div>
  `;
}

function stepPartner(p) {
  return `
    <h2 class="step-title">그 사람 얘기</h2>
    <p class="step-desc">아는 것만 채워도 돼. 생년월일을 넣으면 궁합 해석이 훨씬 정확해져.</p>
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
    </div>
  `;
}

function stepConcern(p) {
  return `
    <h2 class="step-title">뭐가 제일 답답해?</h2>
    <p class="step-desc">최대 3개까지 고를 수 있어. 처방전이 이 기준으로 나와.</p>
    <div class="field">
      <div class="pill-wrap">
        ${CONCERNS.map((c) => `
          <button class="pill ${p.concerns.includes(c.id) ? 'on' : ''}" data-toggle="concern" data-val="${c.id}">${c.emoji} ${c.label}</button>
        `).join('')}
      </div>
    </div>
    <div class="field">
      <label>무슨 일이 있었는지 편하게 써줘 <span class="hint">선택 · 길수록 상담이 정확해져</span></label>
      <textarea class="input" data-field="situation" placeholder="예) 두 달째 썸인데 먼저 연락은 항상 저예요. 지난주에 둘이 영화 보고 왔는데 그 뒤로 답장이 느려졌어요.">${esc(p.situation)}</textarea>
    </div>
  `;
}

function stepCharacter() {
  return `
    <h2 class="step-title">누구한테 상담받을래?</h2>
    <p class="step-desc">같은 상황도 상담사에 따라 완전히 다른 답이 나와.</p>
    ${CHARACTERS.map((c) => `
      <button class="char-card ${state.charId === c.id ? 'on' : ''}"
              data-set="char" data-val="${c.id}"
              style="border-color:${state.charId === c.id ? c.palette.primary : ''};
                     background:${state.charId === c.id ? `linear-gradient(120deg, ${c.palette.deep}, rgba(255,255,255,0.03))` : ''}">
        ${avatarSVG(c, 70)}
        <div>
          <div><span class="name">${esc(c.name)}</span><span class="title tag" style="color:${c.palette.primary}">${esc(c.title)}</span></div>
          <div class="tagline">"${esc(c.tagline)}"</div>
        </div>
      </button>`).join('')}
  `;
}

/* ------------------------------------------------------------------ *
 * 챗 (스토리 상담)
 * ------------------------------------------------------------------ */
function chapterList() {
  return CHAPTERS[state.profile.stage] || CHAPTERS.talking;
}

function renderChat() {
  const char = getCharacter(state.charId);
  const mode = aiAvailable() ? 'AI 상담 모드' : '스토리 모드';

  $app.innerHTML = `
    ${topbar({ back: true })}
    <div class="chat-head">
      ${avatarSVG(char, 44)}
      <div>
        <div class="n">${esc(char.name)} <span class="faint">· ${esc(char.title)}</span></div>
        <div class="s">${esc(state.profile.nickname)}님과 상담 중</div>
      </div>
      <div class="mode">${mode}</div>
    </div>
    <div class="scene" id="scene"></div>
    <div id="input-area"></div>
  `;
  $dock.innerHTML = '';
  paintMessages();
}

function paintMessages() {
  const scene = document.getElementById('scene');
  if (!scene) return;
  const char = getCharacter(state.charId);
  scene.innerHTML = state.messages.map((m) => {
    if (m.who === 'me') {
      return `<div class="msg me">${meAvatar(42)}<div class="bubble">${esc(m.text)}</div></div>`;
    }
    if (m.typing) {
      return `<div class="msg">${avatarSVG(char, 42)}<div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
    }
    return `<div class="msg">${avatarSVG(char, 42)}<div class="bubble">
      ${m.narr ? `<span class="narr">${esc(m.narr)}</span>` : ''}${esc(m.text)}</div></div>`;
  }).join('');
}

function scrollDown() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

// 상담사 대사 출력 (타이핑 연출 포함)
async function say(text, narr) {
  const char = getCharacter(state.charId);
  state.messages.push({ who: 'char', typing: true });
  paintMessages();
  scrollDown();
  await sleep(Math.min(1100, 320 + text.length * 8));
  state.messages.pop();
  const msg = { who: 'char', text: '', narr };
  state.messages.push(msg);
  paintMessages();

  // 한 글자씩 노출
  const full = text;
  for (let i = 1; i <= full.length; i++) {
    msg.text = full.slice(0, i);
    paintMessages();
    if (i % 3 === 0) await sleep(Math.max(6, char.speed / 3));
  }
  msg.text = full;
  paintMessages();
  scrollDown();
  state.history.push({ role: 'assistant', content: full });
}

function me(text) {
  state.messages.push({ who: 'me', text });
  state.history.push({ role: 'user', content: text });
  paintMessages();
  scrollDown();
}

function clearInput() {
  const el = document.getElementById('input-area');
  if (el) el.innerHTML = '';
}

function showChoices(choices) {
  const el = document.getElementById('input-area');
  el.innerHTML = `<div class="answers">
    ${choices.map((c, i) => `<button class="answer-btn" data-choice="${i}">${esc(c.label)}</button>`).join('')}
  </div>`;
  scrollDown();
}

function showFreeInput(placeholder) {
  const el = document.getElementById('input-area');
  el.innerHTML = `<div class="free-input">
    <textarea id="free-text" placeholder="${esc(placeholder || '편하게 적어줘')}"></textarea>
    <button class="send-btn" data-act="send">↑</button>
  </div>`;
  document.getElementById('free-text').focus();
  scrollDown();
}

function showFinish() {
  const el = document.getElementById('input-area');
  el.innerHTML = `<div class="answers">
    <button class="answer-btn" data-act="to-report" style="text-align:center;font-weight:700">📜 이번 주 처방전 받기</button>
  </div>`;
  scrollDown();
}

// 상담 시작
async function startChat() {
  const char = getCharacter(state.charId);
  const p = state.profile;
  const me0 = readSaju(p.birth);
  const partner = readSaju(p.partnerBirth);
  const rng = makeRng(hashSeed(p.nickname + char.id));

  state.messages = [];
  state.history = [];
  state.answers = [];
  state.chapterIdx = 0;
  state.freeMode = false;
  state.used = new Set();
  renderChat();

  await say(char.openers[Math.floor(rng() * char.openers.length)]);

  // 사주 첫 코멘트 — 캐릭터마다 다르게
  if (me0) {
    const el = ELEMENT_INFO[me0.dayElement];
    const intro = {
      mio: `${p.nickname}, 너는 ${me0.label}. 일간의 기운은 ${me0.dayElement}${el ? ` ${el.emoji}` : ''}이야. ${el ? el.love : ''}.`,
      hari: `${me0.zodiac}띠구나. ${me0.dayElement} 기운 센 사람들 특징 알지? ${el ? el.keyword : ''}. 너도 그래.`,
      doyun: `${me0.label}이네요. ${me0.dayElement}의 기운이라 ${el ? el.love : ''}. 그래서 더 지쳤을 거예요.`,
      jay: `${me0.zodiac}띠, ${me0.dayElement} 기운. 참고만 할게. 중요한 건 실제 데이터니까.`,
    }[char.id];
    await say(intro);
  }
  if (partner) {
    const nameOf = p.partnerName || '그 사람';
    await say(`${nameOf}은 ${partner.label}, ${partner.dayElement}의 기운이야. 기억해 둘게.`);
  }

  if (p.situation) {
    await say({
      hari: '상황 다 읽었어. 솔직히 말할 테니까 각오해.',
      doyun: '써준 글 잘 읽었어요. 혼자 오래 삼켰겠네요.',
      mio: '네가 남긴 이야기를 읽었어. 결이 흔들리고 있구나.',
      jay: '상황 파악 완료. 팩트부터 하나씩 확인하자.',
    }[char.id]);
  }

  await nextChapter();
}

async function nextChapter() {
  const list = chapterList();
  const ch = list[state.chapterIdx];
  if (!ch) return finishChat();

  await say(voiced(getCharacter(state.charId), ch.ask, state.profile));
  if (ch.free) showFreeInput(ch.placeholder);
  else showChoices(ch.choices);
}

// 선택지 / 자유 입력에 대한 상담사 반응
async function react(answer, ch) {
  const char = getCharacter(state.charId);
  const p = state.profile;

  if (aiAvailable()) {
    const ai = await askAI(char, p, state.history.slice(0, -1), answer.text || answer.label, state.report);
    if (ai) { await say(ai); return; }
  }

  // 로컬 폴백: 선택지 note + 고민 카테고리 해석을 캐릭터 말투로
  const rng = makeRng(hashSeed((answer.text || answer.label || '') + char.id + state.chapterIdx));
  const base = p.concerns[state.chapterIdx % Math.max(1, p.concerns.length)] || 'signal';
  const concern = answer.text ? guessConcern(answer.text, base) : base;

  const openers = {
    hari: ['그래. 그건 인정.', '음, 예상했어.', '솔직히 그럴 줄 알았어.', '자, 정리해보자.'],
    doyun: ['그랬구나.', '말해줘서 고마워요.', '많이 고민했겠네요.', '충분히 그럴 수 있어요.'],
    mio: ['…보인다.', '흐름이 그렇게 흐르고 있었구나.', '역시.', '기운이 한쪽으로 기울어 있어.'],
    jay: ['오케이, 기록했어.', '패턴 하나 보인다.', '이건 꽤 흔한 케이스야.', '자 그럼 해석해볼게.'],
  }[char.id];

  const line1 = freshLine(openers, rng) || openers[0];
  const line2 = answer.note
    ? `${answer.note}.`
    : freshLine(REACTIONS[concern] || REACTIONS.signal, rng);

  await say([line1, line2].filter(Boolean).join(' '));

  // 자유 서술이면 사용자가 쓴 문장을 그대로 비춰준다 (들었다는 신호)
  if (ch.free && answer.text) {
    const quote = answer.text.slice(0, 28) + (answer.text.length > 28 ? '…' : '');
    await say(voiced(char, `"${quote}" — 이 문장, 네가 진짜 하고 싶은 말이지.`, p));
  } else {
    const move = freshLine(REACTIONS[concern] || REACTIONS.signal, rng);
    if (move) await say(voiced(char, move, p));
  }
}

async function submitAnswer(answer) {
  if (state.busy) return;
  state.busy = true;
  const ch = chapterList()[state.chapterIdx];
  clearInput();
  me(answer.text || answer.label);
  state.answers.push({ ...answer, chapter: ch.id, free: !!ch.free });
  await react(answer, ch);
  state.chapterIdx += 1;
  state.busy = false;
  await nextChapter();
}

async function finishChat() {
  const char = getCharacter(state.charId);
  await say({
    hari: '자, 여기까지 듣고 나니까 답 나왔어. 처방전 써줄게.',
    doyun: '이제 정리해볼게요. 오늘 한 얘기 다 담았어요.',
    mio: '흐름을 다 읽었어. 네 처방을 적어줄게.',
    jay: '데이터 충분해. 결론 정리해서 보여줄게.',
  }[char.id]);
  showFinish();
}

// 처방전 이후 자유 질문
async function freeAsk(text) {
  if (state.busy) return;
  state.busy = true;
  clearInput();
  me(text);
  const char = getCharacter(state.charId);
  if (aiAvailable()) {
    const ai = await askAI(char, state.profile, state.history.slice(0, -1), text, state.report);
    await say(ai || '지금은 말이 잘 안 나오네. 다시 한번 물어봐 줄래?');
  } else {
    const rng = makeRng(hashSeed(text + char.id + state.messages.length));
    const concern = guessConcern(text, state.profile.concerns[0]);
    const hint = ADVICE[concern];
    // 해석 풀이 바닥나면 리포트용 문장까지 끌어와 같은 말 반복을 줄인다
    const reaction = freshLine([...(REACTIONS[concern] || REACTIONS.signal), hint.read], rng);
    await say(reaction);
    await say(voiced(char, freshLine([hint.move, ...(FOLLOWUPS[state.profile.stage] || [])], rng), state.profile));
  }
  state.busy = false;
  showFreeInput('더 물어보고 싶은 거 있어?');
}

/* ------------------------------------------------------------------ *
 * 리포트 (처방전)
 * ------------------------------------------------------------------ */
function renderReport() {
  const r = state.report;
  const char = getCharacter(state.charId);
  const p = state.profile;
  const meEl = r.me ? ELEMENT_INFO[r.me.dayElement] : null;
  const paEl = r.partner ? ELEMENT_INFO[r.partner.dayElement] : null;
  const circ = 2 * Math.PI * 54;
  const dash = (r.compat.score / 100) * circ;

  $app.innerHTML = `
    ${topbar({ back: true })}

    <div class="report-head">
      <div class="kicker">${esc(char.name)} 상담사의</div>
      <h2>연애 처방전</h2>
      <div class="faint">${esc(p.nickname)} · ${esc(r.stage.label)} · ${new Date(r.createdAt).toLocaleDateString('ko-KR')}</div>
      <div class="score-ring">
        <svg width="132" height="132">
          <circle cx="66" cy="66" r="54" stroke="rgba(255,255,255,0.08)" stroke-width="12" fill="none"/>
          <circle cx="66" cy="66" r="54" stroke="url(#ring)" stroke-width="12" fill="none"
                  stroke-linecap="round" stroke-dasharray="${dash} ${circ}"/>
          <defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${char.palette.primary}"/><stop offset="100%" stop-color="#f5c66b"/>
          </linearGradient></defs>
        </svg>
        <div class="val">
          <div class="num">${r.compat.score}</div>
          <div class="unit">궁합 점수</div>
        </div>
      </div>
      <div class="tag" style="border-color:${char.palette.primary};color:#fff">${r.compat.grade.emoji} ${esc(r.compat.grade.label)}</div>
    </div>

    <div class="panel">
      <div class="sec-title">기운으로 보는 두 사람</div>
      <div class="elem-row">
        <div class="elem">
          <div class="e">${meEl ? meEl.emoji : '❔'}</div>
          <div class="k">${r.me ? r.me.dayElement : '?'}</div>
          <div class="w">${esc(p.nickname)}${meEl ? ` · ${meEl.keyword}` : ''}</div>
        </div>
        <div class="elem-vs">VS</div>
        <div class="elem">
          <div class="e">${paEl ? paEl.emoji : '❔'}</div>
          <div class="k">${r.partner ? r.partner.dayElement : '?'}</div>
          <div class="w">${esc(p.partnerName || '그 사람')}${paEl ? ` · ${paEl.keyword}` : ''}</div>
        </div>
      </div>
      <div class="note-list">
        ${r.compat.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}
      </div>
    </div>

    <div class="panel">
      <div class="sec-title">네 연애 성향</div>
      <div style="display:flex;gap:12px;align-items:center">
        <div style="font-size:34px">${r.tone.type.emoji}</div>
        <div>
          <div style="font-family:var(--font-display);font-size:20px">${esc(r.tone.type.label)}</div>
          <div class="muted" style="margin-top:4px">${esc(r.tone.type.desc)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">
        <div class="read-card" style="margin:0">
          <div class="h">지켜야 할 것</div><div class="r">${esc(r.tone.type.keep)}</div>
        </div>
        <div class="read-card" style="margin:0">
          <div class="h">조심할 것</div><div class="r">${esc(r.tone.type.watch)}</div>
        </div>
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
      ${r.missions.map((m, i) => `
        <div class="mission"><div class="no">${i + 1}</div><div class="txt">${esc(m)}</div></div>
      `).join('')}
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
      <div class="faint" style="margin-top:8px">${esc(r.week.find((w) => w.hot)?.day || '토')}요일에 기운이 가장 세. 중요한 얘긴 그날에.</div>
    </div>

    <div class="panel charm">
      <div class="t">— 오늘의 부적 —</div>
      <div class="p">"${esc(r.charm)}"</div>
    </div>
  `;

  $dock.innerHTML = `<div class="dock"><div class="dock-inner">
    <button class="btn btn-ghost" data-act="back-chat">더 물어보기</button>
    <button class="btn" data-act="copy">요약 복사</button>
  </div></div>`;
}

function reportText(r) {
  const p = r.profile;
  return [
    `🔮 K-RITUAL 연애 처방전`,
    `${p.nickname} · ${r.stage.label} · ${getCharacter(state.charId).name} 상담`,
    ``,
    `궁합 ${r.compat.score}점 (${r.compat.grade.label})`,
    ...r.compat.notes.map((n) => `- ${n}`),
    ``,
    `성향: ${r.tone.type.label} — ${r.tone.type.desc}`,
    ``,
    `[이번 주 미션]`,
    ...r.missions.map((m, i) => `${i + 1}. ${m}`),
    ``,
    `[하지 말 것]`,
    ...r.donts.map((d) => `- ${d}`),
    ``,
    `부적: "${r.charm}"`,
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * 기록
 * ------------------------------------------------------------------ */
function renderHistory() {
  const store = loadStore();
  const list = store.reports || [];
  $app.innerHTML = `
    ${topbar({ back: true, right: '<span></span>' })}
    <div class="panel">
      <div class="sec-title">지난 처방전</div>
      ${list.length === 0 ? '<div class="muted">아직 기록이 없어. 첫 상담을 시작해봐.</div>' : ''}
      ${list.map((r, i) => `
        <button class="hist-item" data-act="open-report" data-idx="${i}">
          ${avatarSVG(getCharacter(r.charId), 34)}
          <div>
            <div style="font-size:13.5px;font-weight:700">${esc(r.stageLabel)} · ${esc(r.charName)}</div>
            <div class="faint">${new Date(r.createdAt).toLocaleString('ko-KR')}</div>
          </div>
          <div class="s">${r.score}</div>
        </button>`).join('')}
    </div>
  `;
  $dock.innerHTML = list.length ? `<div class="dock"><div class="dock-inner">
    <button class="btn btn-ghost" data-act="clear-history">기록 전체 삭제</button>
  </div></div>` : '';
}

/* ------------------------------------------------------------------ *
 * 이벤트 위임
 * ------------------------------------------------------------------ */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act], [data-set], [data-toggle], [data-choice]');
  if (!t) return;

  // 온보딩 단일 선택
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

  // 고민 다중 선택 (최대 3)
  if (t.dataset.toggle === 'concern') {
    const v = t.dataset.val;
    const cs = state.profile.concerns;
    const idx = cs.indexOf(v);
    if (idx >= 0) cs.splice(idx, 1);
    else if (cs.length >= 3) toast('3개까지만 고를 수 있어');
    else cs.push(v);
    render();
    return;
  }

  // 챗 선택지
  if (t.dataset.choice !== undefined) {
    const ch = chapterList()[state.chapterIdx];
    await submitAnswer(ch.choices[Number(t.dataset.choice)]);
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
    case 'next': {
      if (state.step < 4) { state.step += 1; render(); break; }
      saveStore({ profile: state.profile });
      go('chat');
      startChat();
      break;
    }
    case 'prev':
      state.step = Math.max(0, state.step - 1);
      render();
      break;
    case 'back':
      if (state.screen === 'onboard' && state.step > 0) { state.step -= 1; render(); }
      else if (state.screen === 'report') { go('chat'); paintMessages(); showFinish(); }
      else go('home');
      break;
    case 'history':
      go('history');
      break;
    case 'send': {
      const el = document.getElementById('free-text');
      const text = (el?.value || '').trim();
      if (!text) { toast('한 줄이라도 적어줘'); break; }
      if (state.freeMode) await freeAsk(text);
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
      const store = loadStore();
      const item = (store.reports || [])[Number(t.dataset.idx)];
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
      paintMessages();
      showFreeInput('더 물어보고 싶은 거 있어?');
      break;
    case 'copy': {
      const text = reportText(state.report);
      try {
        await navigator.clipboard.writeText(text);
        toast('처방전을 복사했어 📋');
      } catch {
        toast('복사가 막혀 있어. 길게 눌러서 복사해줘');
      }
      break;
    }
    case 'clear-history':
      saveStore({ reports: [] });
      toast('기록을 지웠어');
      render();
      break;
  }
});

// 입력 필드 바인딩
document.addEventListener('input', (e) => {
  const f = e.target.dataset?.field;
  if (!f) return;
  state.profile[f] = e.target.value;
  const btn = document.querySelector('[data-act="next"]');
  if (btn) btn.disabled = !validateStep(state.step, state.profile);
});

// 자유 입력: Ctrl/Cmd + Enter 전송
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    document.querySelector('[data-act="send"]')?.click();
  }
});

/* ------------------------------------------------------------------ *
 * 부팅
 * ------------------------------------------------------------------ */
(async function boot() {
  render();
  await checkAI();
  if (state.screen === 'chat') renderChat();
})();
