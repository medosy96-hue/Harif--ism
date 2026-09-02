'use client';

import { useEffect, useRef, useState } from 'react';
import { ARABIC_LETTERS, FIELD_DEFS } from '@/lib/constants';

const SESSION_KEY = 'harfIsmSession';
const EMPTY_ANSWERS = { ism: '', hayawan: '', nabat: '', jamad: '', balad: '' };

// Jeem Jawab — the sibling game
const JEEM_JAWAB_URL = 'https://jeem-jawab.vercel.app/';

/* ---------------- storage / api helpers ---------------- */
function saveSession(data) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (e) {} }
function loadSession() { try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

async function api(type, payload) {
  const res = await fetch('/api/game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع');
  return data;
}
async function apiGet(code, round) {
  const url = `/api/game?code=${encodeURIComponent(code)}${round ? `&round=${round}` : ''}`;
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'تعذّر الاتصال بالخادم');
  return data;
}

function fmtTime(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function initials(name) { return (name || '؟').trim().slice(0, 1); }
async function copyText(text, onDone) {
  try { await navigator.clipboard.writeText(text); onDone && onDone(true); }
  catch (e) { window.prompt('انسخ يدويًا:', text); onDone && onDone(false); }
}

/* ================= MAIN APP ================= */
export default function HarfIsmGame() {
  const [view, setViewState] = useState('boot');
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null); // {type:'create'|'join'|'rules'}
  const [modalBusy, setModalBusy] = useState(false);
  const [prefillCode, setPrefillCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');

  const [code, setCodeState] = useState(null);
  const [pid, setPidState] = useState(null);
  const [isHost, setIsHostState] = useState(false);
  const [playerName, setPlayerNameState] = useState('');
  const [meta, setMetaState] = useState(null);
  const [players, setPlayers] = useState({});
  const [scores, setScores] = useState({});
  const [roster, setRosterState] = useState([]);

  const [localAnswers, setLocalAnswers] = useState(EMPTY_ANSWERS);
  const [remainingMs, setRemainingMs] = useState(0);
  const [roundBanner, setRoundBanner] = useState(null); // {name, type}
  const [roundSummary, setRoundSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(false);

  // refs mirror the "live" values so intervals/async callbacks never read stale state
  const viewRef = useRef('boot');
  const codeRef = useRef(null);
  const pidRef = useRef(null);
  const isHostRef = useRef(false);
  const playerNameRef = useRef('');
  const metaRef = useRef(null);
  const rosterRef = useRef([]);
  const hasSubmittedRef = useRef(false);
  const localAnswersRef = useRef(EMPTY_ANSWERS);
  const toastTimerRef = useRef(null);

  function goto(v) { viewRef.current = v; setViewState(v); }
  function setCodeBoth(v) { codeRef.current = v; setCodeState(v); }
  function setPidBoth(v) { pidRef.current = v; setPidState(v); }
  function setIsHostBoth(v) { isHostRef.current = v; setIsHostState(v); }
  function setPlayerNameBoth(v) { playerNameRef.current = v; setPlayerNameState(v); }
  function setMetaBoth(v) { metaRef.current = v; setMetaState(v); }
  function setRosterBoth(v) { rosterRef.current = v; setRosterState(v); }

  function showToast(msg, ms = 3000) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }

  /* ---------------- bootstrap on load ---------------- */
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) { setPrefillCode(roomParam.toUpperCase()); setJoinCodeInput(roomParam.toUpperCase()); }
      } catch (e) {}

      const session = loadSession();
      if (session && session.code && session.pid) {
        try {
          const data = await apiGet(session.code);
          if (data.meta && data.players && data.players[session.pid]) {
            setCodeBoth(session.code);
            setPidBoth(session.pid);
            const host = data.meta.hostId === session.pid;
            setIsHostBoth(host);
            setPlayerNameBoth(data.players[session.pid].name);
            setMetaBoth(data.meta);
            setPlayers(data.players);
            if (host) setRosterBoth(Object.entries(data.players).map(([id, p]) => ({ pid: id, name: p.name })));
            routeByStatus(data.meta.status);
            return;
          }
        } catch (e) { /* room gone / expired — fall through to home */ }
        clearSession();
      }
      goto('home');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function routeByStatus(status) {
    if (status === 'lobby') goto('lobby');
    else if (status === 'letter_select') goto('letterSelect');
    else if (status === 'playing') { resetRoundLocalState(); goto('playing'); }
    else if (status === 'round_results') goto('roundResults');
    else if (status === 'final') goto('final');
    else goto('lobby');
  }

  function resetRoundLocalState() {
    hasSubmittedRef.current = false;
    localAnswersRef.current = { ...EMPTY_ANSWERS };
    setLocalAnswers({ ...EMPTY_ANSWERS });
    setRoundBanner(null);
    setRoundSummary(null);
    setSummaryError(false);
  }

  function goHome() {
    clearSession();
    setCodeBoth(null); setPidBoth(null); setIsHostBoth(false); setPlayerNameBoth('');
    setMetaBoth(null); setRosterBoth([]); setPlayers({}); setScores({});
    goto('home');
  }

  /* ================= HOME / CREATE / JOIN ================= */
  async function handleCreateConfirm(name) {
    setModalBusy(true);
    try {
      const data = await api('create', { name });
      setCodeBoth(data.code); setPidBoth(data.pid); setIsHostBoth(true); setPlayerNameBoth(name);
      setMetaBoth(data.meta); setRosterBoth([{ pid: data.pid, name }]);
      saveSession({ code: data.code, pid: data.pid });
      setModal(null);
      goto('lobby');
    } catch (e) {
      showToast('❌ ' + e.message);
    } finally {
      setModalBusy(false);
    }
  }

  async function handleJoinConfirm(codeInput, name) {
    const cleanCode = codeInput.trim().toUpperCase();
    if (!cleanCode) { showToast('اكتب كود الغرفة أولاً'); return; }
    setModalBusy(true);
    try {
      const data = await api('join', { code: cleanCode, name });
      setCodeBoth(cleanCode); setPidBoth(data.pid); setIsHostBoth(false); setPlayerNameBoth(name);
      setMetaBoth(data.meta);
      saveSession({ code: cleanCode, pid: data.pid });
      setModal(null);
      goto('lobby');
    } catch (e) {
      showToast('❌ ' + e.message);
    } finally {
      setModalBusy(false);
    }
  }

  /* ================= LOBBY ================= */
  useEffect(() => {
    if (view !== 'lobby') return;
    let cancelled = false;
    async function tick() {
      try {
        const data = await apiGet(codeRef.current);
        if (cancelled) return;
        setPlayers(data.players || {});
        if (!isHostRef.current && data.meta && data.meta.status === 'letter_select') {
          setMetaBoth(data.meta);
          goto('letterSelect');
        }
      } catch (e) {}
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [view]);

  async function handleStartGame(roundDurationSeconds) {
    try {
      const data = await api('start', { code: codeRef.current, pid: pidRef.current, roundDuration: roundDurationSeconds });
      setMetaBoth(data.meta);
      setRosterBoth(Object.entries(players).map(([id, p]) => ({ pid: id, name: p.name })));
      goto('letterSelect');
    } catch (e) { showToast('❌ ' + e.message); }
  }

  async function handleAddBot() {
    try {
      await api('addBot', { code: codeRef.current, pid: pidRef.current });
      showToast('تمت إضافة لاعب تجريبي ✅', 1500);
      const data = await apiGet(codeRef.current);
      setPlayers(data.players || {});
    } catch (e) { showToast('❌ ' + e.message); }
  }

  /* ================= LETTER SELECT ================= */
  useEffect(() => {
    if (view !== 'letterSelect' || isHostRef.current) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const data = await apiGet(codeRef.current);
        if (cancelled) return;
        if (data.meta && data.meta.status === 'playing') {
          setMetaBoth(data.meta);
          resetRoundLocalState();
          goto('playing');
        }
      } catch (e) {}
    }, 1200);
    return () => { cancelled = true; clearInterval(id); };
  }, [view]);

  async function handleChooseLetter(letter) {
    try {
      const data = await api('chooseLetter', { code: codeRef.current, pid: pidRef.current, letter });
      setMetaBoth(data.meta);
      resetRoundLocalState();
      goto('playing');
    } catch (e) { showToast('❌ ' + e.message); }
  }

  /* ================= PLAYING ================= */
  async function doSubmit(reason, tryClaim) {
    if (hasSubmittedRef.current) return null;
    hasSubmittedRef.current = true;
    try {
      const data = await api('submit', {
        code: codeRef.current, pid: pidRef.current,
        roundNumber: metaRef.current.roundNumber,
        answers: localAnswersRef.current,
        name: playerNameRef.current,
        tryClaim, reason,
      });
      return data;
    } catch (e) {
      hasSubmittedRef.current = false; // allow retry
      showToast('❌ ' + e.message);
      return null;
    }
  }

  async function handleRoundEnd(winnerObj) {
    if (viewRef.current !== 'playing') return;
    setRoundBanner(winnerObj);
    if (isHostRef.current) {
      try {
        await api('computeSummary', { code: codeRef.current, pid: pidRef.current, roundNumber: metaRef.current.roundNumber });
      } catch (e) { /* another attempt or the poller will resolve it */ }
    }
    goto('roundResults');
  }

  async function handleFinishClick() {
    const data = await doSubmit('finish', true);
    if (data && data.winner) handleRoundEnd(data.winner);
  }

  useEffect(() => {
    if (view !== 'playing' || !meta) return;
    let cancelled = false;

    const clockId = setInterval(() => {
      const m = metaRef.current;
      if (!m || !m.roundStartTime) return;
      const durMs = m.roundDuration * 1000;
      const remaining = durMs - (Date.now() - m.roundStartTime);
      setRemainingMs(Math.max(0, remaining));
      if (remaining <= 0 && !hasSubmittedRef.current) {
        doSubmit('timeout', true).then((data) => { if (data && data.winner) handleRoundEnd(data.winner); });
      }
    }, 250);

    const pollId = setInterval(async () => {
      if (cancelled || viewRef.current !== 'playing') return;
      try {
        const data = await apiGet(codeRef.current, metaRef.current.roundNumber);
        if (cancelled || viewRef.current !== 'playing') return;
        if (data.winner) {
          if (!hasSubmittedRef.current) {
            const subData = await doSubmit('roundEnded', false);
            handleRoundEnd((subData && subData.winner) || data.winner);
          } else {
            handleRoundEnd(data.winner);
          }
        }
      } catch (e) {}
    }, 1200);

    return () => { cancelled = true; clearInterval(clockId); clearInterval(pollId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function updateAnswer(key, value) {
    const next = { ...localAnswersRef.current, [key]: value };
    localAnswersRef.current = next;
    setLocalAnswers(next);
  }

  /* ================= ROUND RESULTS ================= */
  useEffect(() => {
    if (view !== 'roundResults') return;
    let cancelled = false;
    let tries = 0;

    async function fetchSummary() {
      try {
        const data = await apiGet(codeRef.current, metaRef.current.roundNumber);
        if (cancelled) return;
        if (data.summary) { setRoundSummary(data.summary); return; }
        tries++;
        if (tries < 8) setTimeout(fetchSummary, 800);
        else setSummaryError(true);
      } catch (e) {
        tries++;
        if (tries < 8) setTimeout(fetchSummary, 800);
        else setSummaryError(true);
      }
    }
    fetchSummary();

    let pollId = null;
    if (!isHostRef.current) {
      pollId = setInterval(async () => {
        try {
          const data = await apiGet(codeRef.current, metaRef.current.roundNumber);
          if (cancelled) return;
          if (data.summary) setRoundSummary(data.summary); // reflect host's live corrections
          if (data.meta && data.meta.status !== 'round_results') {
            setMetaBoth(data.meta);
            if (data.meta.status === 'letter_select') { resetRoundLocalState(); goto('letterSelect'); }
            else if (data.meta.status === 'final') goto('final');
          }
        } catch (e) {}
      }, 1500);
    }
    return () => { cancelled = true; if (pollId) clearInterval(pollId); };
  }, [view]);

  async function handleNewRound() {
    try {
      const data = await api('nextRound', { code: codeRef.current, pid: pidRef.current });
      setMetaBoth(data.meta);
      resetRoundLocalState();
      goto('letterSelect');
    } catch (e) { showToast('❌ ' + e.message); }
  }
  async function handleEndGame() {
    try {
      const data = await api('endGame', { code: codeRef.current, pid: pidRef.current });
      setMetaBoth(data.meta);
      goto('final');
    } catch (e) { showToast('❌ ' + e.message); }
  }
  async function handleToggleAnswer(playerId, fieldKey, newCorrect) {
    try {
      const data = await api('reviewAnswer', {
        code: codeRef.current, pid: pidRef.current, roundNumber: metaRef.current.roundNumber,
        playerId, fieldKey, correct: newCorrect,
      });
      setRoundSummary(data.summary);
    } catch (e) { showToast('❌ ' + e.message); }
  }

  /* ================= FINAL ================= */
  useEffect(() => {
    if (view !== 'final') return;
    (async () => {
      try {
        const data = await apiGet(codeRef.current);
        setScores(data.scores || {});
      } catch (e) {}
    })();
  }, [view]);

  /* ================= RENDER ================= */
  return (
    <>
      <div id="flag-rule"><span className="s1"></span><span className="s2"></span><span className="s3"></span></div>
      <div id="app-root">
        <Header />
        {view === 'boot' && <div className="card center"><p className="muted">جاري التحميل...</p></div>}
        {view === 'home' && (
          <HomeView
            prefillCode={prefillCode}
            joinCodeInput={joinCodeInput}
            setJoinCodeInput={setJoinCodeInput}
            onCreate={() => setModal({ type: 'create' })}
            onJoin={(c) => setModal({ type: 'join', code: c })}
            onRules={() => setModal({ type: 'rules' })}
          />
        )}
        {view === 'lobby' && meta && (
          <LobbyView
            code={code} meta={meta} isHost={isHost} players={players}
            onDurationChange={(sec) => { const m = { ...metaRef.current, roundDuration: sec }; setMetaBoth(m); }}
            onStart={handleStartGame}
            onAddBot={handleAddBot}
            onCopyCode={() => copyText(code, (ok) => showToast(ok ? 'تم النسخ ✅' : 'انسخ يدويًا من النافذة'))}
            onCopyLink={() => {
              const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
              copyText(url, (ok) => showToast(ok ? 'تم نسخ رابط الدعوة ✅' : 'انسخ يدويًا من النافذة'));
            }}
          />
        )}
        {view === 'letterSelect' && meta && (
          <LetterSelectView isHost={isHost} meta={meta} onChoose={handleChooseLetter} />
        )}
        {view === 'playing' && meta && (
          <PlayingView
            letter={meta.currentLetter}
            remainingMs={remainingMs}
            roundDurationMs={meta.roundDuration * 1000}
            answers={localAnswers}
            onChange={updateAnswer}
            onFinish={handleFinishClick}
            disabled={hasSubmittedRef.current}
            banner={roundBanner}
          />
        )}
        {view === 'roundResults' && (
          <RoundResultsView
            summary={roundSummary} error={summaryError} isHost={isHost}
            onNewRound={handleNewRound} onEndGame={handleEndGame}
            onToggleAnswer={handleToggleAnswer}
          />
        )}
        {view === 'final' && <FinalView scores={scores} onHome={goHome} />}
      </div>

      {modal && (
        <Modal
          modal={modal}
          busy={modalBusy}
          onClose={() => !modalBusy && setModal(null)}
          onCreate={handleCreateConfirm}
          onJoin={handleJoinConfirm}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

/* ================= SUBCOMPONENTS ================= */

function Header() {
  const seq = ['ح', 'ا', 'س', 'ب', 'ع'];
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setFlip(true);
      setTimeout(() => { setI((n) => (n + 1) % seq.length); setFlip(false); }, 320);
    }, 2200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="header">
      <div className={`logo-tile${flip ? ' flip' : ''}`}><span>{seq[i]}</span></div>
      <div className="wordmark">حرف اسم <span className="dot"></span></div>
    </div>
  );
}

function GamePromoCard({ href }) {
  return (
    <a className="game-promo" href={href} target="_blank" rel="noopener noreferrer">
      <div className="gp-icon">؟</div>
      <div className="gp-title">ج جواب <span className="star">★★★</span></div>
      <div className="gp-tagline">اسأل • جاوب • نافس</div>
      <div className="gp-desc">20 سؤالًا متنوعًا • حتى 20 لاعبًا • 10 نقاط لكل إجابة صحيحة</div>
      <div className="gp-cta">جرّب لعبة ج جواب ←</div>
    </a>
  );
}
function GamePromoCard({ href }) {
  return (
    <a className="game-promo" href={href} target="_blank" rel="noopener noreferrer">
      <img src="/jeem-jawab-preview.png" alt="ج جواب" className="gp-image" />
      <div className="gp-cta">جرّب لعبة ج جواب ←</div>
    </a>
  );
}

function HomeView({ prefillCode, joinCodeInput, setJoinCodeInput, onCreate, onJoin, onRules }) {
  return (
    <>
      <div className="card">
        <div className="big-letter-tile" style={{ width: 76, height: 76, marginBottom: 16 }}>
          <span style={{ fontSize: 36 }}>ب</span>
        </div>
        <div className="hero-title">تحدّي الحروف السريع</div>
        <p className="hero-sub">اختاروا حرفًا، وسابقوا الوقت لتعبئة اسم وحيوان ونبات وجماد وبلاد تبدأ كلها بنفس الحرف. أول من ينهي يفوز بالجولة!</p>
      </div>
      <div className="stack">
        <button className="btn btn-primary" onClick={onCreate}>🎮 إنشاء لعبة</button>
        <div className="card" style={{ padding: 16 }}>
          <label className="field-label">الانضمام إلى غرفة بكود</label>
          <div className="stack">
            <input
              type="text" maxLength={6} placeholder="أدخل كود الغرفة"
              style={{ textAlign: 'center', letterSpacing: 4, fontWeight: 800, textTransform: 'uppercase' }}
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
            />
            <button className="btn btn-outline" onClick={() => { if (!joinCodeInput.trim()) return; onJoin(joinCodeInput); }}>↩️ انضمام للعبة</button>
          </div>
        </div>

        <GamePromoCard href={JEEM_JAWAB_URL} />
        <GamePromoCard href={JEEM_JAWAB_URL} />
        <button className="btn btn-ghost" onClick={onRules}>📜 قوانين اللعبة</button>
      </div>
      <footer className="tiny muted">حرف اسم — لعبة جماعية أونلاين حتى 20 لاعبًا</footer>
    </>
  );
}

function LobbyView({ code, meta, isHost, players, onDurationChange, onStart, onAddBot, onCopyCode, onCopyLink }) {
  const [duration, setDuration] = useState(Math.round((meta.roundDuration || 240) / 60));
  const entries = Object.entries(players || {});
  const botCount = entries.filter(([, p]) => p.isBot).length;
  const enough = entries.length >= 2;

  return (
    <>
      <div className="card">
        <p className="muted center" style={{ marginBottom: 8 }}>كود الغرفة — شاركه مع أصحابك</p>
        <div className="code-badge">{code}</div>
        <div className="copy-row" style={{ marginTop: 12 }}>
          <button className="btn btn-outline" onClick={onCopyCode}>📋 نسخ الكود</button>
          <button className="btn btn-outline" onClick={onCopyLink}>🔗 نسخ رابط الدعوة</button>
        </div>
        <p className="muted center" style={{ marginTop: 10, fontSize: 12.5 }}>شارك الكود أو الرابط مع أصحابك للانضمام مباشرة</p>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ fontSize: 15 }}>اللاعبون</h3>
          <span className="muted">{entries.length} / 20</span>
        </div>
        <ul className="player-list">
          {entries.length === 0 && <li className="muted">جاري التحميل...</li>}
          {entries.map(([pidKey, p]) => (
            <li key={pidKey}>
              <span className="player-avatar">{initials(p.name)}</span>
              <span>{p.name}</span>
              {pidKey === meta.hostId && <span className="host-tag">المضيف</span>}
              {p.isBot && <span className="bot-tag">🤖 تجريبي</span>}
            </li>
          ))}
        </ul>
        {isHost && (
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10, width: '100%' }} disabled={botCount >= 10 || entries.length >= 20} onClick={onAddBot}>
            🤖 أضف لاعبًا تجريبيًا ({botCount}/10)
          </button>
        )}
      </div>

      {isHost ? (
        <>
          <div className="card">
            <label className="field-label">مدة الجولة</label>
            <div className="slider-row">
              <input type="range" min={3} max={10} step={1} value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10))}
                onMouseUp={() => onDurationChange(duration * 60)}
                onTouchEnd={() => onDurationChange(duration * 60)}
              />
              <div className="duration-val">{duration} د</div>
            </div>
          </div>
          <button className="btn btn-primary" disabled={!enough} onClick={() => onStart(duration * 60)}>ابدأ اللعبة 🚀</button>
          <p className="muted center" style={{ marginTop: 8 }}>
            {enough ? `${entries.length} لاعبين جاهزون للبدء` : 'بانتظار لاعب واحد على الأقل للانضمام...'}
          </p>
        </>
      ) : (
        <div className="card center">
          <p style={{ fontWeight: 700, marginBottom: 4 }}>⏳ بانتظار المضيف لبدء اللعبة</p>
          <p className="muted">المضيف: {meta.hostName}</p>
        </div>
      )}
    </>
  );
}

function LetterSelectView({ isHost, meta, onChoose }) {
  const [waitLetter, setWaitLetter] = useState(ARABIC_LETTERS[0]);
  const usedLetters = meta.usedLetters || [];
  useEffect(() => {
    if (isHost) return;
    let i = 0;
    const id = setInterval(() => { i++; setWaitLetter(ARABIC_LETTERS[i % ARABIC_LETTERS.length]); }, 450);
    return () => clearInterval(id);
  }, [isHost]);

  if (isHost) {
    return (
      <>
        <div className="card center">
          <h3 style={{ fontSize: 16, marginBottom: 4 }}>اختر حرف الجولة {meta.roundNumber}</h3>
          <p className="muted">بمجرد اختيارك، تبدأ الجولة فورًا لجميع اللاعبين</p>
          {usedLetters.length > 0 && <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>الحروف المستخدمة سابقًا معطّلة (رمادية)</p>}
        </div>
        <div className="card">
          <div className="letter-grid">
            {ARABIC_LETTERS.map((l) => {
              const used = usedLetters.includes(l);
              return (
                <button
                  key={l}
                  className="letter-tile"
                  disabled={used}
                  style={used ? { background: 'var(--line)', color: 'var(--ink-soft)', boxShadow: 'none', cursor: 'not-allowed' } : undefined}
                  onClick={() => !used && onChoose(l)}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="card center">
      <div className="big-letter-tile pulse"><span>{waitLetter}</span></div>
      <p style={{ fontWeight: 700 }}>المضيف يختار الحرف الآن...</p>
      <p className="muted">استعد لكتابة اسم، حيوان، نبات، جماد، وبلاد!</p>
    </div>
  );
}

function PlayingView({ letter, remainingMs, roundDurationMs, answers, onChange, onFinish, disabled, banner }) {
  const pct = Math.max(0, Math.min(100, (remainingMs / roundDurationMs) * 100));
  const allFilled = FIELD_DEFS.every((f) => (answers[f.key] || '').trim().length > 0);
  return (
    <>
      <div className="card center" style={{ padding: 16 }}>
        <div className="big-letter-tile" style={{ width: 70, height: 70, marginBottom: 8 }}><span style={{ fontSize: 32 }}>{letter}</span></div>
        <div className="timer-text">{fmtTime(remainingMs)}</div>
        <div className="timer-bar-wrap"><div className="timer-bar" style={{ width: `${pct}%`, background: pct < 20 ? 'var(--red)' : 'var(--green)' }}></div></div>
      </div>

      {banner && (
        <div className="banner banner-win">
          {banner.type === 'timeout' ? '⏰ انتهى الوقت! جاري احتساب النتائج...' : `🏁 ${banner.name} أنهى الجولة أولاً! جاري احتساب النتائج...`}
        </div>
      )}

      <div className="card">
        {FIELD_DEFS.map((f) => (
          <div className="field-block" key={f.key}>
            <div className="field-icon-label">
              <span className="ic">{f.icon}</span>
              <label className="field-label" style={{ margin: 0 }}>{f.label} يبدأ بحرف {letter}</label>
            </div>
            <input
              type="text" placeholder="اكتب هنا..." disabled={disabled}
              value={answers[f.key]} onChange={(e) => onChange(f.key, e.target.value)}
            />
          </div>
        ))}
        <button className="btn btn-primary" disabled={disabled || !allFilled} onClick={onFinish}>✅ إنهاء الجولة</button>
      </div>
    </>
  );
}

function RoundResultsView({ summary, error, isHost, onNewRound, onEndGame, onToggleAnswer }) {
  if (error) return <div className="card center"><p className="muted">تعذّر تحميل النتائج، حاول مجددًا لاحقًا.</p></div>;
  if (!summary) return <div className="card center"><p className="muted">جاري تحميل النتائج...</p></div>;

  const rows = Object.entries(summary.perPlayer).sort((a, b) => b[1].points - a[1].points);
  return (
    <>
      <div className="card center">
        <p className="muted">نتائج الجولة {summary.roundNumber} — الحرف</p>
        <div className="big-letter-tile" style={{ width: 64, height: 64, margin: '8px auto' }}><span style={{ fontSize: 28 }}>{summary.letter}</span></div>
        {summary.winnerName && <p style={{ fontWeight: 700, color: 'var(--green-deep)' }}>🏁 {summary.winnerName} أنهى الجولة أولاً</p>}
        {isHost && <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>دوس على أي كلمة لتصحيحها إذا كانت محتسبة غلط ✏️</p>}
      </div>
      <div className="card">
        {rows.map(([pidKey, p], idx) => {
          const isWinner = pidKey === summary.winnerPid;
          return (
            <div className={`result-row${isWinner ? ' win' : ''}`} key={pidKey}>
              <div className="result-row-top">
                <span className="rank-num">{idx + 1}</span>
                <span className="result-name">{p.name} {isWinner ? '⚡' : ''}</span>
                <span className="result-pts">{p.points} نقطة</span>
              </div>
              <div className="answers-mini">
                {FIELD_DEFS.map((f) => {
                  const val = p.answers[f.key] && p.answers[f.key].trim() ? p.answers[f.key] : '—';
                  const ok = p.flags[f.key];
                  if (isHost) {
                    return (
                      <button
                        key={f.key}
                        className={`ans-chip ${ok ? 'ok' : 'bad'}`}
                        style={{ border: 'none', cursor: 'pointer' }}
                        onClick={() => onToggleAnswer(pidKey, f.key, !ok)}
                        title="دوس للتبديل بين صح/غلط"
                      >
                        {f.icon} {val} {ok ? '✓' : '✕'}
                      </button>
                    );
                  }
                  return <span key={f.key} className={`ans-chip ${ok ? 'ok' : 'bad'}`}>{f.icon} {val}</span>;
                })}
              </div>
            </div>
          );
        })}
      </div>
      {isHost ? (
        <div className="stack">
          <button className="btn btn-primary" onClick={onNewRound}>🔤 جولة جديدة</button>
          <button className="btn btn-red" onClick={onEndGame}>🏆 إنهاء اللعبة وعرض النتائج</button>
        </div>
      ) : (
        <div className="card center"><p className="muted">بانتظار قرار المضيف...</p></div>
      )}
    </>
  );
}

function FinalView({ scores, onHome }) {
  const ranked = Object.entries(scores || {}).sort((a, b) => (b[1].total || 0) - (a[1].total || 0));
  const [first, second, third, ...rest] = ranked;
  return (
    <>
      <div className="card center"><h2 style={{ fontSize: 19 }}>🏆 النتائج النهائية</h2></div>
      {first && (
        <div className="winner-card">
          <span className="winner-cup">🏆</span>
          <div className="winner-name">{first[1].name}</div>
          <div className="winner-pts">{first[1].total} نقطة</div>
        </div>
      )}
      {(second || third) && (
        <div className="podium-2-3" style={{ marginTop: 10 }}>
          {second ? (
            <div className="mini-podium"><span className="cup">🥈</span><div className="nm">{second[1].name}</div><div className="pt">{second[1].total} نقطة</div></div>
          ) : <div></div>}
          {third ? (
            <div className="mini-podium"><span className="cup">🥉</span><div className="nm">{third[1].name}</div><div className="pt">{third[1].total} نقطة</div></div>
          ) : <div></div>}
        </div>
      )}
      {rest.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          {rest.map(([pidKey, p], idx) => (
            <div className="result-row" key={pidKey}>
              <div className="result-row-top">
                <span className="rank-num">{idx + 4}</span>
                <span className="result-name">{p.name}</span>
                <span className="result-pts">{p.total} نقطة</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-outline" style={{ marginTop: 18 }} onClick={onHome}>🏠 العودة للرئيسية</button>
    </>
  );
}

function Modal({ modal, busy, onClose, onCreate, onJoin }) {
  const [name, setName] = useState('');
  const [codeInput, setCodeInput] = useState(modal.code || '');

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        {modal.type === 'create' && (
          <>
            <div className="modal-title"><span>إنشاء لعبة جديدة</span><button className="modal-close" onClick={onClose}>✕</button></div>
            <div className="stack">
              <div>
                <label className="field-label">اسمك</label>
                <input type="text" maxLength={18} placeholder="مثال: أحمد" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => onCreate(name.trim())}>
                {busy ? '⏳ جاري الإنشاء...' : 'إنشاء الغرفة 🚀'}
              </button>
            </div>
          </>
        )}
        {modal.type === 'join' && (
          <>
            <div className="modal-title"><span>الانضمام إلى غرفة</span><button className="modal-close" onClick={onClose}>✕</button></div>
            <div className="stack">
              <div>
                <label className="field-label">كود الغرفة</label>
                <input type="text" maxLength={6} style={{ textTransform: 'uppercase', letterSpacing: 3, fontWeight: 800, textAlign: 'center' }}
                  value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className="field-label">اسمك</label>
                <input type="text" maxLength={18} placeholder="مثال: سارة" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <button className="btn btn-primary" disabled={busy || !name.trim() || !codeInput.trim()} onClick={() => onJoin(codeInput, name.trim())}>
                {busy ? '⏳ جاري الانضمام...' : 'انضمام ✅'}
              </button>
            </div>
          </>
        )}
        {modal.type === 'rules' && (
          <>
            <div className="modal-title"><span>قوانين اللعبة</span><button className="modal-close" onClick={onClose}>✕</button></div>
            <div className="rules-box">
              <h3>🎯 فكرة اللعبة</h3>
              <p>لعبة "حرف اسم" هي تحدٍّ جماعي: يتم اختيار حرف من الأبجدية العربية، وعلى كل لاعب أن يكتب كلمة تبدأ بهذا الحرف في خمس فئات: <b>اسم علم، حيوان، نبات، جماد، بلاد</b>.</p>
              <h3>👥 اللاعبون والغرفة</h3>
              <ol>
                <li>أي لاعب يمكنه إنشاء غرفة ليصبح "المضيف"، ويحصل على كود غرفة يشاركه مع أصحابه.</li>
                <li>يمكن أن تضم الغرفة الواحدة حتى 20 لاعبًا.</li>
                <li>ينضم اللاعبون عبر إدخال كود الغرفة من الصفحة الرئيسية، وينتظرون في غرفة الانتظار.</li>
              </ol>
              <h3>⏱️ مدة الجولة</h3>
              <p>يختار المضيف مدة كل جولة من غرفة الانتظار، بين 3 و10 دقائق، قبل بدء اللعب.</p>
              <h3>🔤 اختيار الحرف</h3>
              <p>عند بدء كل جولة، يختار المضيف حرفًا من الأبجدية العربية (لا يمكن اختيار نفس الحرف مرتين بنفس اللعبة)، فتظهر خانات التعبئة الخمس لجميع اللاعبين في الوقت نفسه.</p>
              <h3>✍️ سير الجولة</h3>
              <ol>
                <li>يملأ كل لاعب الخانات الخمس بكلمات تبدأ بالحرف المختار.</li>
                <li>أول لاعب يُنهي تعبئة جميع الخانات ويضغط زر "إنهاء الجولة" — تنتهي الجولة فورًا لجميع اللاعبين، حتى لو لم ينتهِ الوقت المحدد بعد.</li>
                <li>إذا انتهى الوقت المحدد قبل أن ينهي أي لاعب، تُغلق الجولة تلقائيًا وتُحتسب الإجابات كما هي.</li>
              </ol>
              <h3>🧮 احتساب النقاط</h3>
              <ul>
                <li>كل كلمة صحيحة (غير فارغة وتبدأ فعلًا بالحرف المطلوب) = 10 نقاط تلقائيًا.</li>
                <li>الكلمة الفارغة أو التي لا تبدأ بالحرف الصحيح = صفر نقاط.</li>
                <li>يقدر المضيف يراجع أي كلمة بشاشة النتائج ويصححها يدويًا (مثلًا إذا كانت كلمة غير موجودة فعلًا بتلك الفئة).</li>
                <li>تُجمع نقاط كل لاعب من جميع الجولات لتكوين مجموعه الكلي.</li>
              </ul>
              <h3>🏁 نهاية اللعبة</h3>
              <p>بعد كل جولة، يقرر المضيف إما بدء جولة جديدة بحرف مختلف، أو إنهاء اللعبة وعرض النتائج النهائية. تُعرض النتائج مرتبة من الأعلى نقاطًا إلى الأدنى، مع كأس ذهبي للمركز الأول، وفضي للثاني، وبرونزي للثالث.</p>
            </div>
            <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={onClose}>إغلاق</button>
          </>
        )}
      </div>
    </div>
  );
}
