// 상담 엔진
// 1) 사주-라이트 계산 (천간/지지/오행/합충)
// 2) 궁합 점수 + 리포트 생성 (로컬, 결정론적 — 같은 입력이면 항상 같은 결과)
// 3) AI 브릿지 (/api/chat 가 살아있으면 캐릭터 대사를 LLM으로 생성)

import { ADVICE, MISSIONS, DONTS, CHARMS, STAGES, CONCERNS } from './data/scenarios.js';

/* ------------------------------------------------------------------ *
 * 결정론적 난수 (같은 사용자 = 같은 결과)
 * ------------------------------------------------------------------ */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let s = seed || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function pickMany(rng, arr, n) {
  const copy = arr.slice();
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 사주 라이트
 * ------------------------------------------------------------------ */
const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
const ZODIAC = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
const STEM_ELEMENT = ['목', '목', '화', '화', '토', '토', '금', '금', '수', '수'];
const BRANCH_ELEMENT = ['수', '토', '목', '목', '토', '화', '화', '토', '금', '금', '토', '수'];

// 삼합 그룹 (지지 index)
const TRINES = [
  [2, 6, 10], // 인오술 - 화
  [5, 9, 1],  // 사유축 - 금
  [8, 0, 4],  // 신자진 - 수
  [11, 3, 7], // 해묘미 - 목
];
// 육충: 서로 6칸 떨어진 지지
function isClash(a, b) {
  return Math.abs(a - b) === 6;
}
function sameTrine(a, b) {
  return TRINES.some((g) => g.includes(a) && g.includes(b));
}

// 오행 상생 / 상극
const SHENG = { 목: '화', 화: '토', 토: '금', 금: '수', 수: '목' };   // 생
const KE = { 목: '토', 토: '수', 수: '화', 화: '금', 금: '목' };      // 극

export const ELEMENT_INFO = {
  목: { emoji: '🌿', color: '#4caf7d', keyword: '성장 · 확장', love: '관계를 키우고 싶어하는 기운' },
  화: { emoji: '🔥', color: '#ff5c7a', keyword: '열정 · 표현', love: '감정을 바로 드러내는 기운' },
  토: { emoji: '⛰️', color: '#c79a5b', keyword: '안정 · 신뢰', love: '오래 버티고 지켜주는 기운' },
  금: { emoji: '⚔️', color: '#9aa7bd', keyword: '기준 · 결단', love: '선을 긋고 정리하는 기운' },
  수: { emoji: '🌊', color: '#5aa9e6', keyword: '유연 · 공감', love: '상대에 맞춰 흐르는 기운' },
};

// 생년월일(YYYY-MM-DD) → 사주-라이트
export function readSaju(birth) {
  if (!birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  const [y, m, d] = birth.split('-').map(Number);
  const stemIdx = ((y - 4) % 10 + 10) % 10;
  const branchIdx = ((y - 4) % 12 + 12) % 12;
  // 월/일 기운으로 보조 오행 (계절 기운)
  const monthElement = BRANCH_ELEMENT[(m + 1) % 12];
  const dayStem = STEMS[(y + m + d) % 10];
  const dayElement = STEM_ELEMENT[(y + m + d) % 10];

  return {
    birth,
    year: y,
    stem: STEMS[stemIdx],
    branch: BRANCHES[branchIdx],
    branchIdx,
    zodiac: ZODIAC[branchIdx],
    element: STEM_ELEMENT[stemIdx],     // 주 기운
    monthElement,                        // 계절 기운
    dayStem,
    dayElement,                          // 일간 기운 (연애 성향)
    label: `${STEMS[stemIdx]}${BRANCHES[branchIdx]}년 ${ZODIAC[branchIdx]}띠`,
  };
}

function mbtiBonus(a, b) {
  if (!a || !b || a === '모름' || b === '모름') return 0;
  let score = 0;
  // 2번째(N/S), 3번째(F/T)가 같으면 대화가 편하다 / E-I 는 보완일 때 가산
  if (a[1] === b[1]) score += 6;
  if (a[2] === b[2]) score += 4;
  if (a[0] !== b[0]) score += 3;
  if (a[3] === b[3]) score += 2;
  return score;
}

// 궁합 계산
export function calcCompatibility(me, partner, profile) {
  const rng = makeRng(hashSeed(`${profile.nickname}|${profile.birth}|${profile.partnerBirth || 'x'}`));
  let score = 52 + Math.floor(rng() * 6); // 52~57 기본값

  const notes = [];

  // 연애 궁합은 '일간(日干)'의 기운을 본인 기운으로 삼는다 — 리포트 카드와 같은 기준.
  const meEl = me?.dayElement;
  const paEl = partner?.dayElement;

  if (me && partner) {
    if (sameTrine(me.branchIdx, partner.branchIdx)) {
      score += me.branchIdx === partner.branchIdx ? 8 : 20;
      notes.push(`${me.zodiac}띠와 ${partner.zodiac}띠는 서로 끌어당기는 삼합의 자리야.`);
    } else if (isClash(me.branchIdx, partner.branchIdx)) {
      score -= 14;
      notes.push(`${me.zodiac}띠와 ${partner.zodiac}띠는 정면으로 부딪히는 충(沖)이야. 끌림도 세고 상처도 세.`);
    }

    if (SHENG[meEl] === paEl) {
      score += 13;
      notes.push(`네 ${meEl}의 기운이 상대의 ${paEl}을 키워주고 있어. 주는 쪽이 너라는 뜻이기도 해.`);
    } else if (SHENG[paEl] === meEl) {
      score += 13;
      notes.push(`상대의 ${paEl}이 네 ${meEl}을 살려주는 흐름이야. 이 사람 옆에서 네가 편해지는 이유.`);
    } else if (KE[meEl] === paEl) {
      score -= 7;
      notes.push(`네 ${meEl}이 상대의 ${paEl}을 누르는 형국이라, 네 말이 상대에겐 세게 꽂혀.`);
    } else if (KE[paEl] === meEl) {
      score -= 7;
      notes.push(`상대의 ${paEl}이 네 ${meEl}을 누르고 있어. 네가 자꾸 작아지는 건 기분 탓이 아니야.`);
    } else if (meEl === paEl) {
      score += 7;
      notes.push(`둘 다 ${meEl}의 기운. 잘 통하는 만큼 같은 약점도 공유해.`);
    }

    score += mbtiBonus(profile.mbti, profile.partnerMbti);
  } else {
    notes.push('상대 생년월일이 없어서 기운은 네 쪽만 봤어. 나중에 알게 되면 다시 와.');
    score += mbtiBonus(profile.mbti, profile.partnerMbti);
  }

  // 연락 흐름 보정
  const contactAdj = { burst: 6, daily: 4, sparse: -2, rare: -8, none: -12 };
  score += contactAdj[profile.contact] ?? 0;

  score = Math.max(28, Math.min(97, Math.round(score)));

  let grade;
  if (score >= 85) grade = { label: '천생연분 기류', emoji: '💫' };
  else if (score >= 72) grade = { label: '흐름 좋음', emoji: '🌤️' };
  else if (score >= 58) grade = { label: '노력하면 되는 사이', emoji: '⛅' };
  else if (score >= 45) grade = { label: '엇갈리는 중', emoji: '🌫️' };
  else grade = { label: '기운이 서로를 밀어내는 중', emoji: '🌧️' };

  return { score, grade, notes };
}

/* ------------------------------------------------------------------ *
 * 성향 축 (선택지 tone 합산)
 * ------------------------------------------------------------------ */
export function readTone(answers) {
  const total = { push: 0, hold: 0, care: 0 };
  answers.forEach((a) => {
    if (!a.tone) return;
    total.push += a.tone.push || 0;
    total.hold += a.tone.hold || 0;
    total.care += a.tone.care || 0;
  });
  const top = Object.entries(total).sort((a, b) => b[1] - a[1])[0][0];
  const TYPES = {
    push: {
      id: 'push',
      label: '돌진형',
      emoji: '🏹',
      desc: '확실한 답을 빨리 받고 싶어하는 타입. 속도는 무기고, 조급함은 약점이야.',
      keep: '먼저 움직이는 용기',
      watch: '상대의 속도를 무시하는 순간',
    },
    hold: {
      id: 'hold',
      label: '관망형',
      emoji: '🪞',
      desc: '재고 또 재는 타입. 신중함 덕분에 덜 다치지만, 기회도 자주 놓쳐.',
      keep: '상황을 읽는 눈',
      watch: '"조금만 더 지켜보자"가 반복될 때',
    },
    care: {
      id: 'care',
      label: '회복형',
      emoji: '🕯️',
      desc: '지금은 관계보다 네 마음이 먼저 회복돼야 하는 시기야.',
      keep: '자기 감정을 읽는 정직함',
      watch: '상대의 반응으로 네 가치를 매기는 습관',
    },
  };
  return { total, type: TYPES[top] };
}

/* ------------------------------------------------------------------ *
 * 리포트 생성
 * ------------------------------------------------------------------ */
export function buildReport(profile, answers) {
  const me = readSaju(profile.birth);
  const partner = readSaju(profile.partnerBirth);
  const compat = calcCompatibility(me, partner, profile);
  const tone = readTone(answers);
  const rng = makeRng(hashSeed(`${profile.nickname}|${profile.stage}|${(profile.concerns || []).join(',')}`));

  const stage = STAGES.find((s) => s.id === profile.stage) || STAGES[0];
  const concerns = (profile.concerns || []).slice(0, 3);
  const reads = concerns.map((c) => ({
    label: CONCERNS.find((x) => x.id === c)?.label || c,
    emoji: CONCERNS.find((x) => x.id === c)?.emoji || '•',
    read: ADVICE[c]?.read || '',
    move: ADVICE[c]?.move || '',
  }));

  const missions = pickMany(rng, MISSIONS[profile.stage] || MISSIONS.talking, 3);
  const donts = DONTS[profile.stage] || DONTS.talking;
  const charm = CHARMS[me?.dayElement || '수'];

  // 자유 서술 답변 요약 (사용자가 직접 쓴 문장 다시 비춰주기)
  const echoes = answers.filter((a) => a.free && a.text).map((a) => a.text);

  const hotIdx = Math.floor(rng() * 7);
  const week = ['월', '화', '수', '목', '금', '토', '일'].map((d, i) => {
    const v = Math.floor(makeRng(hashSeed(`${profile.nickname}|${d}|${profile.stage}`))() * 5) + 1;
    return { day: d, level: v, hot: i === hotIdx };
  });

  return {
    createdAt: new Date().toISOString(),
    profile,
    me,
    partner,
    compat,
    tone,
    stage,
    reads,
    missions,
    donts,
    charm,
    echoes,
    week,
  };
}

/* ------------------------------------------------------------------ *
 * 캐릭터 말투 입히기 (로컬 모드)
 * ------------------------------------------------------------------ */
export function voiced(character, text, profile) {
  const rng = makeRng(hashSeed(text + character.id));
  const nick = profile?.nickname || '너';
  let out = text.replaceAll('{nick}', character.voice.callSign(nick));
  // 짧은 한 마디에만 말버릇을 붙인다 (긴 조언 문장에 붙으면 어색해짐)
  if (out.length <= 42 && !/[?!…]$/.test(out) && rng() > 0.5) {
    out = out.replace(/\.$/, '') + pick(rng, character.voice.tics);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * AI 브릿지
 * ------------------------------------------------------------------ */
let aiStatus = { checked: false, available: false, model: null };

export async function checkAI() {
  if (aiStatus.checked) return aiStatus;
  try {
    const res = await fetch('/api/health', { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      aiStatus = { checked: true, available: !!data.ai, model: data.model || null };
    } else {
      aiStatus = { checked: true, available: false, model: null };
    }
  } catch {
    aiStatus = { checked: true, available: false, model: null };
  }
  return aiStatus;
}

export function aiAvailable() {
  return aiStatus.available;
}

// 캐릭터 페르소나 + 사용자 프로필로 시스템 프롬프트 구성
export function buildSystemPrompt(character, profile, report) {
  const me = readSaju(profile.birth);
  const partner = readSaju(profile.partnerBirth);
  const stage = STAGES.find((s) => s.id === profile.stage);
  const concerns = (profile.concerns || [])
    .map((c) => CONCERNS.find((x) => x.id === c)?.label)
    .filter(Boolean)
    .join(', ');

  return `${character.persona}

[상담 세팅]
- 너는 만화풍 연애 상담 앱의 캐릭터다. 한 번에 2~3문장, 최대 120자 이내로 말한다.
- 항상 한국어. 캐릭터 말투를 절대 벗어나지 않는다.
- 사용자를 판단하거나 훈계하지 않는다. 구체적이고 실행 가능한 한 가지를 준다.
- 사주/오행 언급은 미오만 적극적으로, 나머지는 가끔 한 번 정도만 쓴다.
- 의료·법률·안전 위험 신호(폭력, 스토킹, 자해 언급)가 보이면 상담을 멈추고 전문기관 도움을 권한다.

[내담자 정보]
- 닉네임: ${profile.nickname}
- 생년월일: ${profile.birth || '미입력'}${me ? ` (${me.label}, 기운 ${me.element}/일간 ${me.dayElement})` : ''}
- MBTI: ${profile.mbti || '미입력'}
- 관계 단계: ${stage ? stage.label : '미입력'}
- 상대: ${profile.partnerName || '그 사람'}${partner ? ` (${partner.label}, 기운 ${partner.dayElement})` : ''} / MBTI ${profile.partnerMbti || '모름'}
- 알고 지낸 기간: ${profile.duration || '미입력'}
- 연락 빈도: ${profile.contactLabel || '미입력'}
- 고민: ${concerns || '미입력'}
- 상황 설명: ${profile.situation || '(없음)'}
${report ? `- 궁합 점수: ${report.compat.score}점 (${report.compat.grade.label}) / 성향: ${report.tone.type.label}` : ''}`;
}

// 대화 한 턴을 AI로 생성. 실패하면 null 을 반환해 로컬 모드로 폴백.
export async function askAI(character, profile, history, userText, report) {
  if (!aiStatus.available) return null;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: buildSystemPrompt(character, profile, report),
        messages: [...history, { role: 'user', content: userText }].slice(-16),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.text || '').trim() || null;
  } catch {
    return null;
  }
}
