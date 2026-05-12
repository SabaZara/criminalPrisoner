import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth';
import {
  PATHS,
  TOTAL_THUGS,
  applyCopCheck,
  buildInitialThugs,
  calculatePool,
  clearChoices,
  determineWinners,
  pickBotPaths,
  pickRandomPath,
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
const BOT_REVEAL_MS = 700;       // bots commit their pick (sprites snap onto a path)
const WALK_TO_DOOR_MS = 3000;    // thugs walk up to their doors — spotlight sweeps overhead
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
  const timeouts = useRef<number[]>([]);
  const tickInterval = useRef<number | null>(null);
  const pickDeadline = useRef<number>(0);

  useEffect(() => {
    return () => {
      timeouts.current.forEach(clearTimeout);
      if (tickInterval.current) clearInterval(tickInterval.current);
    };
  }, []);

  const playerThug = thugs[0];
  const aliveCount = thugs.filter((t) => t.alive).length;
  const pool = useMemo(() => calculatePool(bet), [bet]);

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
    updateBalance(-bet);
    setThugs(buildInitialThugs(user.name));
    setCopPath(undefined);
    setRound(1);
    setWinners([]);
    setPayoutToPlayer(0);
    setErrorMsg('');
    setPhase('choosing');
  };

  /** Run the bot-reveal → walk → cop-check sequence for the current round. */
  const runRound = () => {
    setPhase('revealing-bots');

    const t1 = window.setTimeout(() => {
      setThugs((cur) => pickBotPaths(cur));
      setPhase('cop-checking');
    }, BOT_REVEAL_MS);
    timeouts.current.push(t1);

    const t2 = window.setTimeout(() => {
      const cp = pickRandomPath();
      setCopPath(cp);
      setThugs((cur) => {
        const after = applyCopCheck(cur, cp, round);
        const winnersOrNull = determineWinners(after, round);

        if (winnersOrNull === null) {
          const t3 = window.setTimeout(() => {
            setThugs((c2) => clearChoices(c2));
            setCopPath(undefined);
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
                    <div className="player-name">{t.id}. {t.name}</div>
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
            <img className="watchtower-img watchtower-left" src={SPRITES.tower} alt="" />
            <img className="watchtower-img watchtower-right" src={SPRITES.tower} alt="" />

            {/* Single searchlight cone that physically slides A → B → C → B → A across
                the back wall. When the round locks, the cone snaps to the chosen door
                and turns red. The beam itself never goes off. */}
            <div
              className={`searchlight ${
                copPath ? `searchlight-locked searchlight-at-${copPath}` : 'searchlight-sweep'
              }`}
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

            <div className="thug-stage">
              {thugs.map((t, i) => {
                const path = t.chosenPath;
                // Thugs only "walk" to their door once the round leaves the choosing phase.
                // During choosing, even if the player has picked, they stay at the bottom so
                // they can change their mind without an awkward walk-back animation.
                const reveal =
                  phase === 'revealing-bots' ||
                  phase === 'cop-checking' ||
                  phase === 'round-result' ||
                  phase === 'final-result';
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

          <div className="cop-block">
            <div className="bar-label">
              ROUND {phase === 'idle' ? '–' : round} · SPOTLIGHT {copPath ? `LOCKED ON ${copPath}` : 'SWEEPING'}
            </div>
            <div className="spot-indicator">
              {PATHS.map((p) => (
                <div
                  key={p}
                  className={`spot-dot ${copPath === p ? 'spot-dot-on' : ''}`}
                >
                  {p}
                </div>
              ))}
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

