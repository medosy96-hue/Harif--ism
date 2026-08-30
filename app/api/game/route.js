import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getJSON, setJSON, setJSONIfAbsent, hsetJSON, hgetAllJSON } from '@/lib/redis';
import { FIELD_DEFS, ROOM_TTL_SECONDS, MAX_PLAYERS, MAX_BOTS } from '@/lib/constants';
import { isCorrect } from '@/lib/scoring';

export const dynamic = 'force-dynamic'; // never cache — this is polled live game state

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function err(status, message) {
  return NextResponse.json({ error: message }, { status });
}

function metaKey(code) { return `room:${code}:meta`; }
function playersKey(code) { return `room:${code}:players`; }
function scoresKey(code) { return `room:${code}:scores`; }
function answersKey(code, n) { return `room:${code}:round:${n}:answers`; }
function winnerKey(code, n) { return `room:${code}:round:${n}:winner`; }
function summaryKey(code, n) { return `room:${code}:round:${n}:summary`; }

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = (searchParams.get('code') || '').toUpperCase();
    const round = searchParams.get('round');
    if (!code) return err(400, 'كود الغرفة مطلوب');

    const meta = await getJSON(metaKey(code));
    if (!meta) return err(404, 'لم يتم العثور على الغرفة');

    const players = await hgetAllJSON(playersKey(code));
    const scores = await hgetAllJSON(scoresKey(code));

    let summary = null, winner = null;
    if (round) {
      summary = await getJSON(summaryKey(code, round));
      winner = await getJSON(winnerKey(code, round));
    }

    return NextResponse.json({ meta, players, scores, summary, winner });
  } catch (e) {
    console.error(e);
    return err(500, 'خطأ بالخادم، تحقق من إعداد قاعدة البيانات (Redis)');
  }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'طلب غير صالح'); }
  const { type } = body || {};

  try {
    switch (type) {
      case 'create': return await handleCreate(body);
      case 'join': return await handleJoin(body);
      case 'addBot': return await handleAddBot(body);
      case 'start': return await handleStart(body);
      case 'chooseLetter': return await handleChooseLetter(body);
      case 'submit': return await handleSubmit(body);
      case 'computeSummary': return await handleComputeSummary(body);
      case 'reviewAnswer': return await handleReviewAnswer(body);
      case 'nextRound': return await handleNextRound(body);
      case 'endGame': return await handleEndGame(body);
      default: return err(400, 'نوع طلب غير معروف');
    }
  } catch (e) {
    console.error(e);
    return err(500, 'خطأ بالخادم، تحقق من إعداد قاعدة البيانات (Redis) — راجع ملف README');
  }
}

async function handleCreate({ name }) {
  const cleanName = (name || '').trim().slice(0, 24);
  if (!cleanName) return err(400, 'الاسم مطلوب');

  let code = null;
  for (let i = 0; i < 6; i++) {
    const candidate = genCode();
    const exists = await getJSON(metaKey(candidate));
    if (!exists) { code = candidate; break; }
  }
  if (!code) return err(500, 'تعذّر توليد كود فريد، حاول مجددًا');

  const pid = randomUUID();
  const meta = {
    hostId: pid, hostName: cleanName, status: 'lobby',
    roundDuration: 240, currentLetter: null, roundNumber: 0, createdAt: Date.now(),
    usedLetters: []
  };
  await setJSON(metaKey(code), meta, ROOM_TTL_SECONDS);
  await hsetJSON(playersKey(code), pid, { name: cleanName, joinedAt: Date.now() }, ROOM_TTL_SECONDS);

  return NextResponse.json({ code, pid, meta });
}

async function handleJoin({ code, name }) {
  const cleanCode = (code || '').trim().toUpperCase();
  const cleanName = (name || '').trim().slice(0, 24);
  if (!cleanCode || !cleanName) return err(400, 'الكود والاسم مطلوبان');

  const meta = await getJSON(metaKey(cleanCode));
  if (!meta) return err(404, 'لم يتم العثور على الغرفة، تأكد من الكود');
  if (meta.status !== 'lobby') return err(400, 'اللعبة بدأت بالفعل، لا يمكن الانضمام الآن');

  const players = await hgetAllJSON(playersKey(cleanCode));
  if (Object.keys(players).length >= MAX_PLAYERS) return err(400, 'الغرفة ممتلئة (20 لاعبًا كحد أقصى)');

  const pid = randomUUID();
  await hsetJSON(playersKey(cleanCode), pid, { name: cleanName, joinedAt: Date.now() }, ROOM_TTL_SECONDS);

  return NextResponse.json({ pid, meta });
}

async function handleAddBot({ code, pid }) {
  const meta = await getJSON(metaKey(code));
  if (!meta) return err(404, 'لم يتم العثور على الغرفة');
  if (meta.hostId !== pid) return err(403, 'فقط المضيف يقدر يضيف لاعبين تجريبيين');

  const players = await hgetAllJSON(playersKey(code));
  const botCount = Object.values(players).filter(p => p.isBot).length;
  if (botCount >= MAX_BOTS) return err(400, 'وصلت للحد الأقصى: 10 بوتات');
  if (Object.keys(players).length >= MAX_PLAYERS) return err(400, 'الغرفة ممتلئة');

  const botPid = 'bot_' + randomUUID();
  await hsetJSON(playersKey(code), botPid, { name: `لاعب تجريبي ${botCount + 1}`, joinedAt: Date.now(), isBot: true }, ROOM_TTL_SECONDS);

  return NextResponse.json({ ok: true });
}

async function handleStart({ code, pid, roundDuration }) {
  const meta = await getJSON(metaKey(code));
  if (!meta) return err(404, 'لم يتم العثور على الغرفة');
  if (meta.hostId !== pid) return err(403, 'فقط المضيف يقدر يبدأ اللعبة');

  meta.status = 'letter_select';
  meta.roundNumber = (meta.roundNumber || 0) + 1;
  if (roundDuration) meta.roundDuration = roundDuration;
  await setJSON(metaKey(code), meta, ROOM_TTL_SECONDS);

  return NextResponse.json({ meta });
}

async function handleChooseLetter({ code, pid, letter }) {
  const meta = await getJSON(metaKey(code));
  if (!meta) return err(404, 'لم يتم العثور على الغرفة');
  if (meta.hostId !== pid) return err(403, 'فقط المضيف يقدر يختار الحرف');
  if ((meta.usedLetters || []).includes(letter)) return err(400, 'هذا الحرف مستخدم بالفعل بهذه اللعبة، اختر حرفًا آخر');

  meta.currentLetter = letter;
  meta.status = 'playing';
  meta.roundStartTime = Date.now();
  meta.usedLetters = [...(meta.usedLetters || []), letter];
  await setJSON(metaKey(code), meta, ROOM_TTL_SECONDS);

  return NextResponse.json({ meta });
}

async function handleSubmit({ code, pid, roundNumber, answers, name, tryClaim, reason }) {
  const meta = await getJSON(metaKey(code));
  if (!meta) return err(404, 'لم يتم العثور على الغرفة');

  await hsetJSON(answersKey(code, roundNumber), pid, { ...answers, name, submittedAt: Date.now() }, ROOM_TTL_SECONDS);

  let claimed = false;
  let winner = null;
  const wKey = winnerKey(code, roundNumber);

  if (tryClaim) {
    const winObj = { pid, name, type: reason === 'timeout' ? 'timeout' : 'finish', time: Date.now() };
    claimed = await setJSONIfAbsent(wKey, winObj, ROOM_TTL_SECONDS);
    winner = claimed ? winObj : await getJSON(wKey);
  } else {
    winner = await getJSON(wKey);
  }

  return NextResponse.json({ claimed, winner });
}

async function handleComputeSummary({ code, pid, roundNumber }) {
  const meta = await getJSON(metaKey(code));
  if (!meta) return err(404, 'لم يتم العثور على الغرفة');
  if (meta.hostId !== pid) return err(403, 'فقط المضيف يقدر يحسب النتائج');

  const existing = await getJSON(summaryKey(code, roundNumber));
  if (existing) return NextResponse.json({ summary: existing, alreadyComputed: true });

  // Atomic lock so two near-simultaneous triggers (e.g. the finish click and the
  // background poller both noticing the round ended) can never both score the round.
  const lockKey = `room:${code}:round:${roundNumber}:computelock`;
  const gotLock = await setJSONIfAbsent(lockKey, { by: pid, time: Date.now() }, ROOM_TTL_SECONDS);
  if (!gotLock) {
    await new Promise((r) => setTimeout(r, 500));
    const summaryNow = await getJSON(summaryKey(code, roundNumber));
    if (summaryNow) return NextResponse.json({ summary: summaryNow, alreadyComputed: true });
    return err(409, 'جاري احتساب النتائج، حاول خلال لحظات');
  }

  const players = await hgetAllJSON(playersKey(code));
  const answers = await hgetAllJSON(answersKey(code, roundNumber));
  const winner = await getJSON(winnerKey(code, roundNumber));
  const scores = await hgetAllJSON(scoresKey(code));
  const letter = meta.currentLetter;

  const perPlayer = {};
  for (const [playerId, p] of Object.entries(players)) {
    const ans = answers[playerId] || { ism: '', hayawan: '', nabat: '', jamad: '', balad: '' };
    let pts = 0;
    const flags = {};
    for (const f of FIELD_DEFS) {
      const ok = isCorrect(ans[f.key], letter);
      flags[f.key] = ok;
      if (ok) pts += 10;
    }
    const displayName = ans.name || p.name;
    perPlayer[playerId] = { name: displayName, answers: ans, flags, points: pts };

    const prevTotal = (scores[playerId] && scores[playerId].total) || 0;
    const newScore = { name: displayName, total: prevTotal + pts };
    scores[playerId] = newScore;
    await hsetJSON(scoresKey(code), playerId, newScore, ROOM_TTL_SECONDS);
  }

  const summary = {
    letter, roundNumber, perPlayer,
    winnerPid: winner ? winner.pid : null,
    winnerName: winner ? winner.name : null,
    winnerType: winner ? winner.type : 'timeout'
  };
  await setJSON(summaryKey(code, roundNumber), summary, ROOM_TTL_SECONDS);

  meta.status = 'round_results';
  await setJSON(metaKey(code), meta, ROOM_TTL_SECONDS);

  return NextResponse.json({ summary });
}

async function handleReviewAnswer({ code, pid, roundNumber, playerId, fieldKey, correct }) {
  const meta = await getJSON(metaKey(code));
  if (!meta) return err(404, 'لم يتم العثور على الغرفة');
  if (meta.hostId !== pid) return err(403, 'فقط المضيف يقدر يعدّل النتائج');

  const summary = await getJSON(summaryKey(code, roundNumber));
  if (!summary) return err(404, 'لم يتم احتساب النتائج بعد');
  const player = summary.perPlayer[playerId];
  if (!player) return err(404, 'لاعب غير موجود بهذه الجولة');

  const wasCorrect = !!player.flags[fieldKey];
  const nowCorrect = !!correct;
  if (wasCorrect === nowCorrect) return NextResponse.json({ summary });

  const delta = nowCorrect ? 10 : -10;
  player.flags[fieldKey] = nowCorrect;
  player.points += delta;
  summary.perPlayer[playerId] = player;
  await setJSON(summaryKey(code, roundNumber), summary, ROOM_TTL_SECONDS);

  const scores = await hgetAllJSON(scoresKey(code));
  const prev = scores[playerId] || { name: player.name, total: 0 };
  const updatedScore = { name: prev.name, total: (prev.total || 0) + delta };
  await hsetJSON(scoresKey(code), playerId, updatedScore, ROOM_TTL_SECONDS);

  return NextResponse.json({ summary });
}

async function handleNextRound({ code, pid }) {
  const meta = await getJSON(metaKey(code));
  if (!meta) return err(404, 'لم يتم العثور على الغرفة');
  if (meta.hostId !== pid) return err(403, 'فقط المضيف يقدر يبدأ جولة جديدة');

  meta.status = 'letter_select';
  meta.roundNumber = (meta.roundNumber || 0) + 1;
  await setJSON(metaKey(code), meta, ROOM_TTL_SECONDS);

  return NextResponse.json({ meta });
}

async function handleEndGame({ code, pid }) {
  const meta = await getJSON(metaKey(code));
  if (!meta) return err(404, 'لم يتم العثور على الغرفة');
  if (meta.hostId !== pid) return err(403, 'فقط المضيف يقدر ينهي اللعبة');

  meta.status = 'final';
  await setJSON(metaKey(code), meta, ROOM_TTL_SECONDS);

  return NextResponse.json({ meta });
}
