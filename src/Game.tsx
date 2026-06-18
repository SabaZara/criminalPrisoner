import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth';
import {
  PATHS,
  TOTAL_THUGS,
  applyCopCheck,
  buildInitialThugs,
  calculatePool,
  clearChoices,
  decideBotPick,
  decideBotSwitch,
  determineWinners,
  getRoster,
  pickBotPaths,
  pickRandomPath,
  switchProbability,
} from './gameLogic';
import { storage } from './storage';
import type { GamePhase, Path, Thug } from './types';
import { TopBar } from './TopBar';
import { SPRITES } from './assets/sprites';
import './Game.css';

const BET_STEP = 1000;
const MIN_BET = 1000;
const MAX_BET = 1000000;

/** Round pacing (ms). Total target ≈ 5s per round so thugs visibly walk before the cop strikes. */
const PICK_TIMER_MS = 5000;      // player has 5s to pick (and can change their mind)
const BOT_REVEAL_MS = 200;       // brief pause after pick window closes before cop-check
const WALK_TO_DOOR_MS = 1500;    // settle time before cop strikes (bots already walked during pick)
const ROUND_RESULT_MS = 1300;    // pause on the result before the next round starts

const PATH_COLOR: Record<Path, string> = {
  A: '#d4382e',
  B: '#d4af37',
  C: '#3a82d4',
  D: '#c43ad4',
};

export function Game() {
  const { user, updateBalance } = useAuth();
  const [bet, setBet] = useState(10000);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [thugs, setThugs] = useState<Thug[]>(() => buildInitialThugs(user?.name ?? 'You'));
  const [copPath, setCopPath] = useState<Path | undefined>();
  const [round, setRound] = useState(1);
  const [winners, setWinners] = useState<Thug[]>([]);
  const [payoutToPlayer, setPayoutToPlayer] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  /** ms remaining in the pick phase. >0 only while phase === 'choosing'. */
  const [pickMsLeft, setPickMsLeft] = useState(0);
  /** When the cop strikes we freeze the beam at its live sweep angle (not snap to a
   *  fixed door angle). This is the angle in degrees we lock to. */
  const [frozenAngle, setFrozenAngle] = useState<number | null>(null);
  const timeouts = useRef<number[]>([]);
  const tickInterval = useRef<number | null>(null);
  const pickDeadline = useRef<number>(0);
  const searchlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      timeouts.current.forEach(clearTimeout);
      if (tickInterval.current) clearInterval(tickInterval.current);
    };
  }, []);

  const playerThug = thugs.find((t) => t.isPlayer) ?? thugs[0];
  const aliveCount = thugs.filter((t) => t.alive).length;
  const pool = useMemo(() => calculatePool(bet), [bet]);

  /** Read the live rotation angle (in degrees) from the searchlight DOM element's
   *  computed transform matrix. Returns 0 if the element isn't there yet. */
  const readSearchlightAngle = (): number => {
    const el = searchlightRef.current;
    if (!el) return 0;
    const matrix = window.getComputedStyle(el).transform;
    if (!matrix || matrix === 'none') return 0;
    // matrix(a, b, c, d, tx, ty) — rotation = atan2(b, a)
    const m = matrix.match(/matrix\(([^)]+)\)/);
    if (!m) return 0;
    const [a, b] = m[1].split(',').map(Number);
    const rad = Math.atan2(b, a);
    return rad * (180 / Math.PI);
  };

  /** Map a beam angle (degrees) to the door it's currently pointing at.
   *  Doors at offsets -22/-7/+7/+22 from center → approx angles ±35° / ±12°.
   *  Boundaries split halfway between adjacent door angles. */
  const angleToDoor = (angle: number): Path => {
    if (angle < -23) return 'A';
    if (angle < 0) return 'B';
    if (angle < 23) return 'C';
    return 'D';
  };

  const adjustBet = (dir: 1 | -1) => {
    if (phase !== 'idle') return;
    setBet((b) => Math.max(MIN_BET, Math.min(MAX_BET, b + dir * BET_STEP)));
  };

  const startGame = () => {
    if (!user) return;
    if (user.balance < bet) {
      setErrorMsg('Not enough balance!');
      window.setTimeout(() => setErrorMsg(''), 2000);
      return;
    }
    setErrorMsg('');
    setPhase('character-pick');
  };

  /** Called from the character-picker. Charges the bet, builds the roster with
   *  the chosen slot as the player, then transitions to the regular round flow. */
  const confirmCharacter = (slot: number) => {
    if (!user) return;
    updateBalance(-bet);
    setThugs(buildInitialThugs(user.name, slot));
    setCopPath(undefined);
    setFrozenAngle(null);
    setRound(1);
    setWinners([]);
    setPayoutToPlayer(0);
    setPhase('choosing');
  };

  /** Run the bot-reveal → walk → cop-check sequence for the current round.
   *  Bots already have picks from the indecision effect, but we ensure no alive
   *  thug is missing a chosenPath (safety net) before the cop strikes. */
  const runRound = () => {
    setPhase('revealing-bots');

    const t1 = window.setTimeout(() => {
      setThugs((cur) => pickBotPaths(cur));
      setPhase('cop-checking');
    }, BOT_REVEAL_MS);
    timeouts.current.push(t1);

    const t2 = window.setTimeout(() => {
      // Cop targets whichever door the spotlight is naturally pointing at right
      // now — the beam doesn't snap, it just freezes. Read live angle, map to door.
      const angle = readSearchlightAngle();
      const cp = angleToDoor(angle);
      setFrozenAngle(angle);
      setCopPath(cp);
      setThugs((cur) => {
        const after = applyCopCheck(cur, cp, round);
        const winnersOrNull = determineWinners(after, round);

        if (winnersOrNull === null) {
          const t3 = window.setTimeout(() => {
            setThugs((c2) => clearChoices(c2));
            setCopPath(undefined);
            setFrozenAngle(null);
            setRound((r) => r + 1);
            setPhase('choosing');
          }, ROUND_RESULT_MS);
          timeouts.current.push(t3);
          setPhase('round-result');
        } else {
          finalizeGame(winnersOrNull, after);
        }
        return after;
      });
    }, BOT_REVEAL_MS + WALK_TO_DOOR_MS);
    timeouts.current.push(t2);
  };

  /** Player picks (or switches to) a door. Doesn't trigger the round — the timer does. */
  const choosePath = (p: Path) => {
    if (phase !== 'choosing') return;
    if (!playerThug.alive) return;
    setThugs((cur) => cur.map((t) => (t.isPlayer ? { ...t, chosenPath: p } : t)));
  };

  /** Start the 5s pick window. When it expires, runRound() fires. */
  useEffect(() => {
    if (phase !== 'choosing' || !playerThug.alive) {
      setPickMsLeft(0);
      if (tickInterval.current) {
        clearInterval(tickInterval.current);
        tickInterval.current = null;
      }
      return;
    }

    pickDeadline.current = Date.now() + PICK_TIMER_MS;
    setPickMsLeft(PICK_TIMER_MS);

    const tick = () => {
      const remaining = Math.max(0, pickDeadline.current - Date.now());
      setPickMsLeft(remaining);
      if (remaining <= 0) {
        if (tickInterval.current) {
          clearInterval(tickInterval.current);
          tickInterval.current = null;
        }
        // If the player never picked, auto-assign a random path so the round can resolve.
        setThugs((cur) => {
          const me = cur[0];
          if (!me.chosenPath) {
            const auto = pickRandomPath();
            return cur.map((t) => (t.isPlayer ? { ...t, chosenPath: auto } : t));
          }
          return cur;
        });
        runRound();
      }
    };
    tickInterval.current = window.setInterval(tick, 100);
    return () => {
      if (tickInterval.current) {
        clearInterval(tickInterval.current);
        tickInterval.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, playerThug.alive, round]);

  /** When player is eliminated but the game continues, auto-run rounds in spectate mode. */
  useEffect(() => {
    if (phase !== 'choosing') return;
    if (playerThug.alive) return;
    const t = window.setTimeout(runRound, 1500);
    timeouts.current.push(t);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, playerThug.alive, round]);

  /**
   * Personality-driven bot decisions during the pick phase.
   * - Each alive bot picks immediately, using their personality + the running
   *   crowd state (so bots picking later react to earlier bots).
   * - Each bot may then "change their mind" once at a random moment in the
   *   window, with a switch probability driven by personality.
   *
   * Pick order is randomized each round so the safe/risky reactions aren't
   * deterministic on bot index.
   */
  useEffect(() => {
    if (phase !== 'choosing') return;

    const windowMs = playerThug.alive ? PICK_TIMER_MS : 1500;

    // Step 1: sequential initial picks so later bots can read earlier ones.
    setThugs((cur) => {
      const bots = cur.filter((t) => !t.isPlayer && t.alive);
      // Shuffle the pick order each round (Fisher–Yates).
      const order = [...bots];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      // Working copy of all thugs that we mutate as each bot picks.
      let working = cur.map((t) => (t.isPlayer || !t.alive ? t : { ...t, chosenPath: undefined }));
      for (const bot of order) {
        const pick = decideBotPick(bot, working);
        working = working.map((t) => (t.id === bot.id ? { ...t, chosenPath: pick } : t));
      }
      return working;
    });

    // Step 2: schedule per-bot maybe-switches based on personality switch rate.
    const switchTimers: number[] = [];
    setThugs((cur) => {
      cur.forEach((t) => {
        if (t.isPlayer || !t.alive) return;
        if (Math.random() > switchProbability(t)) return;
        // Schedule a switch somewhere in 25%–75% of the window so it stays
        // visible and resolves before the cop strikes.
        const delay = windowMs * (0.25 + Math.random() * 0.5);
        const id = window.setTimeout(() => {
          setThugs((c) =>
            c.map((tt) => {
              if (tt.id !== t.id || !tt.alive) return tt;
              const next = decideBotSwitch(tt, c);
              return { ...tt, chosenPath: next };
            })
          );
        }, delay);
        switchTimers.push(id);
      });
      return cur;
    });

    return () => {
      switchTimers.forEach((id) => clearTimeout(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round]);

  const finalizeGame = (gameWinners: Thug[], finalThugs: Thug[]) => {
    setWinners(gameWinners);
    const playerWon = gameWinners.some((w) => w.isPlayer);
    const share = playerWon ? Math.floor(pool / gameWinners.length) : 0;
    if (playerWon) updateBalance(share);
    setPayoutToPlayer(share);

    storage.pushHistory({
      id: Math.random().toString(36).slice(2),
      bet,
      pool,
      thugs: finalThugs,
      rounds: round,
      copPath,
      won: playerWon,
      payout: share,
      winners: gameWinners.length,
      timestamp: Date.now(),
    });

    const t = window.setTimeout(() => setPhase('final-result'), 1400);
    timeouts.current.push(t);
  };

  const reset = () => {
    setPhase('idle');
    setCopPath(undefined);
    setFrozenAngle(null);
    setRound(1);
    setWinners([]);
    setPayoutToPlayer(0);
    setThugs(buildInitialThugs(user?.name ?? 'You'));
  };

  const playerWon = winners.some((w) => w.isPlayer);
  const sharePerWinner = winners.length > 0 ? Math.floor(pool / winners.length) : 0;

  return (
    <div className="game-shell">
      <TopBar onShowHistory={() => setShowHistory(true)} />

      <div className="game-stage">
        <div className="stage-header">
          {phase === 'choosing' && playerThug.alive && (() => {
            const totalCs = Math.max(0, Math.round(pickMsLeft / 10));
            const ss = Math.floor(totalCs / 100);
            const cs = totalCs % 100;
            const ssStr = String(ss).padStart(2, '0');
            const csStr = String(cs).padStart(2, '0');
            return (
              <div className="pick-timer">
                <div className="pick-timer-row">
                  <div className="pick-timer-meta">
                    <span className="pick-timer-meta-key">ROUND</span>
                    <span className="pick-timer-meta-val">{String(round).padStart(2, '0')}</span>
                  </div>
                  <div className="pick-timer-clock">
                    <span className="pick-timer-clock-sec">{ssStr}</span>
                    <span className="pick-timer-clock-sep">.</span>
                    <span className="pick-timer-clock-cs">{csStr}</span>
                  </div>
                  <div className="pick-timer-meta pick-timer-meta-right">
                    <span className="pick-timer-meta-key">STATUS</span>
                    <span className="pick-timer-meta-val">
                      {playerThug.chosenPath ? `DOOR ${playerThug.chosenPath}` : '—'}
                    </span>
                  </div>
                </div>
                <div className="pick-timer-track">
                  <div
                    className="pick-timer-fill"
                    style={{ width: `${(pickMsLeft / PICK_TIMER_MS) * 100}%` }}
                  />
                </div>
                <div className="pick-timer-footer">
                  {playerThug.chosenPath ? 'TAP ANOTHER DOOR TO SWITCH' : 'CHOOSE A DOOR'}
                </div>
              </div>
            );
          })()}
          <div className="stage-header-title">
            <h1 className="stage-title">
              10 THUGS. <span className="accent-gold">4 PATHS.</span> <span className="accent-red">1 COP.</span>
            </h1>
            <p className="stage-sub">LAST THUG STANDING TAKES THE POOL</p>
          </div>
        </div>

        <div className="stage-grid">
          {/* Left: Player List */}
          <div className="panel players-panel">
            <div className="panel-header">
              <span>PLAYERS</span>
              <span className="alive-count">{aliveCount}/{TOTAL_THUGS}</span>
            </div>
            <div className="players-list">
              {thugs.map((t) => {
                const isWinner = winners.some((w) => w.id === t.id);
                return (
                  <div
                    key={t.id}
                    className={`player-row ${t.alive ? 'alive' : 'dead'} ${t.isPlayer ? 'is-player' : ''} ${isWinner ? 'is-winner' : ''}`}
                  >
                    <img className="avatar avatar-img" src={t.avatar} alt={t.name} />
                    <div className="player-name-stack">
                      <div className="player-name">{t.id}. {t.name}</div>
                      {t.personality && (
                        <div className={`player-personality personality-${t.personality}`}>
                          {t.personality.toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="player-status">
                      {isWinner ? '★ WIN' : t.alive ? 'ALIVE' : `R${t.eliminatedRound}`}
                    </div>
                    {t.chosenPath && t.alive && (
                      <div className="player-pill" style={{ background: PATH_COLOR[t.chosenPath] }}>
                        {t.chosenPath}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Center: Prison Yard */}
          <div
            className={`yard ${copPath ? `spotlight-locked spotlight-${copPath}` : 'spotlight-sweep'}`}
            style={{ backgroundImage: `url(${SPRITES.bgYard})` }}
          >
            <div className="yard-vignette" />

            {/* Searchlight: sweeps continuously on a center pivot. When the cop
                strikes, we FREEZE the beam at its current live angle (not snap to
                a chosen door). The door beneath the beam tip is the one eliminated. */}
            <div
              ref={searchlightRef}
              className={`searchlight ${copPath ? 'searchlight-locked' : 'searchlight-sweep'}`}
              style={frozenAngle !== null ? { transform: `rotate(${frozenAngle}deg)` } : undefined}
            >
              <div className="searchlight-beam" />
              <div className="searchlight-pool" />
            </div>

            {PATHS.map((p) => (
              <button
                key={p}
                className={`door door-${p} ${copPath === p ? 'door-checked' : ''} ${
                  playerThug.chosenPath === p ? 'door-chosen' : ''
                } ${phase === 'choosing' && playerThug.alive ? 'door-active' : ''}`}
                style={{ ['--door-color' as string]: PATH_COLOR[p] }}
                onClick={() => choosePath(p)}
                disabled={phase !== 'choosing' || !playerThug.alive}
              >
                <img className="door-img" src={SPRITES.doors[p]} alt={p} />
              </button>
            ))}

            <div className="yard-paths-spacer" />

            {/* Walking-thug overlay. During 'choosing' all thugs (player + bots) are
                visible on the paths they've picked; bots may "change their mind" and
                walk to a different door. Everyone has settled by the time the round
                resolves. */}
            <div className="thug-stage">
              {thugs.map((t, i) => {
                const path = t.chosenPath;
                const reveal = phase !== 'idle';
                const isWinner = winners.some((w) => w.id === t.id);
                const onPath = reveal && path && t.alive;
                // Starting x: spread 10 thugs evenly across 15%–85%
                const startX = 15 + (i * 70) / 9;
                return (
                  <div
                    key={t.id}
                    className={`thug ${onPath ? `thug-on-${path}` : ''} ${
                      t.alive ? '' : 'thug-caught'
                    } ${t.isPlayer ? 'thug-player' : ''} ${isWinner ? 'thug-winner' : ''}`}
                    style={{ ['--thug-start-x' as string]: `${startX}%` }}
                  >
                    <img className="thug-body" src={t.avatar} alt={t.name} />
                    {t.isPlayer && <div className="you-tag">YOU</div>}
                    {reveal && path && t.alive && <div className="thug-path-tag">{path}</div>}
                  </div>
                );
              })}
            </div>

            {phase === 'choosing' && !playerThug.alive && (
              <div className="prompt-banner spectate">SPECTATING · BOTS CONTINUE</div>
            )}

            {phase === 'round-result' && (
              <div className="round-banner">
                ROUND {round} OVER · {aliveCount} REMAIN
              </div>
            )}

            {phase === 'final-result' && (
              <div className={`result-banner ${playerWon ? 'win' : 'lose'}`}>
                <div className="result-msg">
                  {playerWon
                    ? winners.length === 1
                      ? `YOU WON THE POOL`
                      : `SPLIT WIN · ${winners.length} WAY`
                    : 'CAUGHT BY COP'}
                </div>
                <div className="result-detail">
                  Pool {pool.toLocaleString()} · Your share {payoutToPlayer.toLocaleString()}
                </div>
                <div className="result-winners">
                  Winner{winners.length > 1 ? 's' : ''}: {winners.map((w) => w.name).join(' · ')}
                </div>
                <button className="btn-play" onClick={reset}>PLAY AGAIN</button>
              </div>
            )}
          </div>

          {/* Right: How It Works */}
          <div className="panel how-panel">
            <div className="panel-header how-header">HOW IT WORKS</div>
            <ol className="how-list">
              <li><span className="how-num">1</span><span>EVERY THUG ANTES THE BET</span></li>
              <li><span className="how-num">2</span><span>EACH ROUND: PICK A PATH</span></li>
              <li><span className="how-num">3</span><span>COP CHECKS 1 PATH · CAUGHT = OUT</span></li>
              <li><span className="how-num">4</span><span>SURVIVORS GO AGAIN NEXT ROUND</span></li>
              <li><span className="how-num">5</span><span>LAST STANDING WINS THE POOL</span></li>
              <li><span className="how-num">6</span><span>TIED LAST? SPLIT THE POOL</span></li>
            </ol>
          </div>
        </div>

        {/* Bottom control bar */}
        <div className="control-bar">
          <div className="bet-block">
            <div className="bar-label">YOUR ANTE</div>
            <div className="bet-controls">
              <button className="bet-btn" onClick={() => adjustBet(-1)} disabled={phase !== 'idle'}>−</button>
              <div className="bet-value">{bet.toLocaleString()}</div>
              <button className="bet-btn" onClick={() => adjustBet(1)} disabled={phase !== 'idle'}>+</button>
            </div>
          </div>

          <div className="win-block">
            <div className="bar-label">PRIZE POOL</div>
            <div className="win-value">{pool.toLocaleString()}</div>
            {phase !== 'idle' && winners.length === 0 && (
              <div className="win-sub">if solo win</div>
            )}
            {winners.length > 1 && (
              <div className="win-sub">{sharePerWinner.toLocaleString()} ea ({winners.length}-way)</div>
            )}
          </div>

          <button
            className="btn-play btn-play-main"
            onClick={startGame}
            disabled={phase !== 'idle'}
          >
            {errorMsg ? errorMsg : phase === 'idle' ? 'PLAY' : `R${round}`}
          </button>
        </div>
      </div>

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {phase === 'character-pick' && (
        <CharacterPicker
          onConfirm={(slot) => confirmCharacter(slot)}
          onCancel={() => setPhase('idle')}
        />
      )}
    </div>
  );
}

/** Full-screen overlay shown right after PLAY. 10s countdown; click any thug to
 *  play as them, or wait it out for a random pick. */
function CharacterPicker({
  onConfirm,
  onCancel,
}: {
  onConfirm: (slot: number) => void;
  onCancel: () => void;
}) {
  const roster = getRoster();
  const [msLeft, setMsLeft] = useState(10000);
  const deadlineRef = useRef(Date.now() + 10000);
  const confirmedRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, deadlineRef.current - Date.now());
      setMsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        if (!confirmedRef.current) {
          confirmedRef.current = true;
          const slot = Math.floor(Math.random() * roster.length);
          onConfirm(slot);
        }
      }
    }, 80);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (slot: number) => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm(slot);
  };

  const seconds = Math.ceil(msLeft / 1000);
  const urgent = msLeft < 3000;
  const progress = Math.max(0, Math.min(1, msLeft / 10000));
  const circumference = 2 * Math.PI * 50;
  return (
    <div className="char-picker">
      <div className={`char-picker-timer ${urgent ? 'char-picker-timer-urgent' : ''}`}>
        <svg viewBox="0 0 120 120" className="char-picker-timer-svg">
          <circle cx="60" cy="60" r="50" className="char-picker-timer-track" />
          <circle
            cx="60"
            cy="60"
            r="50"
            className="char-picker-timer-fill"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
          />
        </svg>
        <div className="char-picker-timer-num">{seconds}</div>
      </div>
      <div className="char-picker-head">
        <div className="char-picker-title">CHOOSE YOUR CHARACTER</div>
        <div className="char-picker-sub">
          Tap a thug to play as them, or a random one is picked when time runs out
        </div>
      </div>
      <div className="char-picker-grid">
        {roster.map((slot, i) => (
          <button
            key={i}
            className="char-card"
            onClick={() => pick(i)}
          >
            <img className="char-card-img" src={SPRITES.thugs[i]} alt={slot.name} />
            <div className="char-card-meta">
              <div className="char-card-name">{slot.name}</div>
              <div className={`char-card-personality personality-${slot.personality}`}>
                {slot.personality.toUpperCase()}
              </div>
            </div>
          </button>
        ))}
      </div>
      <button className="char-picker-cancel" onClick={onCancel}>
        ← Back
      </button>
    </div>
  );
}

function HistoryModal({ onClose }: { onClose: () => void }) {
  const [rounds] = useState(() => storage.getHistory());
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>HISTORY</h2>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {rounds.length === 0 && <p style={{ color: '#888' }}>No games yet.</p>}
          {rounds.map((r) => (
            <div key={r.id} className={`history-row ${r.won ? 'win' : 'lose'}`}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {r.won ? (r.winners > 1 ? `✓ Split (${r.winners}-way)` : '✓ Solo Win') : '✗ Caught'}
                </div>
                <div style={{ fontSize: 11, color: '#888' }}>
                  {new Date(r.timestamp).toLocaleString()} · {r.rounds} rounds
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#888' }}>
                  Pool {r.pool.toLocaleString()}
                </div>
                <div style={{ fontWeight: 700, color: r.won ? '#4ade80' : '#ef4444' }}>
                  {r.won ? '+' : '−'}{(r.won ? r.payout : r.bet).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

