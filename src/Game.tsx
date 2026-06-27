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
import { sfx } from './sound';
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
  const [showRules, setShowRules] = useState(false);
  const [bustedFlash, setBustedFlash] = useState(false);
  const wasAliveRef = useRef(true);
  const [errorMsg, setErrorMsg] = useState('');
  /** ms remaining in the pick phase. >0 only while phase === 'choosing'. */
  const [pickMsLeft, setPickMsLeft] = useState(0);
  /** When the cop strikes we freeze the beam at its live sweep angle. */
  const [frozenAngle, setFrozenAngle] = useState<number | null>(null);
  /** Live spotlight angle driven by JS (not CSS) so we always know the exact
   *  angle without read-timing drift. Updated 60Hz by an rAF loop while sweeping. */
  const [liveAngle, setLiveAngle] = useState<number>(-34);
  const liveAngleRef = useRef<number>(-34);
  const sweepRafRef = useRef<number | null>(null);
  /** Separate rAF for the lock-in glide so the sweep effect's cleanup can't
   *  cancel it when copPath is set. */
  const lockRafRef = useRef<number | null>(null);
  const timeouts = useRef<number[]>([]);
  const tickInterval = useRef<number | null>(null);
  const pickDeadline = useRef<number>(0);

  useEffect(() => {
    return () => {
      timeouts.current.forEach(clearTimeout);
      if (tickInterval.current) clearInterval(tickInterval.current);
      if (sweepRafRef.current) cancelAnimationFrame(sweepRafRef.current);
      if (lockRafRef.current) cancelAnimationFrame(lockRafRef.current);
    };
  }, []);

  /** JS-driven spotlight sweep. Runs an rAF loop while there's no lock, updating
   *  liveAngle (and the ref for instant reads). 5s period, sine curve between
   *  ±35°. Stops as soon as copPath is set; resumes when it's cleared. */
  useEffect(() => {
    if (copPath !== undefined) {
      // Locked — stop the sweep.
      if (sweepRafRef.current) {
        cancelAnimationFrame(sweepRafRef.current);
        sweepRafRef.current = null;
      }
      return;
    }
    const PERIOD = 5000;
    // Gates span A=+43 … D=-41 (see DOOR_ANGLES). Center the sweep on that
    // range's midpoint (~+1) and size the amplitude to reach just past both ends
    // so the beam clearly travels across ALL four gates.
    const CENTER = 1;
    const AMP = 44;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) % PERIOD) / PERIOD; // 0..1
      const angle = CENTER + Math.sin(t * Math.PI * 2) * AMP;
      liveAngleRef.current = angle;
      setLiveAngle(angle);
      sweepRafRef.current = requestAnimationFrame(tick);
    };
    sweepRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (sweepRafRef.current) {
        cancelAnimationFrame(sweepRafRef.current);
        sweepRafRef.current = null;
      }
    };
  }, [copPath]);

  const playerThug = thugs.find((t) => t.isPlayer) ?? thugs[0];
  const aliveCount = thugs.filter((t) => t.alive).length;

  /** Watch for player alive→dead transition during a round to fire the BUSTED flash. */
  useEffect(() => {
    if (wasAliveRef.current && !playerThug.alive && phase !== 'idle' && phase !== 'character-pick') {
      sfx.busted();
      setBustedFlash(true);
      const t = window.setTimeout(() => setBustedFlash(false), 1500);
      timeouts.current.push(t);
    }
    wasAliveRef.current = playerThug.alive;
    // Reset the ref when starting a new game
    if (phase === 'idle' || phase === 'character-pick') {
      wasAliveRef.current = true;
    }
  }, [playerThug.alive, phase]);
  const pool = useMemo(() => calculatePool(bet), [bet]);

  /** Read the live JS-driven beam angle. No DOM read, no race condition —
   *  the angle is whatever liveAngleRef.current is at this exact moment. */
  const readSearchlightAngle = (): number => liveAngleRef.current;

  /** Exact angle to point the beam at each gate. Used both for boundaries
   *  in angleToDoor and for snapping the locked beam onto a gate's center.
   *  Gates sit at x = 28.5/42.5/57/70.5%. With the short beam the pool lands via
   *  a sin projection; these were tuned against the live render so each pool
   *  lands within 0.1% of its gate: A:43, B:14, C:-13, D:-41. */
  const DOOR_ANGLES: Record<Path, number> = {
    A: 43,
    B: 14,
    C: -13,
    D: -41,
  };

  /** Map a beam angle (degrees) to the door it's currently pointing at.
   *  Ordered by angle (D<C<B<A). Boundaries at midpoints between adjacent
   *  gate angles: D|C ≈ -27, C|B ≈ 0.5, B|A ≈ 28.5. */
  const angleToDoor = (angle: number): Path => {
    if (angle < -27) return 'D';
    if (angle < 0.5) return 'C';
    if (angle < 28.5) return 'B';
    return 'A';
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
   *  the chosen slot as the player, then runs the start-countdown intro. */
  const confirmCharacter = (slot: number) => {
    if (!user) return;
    updateBalance(-bet);
    setThugs(buildInitialThugs(user.name, slot));
    setCopPath(undefined);
    setFrozenAngle(null);
    setRound(1);
    setWinners([]);
    setPayoutToPlayer(0);
    setPhase('start-countdown');
    // 2-second 3-2-1 countdown, then the first pick window begins.
    const t = window.setTimeout(() => setPhase('choosing'), 2400);
    timeouts.current.push(t);
  };

  /** Lock in the cop's target door based on where the beam is pointing, then
   *  SMOOTHLY glide the beam to rest exactly on that gate (no instant jump).
   *  The glide is done with a CSS transition on the searchlight rotation (see
   *  .searchlight-locked) — we just stop the sweep, pin the current angle, then
   *  on the next frame set the gate's exact angle so the transition animates it.
   *  Called at pick-timer end (and spectate timeout). */
  const lockSpotlightAndRunRound = () => {
    // Read the live sweep angle to decide which gate the cop hits — that's
    // the fair part: the beam was naturally on that gate at the moment.
    const fromAngle = readSearchlightAngle();
    const cp = angleToDoor(fromAngle);
    const toAngle = DOOR_ANGLES[cp];

    // Stop the sweep and pin the beam at its CURRENT angle (no jump yet).
    setFrozenAngle(fromAngle);
    setCopPath(cp);
    sfx.strike();

    // Next frame: set the gate's exact angle. Because .searchlight-locked adds a
    // CSS transition on `transform`, the beam glides from fromAngle to the gate
    // and comes to rest on it.
    if (lockRafRef.current) cancelAnimationFrame(lockRafRef.current);
    lockRafRef.current = requestAnimationFrame(() => {
      setFrozenAngle(toAngle);
      lockRafRef.current = null;
    });

    runRound(cp);
  };

  /** Run the bot-reveal → walk → strike sequence. `cp` is the cop's already-
   *  decided target door (locked in at pick-timer end so the beam doesn't
   *  drift after). */
  const runRound = (cp: Path) => {
    setPhase('revealing-bots');

    const t1 = window.setTimeout(() => {
      setThugs((cur) => pickBotPaths(cur));
      setPhase('cop-checking');
    }, BOT_REVEAL_MS);
    timeouts.current.push(t1);

    const t2 = window.setTimeout(() => {
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
    sfx.pick();
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
        lockSpotlightAndRunRound();
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
    const t = window.setTimeout(lockSpotlightAndRunRound, 1500);
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
    if (playerWon) {
      updateBalance(share);
      // Slight delay so the strike sound doesn't overlap the win chord.
      window.setTimeout(() => sfx.win(), 250);
    }
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
    setBustedFlash(false);
    setThugs(buildInitialThugs(user?.name ?? 'You'));
  };

  /** From the final-result screen → straight back to character pick, keeping the
   *  same bet (and charging again). */
  const playAgain = () => {
    if (!user) return;
    if (user.balance < bet) {
      setErrorMsg('Not enough balance!');
      window.setTimeout(() => setErrorMsg(''), 2000);
      reset();
      return;
    }
    setCopPath(undefined);
    setFrozenAngle(null);
    setRound(1);
    setWinners([]);
    setPayoutToPlayer(0);
    setBustedFlash(false);
    setErrorMsg('');
    setPhase('character-pick');
  };

  const playerWon = winners.some((w) => w.isPlayer);
  const sharePerWinner = winners.length > 0 ? Math.floor(pool / winners.length) : 0;

  return (
    <div className="game-shell">
      <TopBar
        onShowHistory={() => setShowHistory(true)}
        onShowRules={() => setShowRules(true)}
      />

      <div className="game-stage">
        <div className="stage-header">
          {phase === 'choosing' && playerThug.alive && (() => {
            const totalCs = Math.max(0, Math.round(pickMsLeft / 10));
            const ss = Math.floor(totalCs / 100);
            const cs = totalCs % 100;
            const ssStr = String(ss).padStart(2, '0');
            const csStr = String(cs).padStart(2, '0');
            return (
              <div className={`pick-timer ${pickMsLeft < 1500 ? 'pick-timer-urgent' : ''}`}>
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
            className={`yard ${copPath ? `spotlight-locked spotlight-${copPath}` : 'spotlight-sweep'} ${phase === 'round-result' ? 'yard-transition' : ''}`}
            style={{ backgroundImage: `url(${SPRITES.bgYard})` }}
          >
            <div className="yard-vignette" />

            {/* Searchlight: ONE entity. The beam and the floor pool are a single
                rotating unit pivoting at the lamp (top center). The pool is a
                CHILD pinned to the BOTTOM TIP of the beam, so it can never
                desync from where the beam points. It's counter-rotated by the
                same angle so it lies flat on the floor while staying glued to
                the beam tip. */}
            {(() => {
              const ang = frozenAngle ?? liveAngle;
              return (
                <div
                  className={`searchlight ${copPath ? 'searchlight-locked' : ''}`}
                  style={{ transform: `rotate(${ang}deg)` }}
                >
                  <div className="searchlight-beam" />
                  {/* counter-rotate to stay flat on the ground; centered on tip */}
                  <div
                    className="searchlight-pool"
                    style={{ transform: `translate(-50%, -50%) rotate(${-ang}deg) scaleY(0.55)` }}
                  />
                </div>
              );
            })()}

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
              {(() => {
                /* Group thugs by the gate they've walked to so thugs at the same
                   gate queue up the lane VERTICALLY (front-to-back) instead of
                   stacking on the same spot. Maps each gate -> ordered thug ids. */
                const reveal = phase !== 'idle';
                const groups: Record<string, number[]> = {};
                thugs.forEach((t) => {
                  if (reveal && t.chosenPath && t.alive) {
                    (groups[t.chosenPath] ??= []).push(t.id);
                  }
                });
                return thugs.map((t, i) => {
                  const path = t.chosenPath;
                  const isWinner = winners.some((w) => w.id === t.id);
                  const onPath = reveal && path && t.alive;
                  // Starting x: spread 10 thugs evenly across 15%–85%
                  const startX = 15 + (i * 70) / 9;
                  // Queue offset within the gate group. The bar (start line) is the
                  // UPPER limit — the first member sits ON the bar and extra members
                  // stack DOWNWARD (toward the viewer), never crossing above it.
                  let spreadY = 0;
                  if (onPath && path) {
                    const group = groups[path];
                    const idx = group.indexOf(t.id);
                    spreadY = -idx * 7;
                  }
                  return (
                  <div
                    key={t.id}
                    className={`thug ${onPath ? `thug-on-${path}` : ''} ${
                      t.alive ? '' : 'thug-caught'
                    } ${t.isPlayer ? 'thug-player' : ''} ${isWinner ? 'thug-winner' : ''}`}
                    style={{
                      ['--thug-start-x' as string]: `${startX}%`,
                      ['--thug-spread-y' as string]: `${spreadY}%`,
                      // Closer (lower in the lane) thugs render on top of those
                      // queued further back, so the queue overlaps correctly.
                      zIndex: onPath ? 100 - Math.round(spreadY) : undefined,
                    }}
                  >
                    <img className="thug-body" src={t.avatar} alt={t.name} />
                    {t.isPlayer && <div className="you-tag">YOU</div>}
                    {reveal && path && t.alive && <div className="thug-path-tag">{path}</div>}
                  </div>
                );
                });
              })()}
            </div>

            {phase === 'start-countdown' && (
              <StartCountdown />
            )}

            {phase === 'choosing' && !playerThug.alive && (
              <div className="prompt-banner spectate">SPECTATING · BOTS RUN THE REMAINING ROUNDS</div>
            )}

            {phase === 'round-result' && (
              <div className="round-banner">
                ROUND {round} CLEARED · {aliveCount} REMAIN
              </div>
            )}

            {bustedFlash && (
              <div className="busted-flash">
                <div className="busted-text">BUSTED</div>
              </div>
            )}

            {phase === 'final-result' && (
              <div className={`result-banner ${playerWon ? 'win' : 'lose'}`}>
                {playerWon && <div className="result-confetti" aria-hidden="true" />}
                <div className="result-eyebrow">
                  {playerWon
                    ? (winners.length === 1 ? 'SURVIVOR' : `${winners.length}-WAY SPLIT`)
                    : 'CAUGHT'}
                </div>
                <div className="result-msg">
                  {playerWon
                    ? winners.length === 1
                      ? 'YOU WON THE POOL'
                      : 'SPLIT WIN'
                    : 'BUSTED BY THE COP'}
                </div>
                <div className="result-payout">
                  {playerWon ? '+' : '−'}
                  {(playerWon ? payoutToPlayer : bet).toLocaleString()}
                </div>
                <div className="result-detail">
                  Prize Pool {pool.toLocaleString()} · Rounds played {round}
                </div>
                <div className="result-winners">
                  Winner{winners.length > 1 ? 's' : ''}: {winners.map((w) => w.name).join(' · ')}
                </div>
                <div className="result-actions">
                  <button className="btn-play btn-play-result" onClick={playAgain}>
                    PLAY AGAIN
                  </button>
                  <button className="btn-secondary" onClick={reset}>
                    Change Character
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: How It Works */}
          <div className="panel how-panel">
            <div className="panel-header how-header">HOW IT WORKS</div>
            <ol className="how-list">
              <li><span className="how-num">1</span><span>ANTE UP — POOL = ANTE × 10</span></li>
              <li><span className="how-num">2</span><span>PICK YOUR CHARACTER</span></li>
              <li><span className="how-num">3</span><span>TAP A GATE (5s, CAN SWITCH)</span></li>
              <li><span className="how-num">4</span><span>SPOTLIGHT FREEZES · CAUGHT = OUT</span></li>
              <li><span className="how-num">5</span><span>LAST STANDING TAKES IT ALL</span></li>
              <li><span className="how-num">6</span><span>TIED LAST? SPLIT THE POOL</span></li>
            </ol>
            <button
              type="button"
              className="how-cta"
              onClick={() => setShowRules(true)}
            >
              FULL RULES →
            </button>
          </div>
        </div>

        {/* Unified bottom console: bet on the left, PLAY in the middle, pool
            on the right. One coherent control panel instead of two rows. */}
        <div className="console-bar">
          <div className="console-cell console-bet">
            <div className="console-label">YOUR ANTE</div>
            <div className="bet-controls">
              <button className="bet-btn" onClick={() => adjustBet(-1)} disabled={phase !== 'idle'}>−</button>
              <div className="bet-value">{bet.toLocaleString()}</div>
              <button className="bet-btn" onClick={() => adjustBet(1)} disabled={phase !== 'idle'}>+</button>
            </div>
          </div>

          <button
            className="btn-play btn-play-console"
            onClick={startGame}
            disabled={phase !== 'idle'}
          >
            {errorMsg ? errorMsg : phase === 'idle' ? 'PLAY' : `ROUND ${round}`}
          </button>

          <div className="console-cell console-pool">
            <div className="console-label">PRIZE POOL</div>
            <div className="win-value">{pool.toLocaleString()}</div>
            {phase !== 'idle' && winners.length === 0 && (
              <div className="win-sub">if solo win</div>
            )}
            {winners.length > 1 && (
              <div className="win-sub">{sharePerWinner.toLocaleString()} ea ({winners.length}-way)</div>
            )}
          </div>
        </div>
      </div>

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {phase === 'character-pick' && (
        <CharacterPicker
          onConfirm={(slot) => confirmCharacter(slot)}
          onCancel={() => setPhase('idle')}
        />
      )}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

/** 3-2-1 countdown shown for ~2.4s before each game starts. */
function StartCountdown() {
  const [n, setN] = useState(3);
  useEffect(() => {
    sfx.countdownTick(); // initial "3"
    const id1 = window.setTimeout(() => { setN(2); sfx.countdownTick(); }, 700);
    const id2 = window.setTimeout(() => { setN(1); sfx.countdownTick(); }, 1400);
    const id3 = window.setTimeout(() => { setN(0); sfx.countdownGo(); }, 2100);
    return () => {
      clearTimeout(id1); clearTimeout(id2); clearTimeout(id3);
    };
  }, []);
  return (
    <div className="start-countdown">
      <div className="start-instruction">TAP A GATE TO ESCAPE</div>
      <div key={n} className={`start-number ${n === 0 ? 'go' : ''}`}>
        {n === 0 ? 'GO' : n}
      </div>
    </div>
  );
}

/** Full rules modal triggered from the topbar "?" button. */
function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-rules" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>HOW TO PLAY</h2>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <ol className="rules-list">
            <li><b>Set your ante</b> — every thug pays the same. The prize pool = your ante × 10.</li>
            <li><b>Pick a character</b> — each has a personality (risky, safe, sticky, flighty, random). It affects how the bots behave.</li>
            <li><b>Each round, choose a gate</b> (A, B, C, or D). You have 5 seconds; tap any gate to switch.</li>
            <li><b>The spotlight sweeps the wall.</b> Wherever the beam is pointing when your timer ends = the gate the cop checks.</li>
            <li><b>Caught? You're out.</b> Anyone behind the busted gate gets eliminated. Everyone else survives to the next round.</li>
            <li><b>Last thug standing wins the pool.</b> If multiple thugs are eliminated together on the final round, they split the pool.</li>
            <li><b>Read the room.</b> Bots walk to their chosen gate during the timer — sometimes they change their mind. Use the crowd as info.</li>
          </ol>
        </div>
      </div>
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

