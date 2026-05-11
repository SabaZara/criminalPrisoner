import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth';
import {
  PATHS,
  PAYOUT_MULTIPLIER,
  applyCopCheck,
  buildInitialThugs,
  pickBotPaths,
  pickRandomPath,
} from './gameLogic';
import { storage } from './storage';
import type { GamePhase, Path, Thug } from './types';
import { TopBar } from './TopBar';
import './Game.css';

const BET_STEP = 1000;
const MIN_BET = 1000;
const MAX_BET = 1000000;

const PATH_COLOR: Record<Path, string> = {
  A: '#d4382e',
  B: '#d4af37',
  C: '#3a82d4',
};

export function Game() {
  const { user, updateBalance } = useAuth();
  const [bet, setBet] = useState(10000);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [thugs, setThugs] = useState<Thug[]>(() => buildInitialThugs(user?.name ?? 'You'));
  const [copPath, setCopPath] = useState<Path | undefined>();
  const [resultMsg, setResultMsg] = useState<string>('');
  const [showHistory, setShowHistory] = useState(false);
  const timeouts = useRef<number[]>([]);

  useEffect(() => {
    return () => timeouts.current.forEach(clearTimeout);
  }, []);

  const playerThug = thugs[0];
  const aliveCount = thugs.filter((t) => t.alive).length;

  const adjustBet = (dir: 1 | -1) => {
    if (phase !== 'idle' && phase !== 'choosing') return;
    setBet((b) => Math.max(MIN_BET, Math.min(MAX_BET, b + dir * BET_STEP)));
  };

  const startRound = () => {
    if (!user) return;
    if (user.balance < bet) {
      setResultMsg('Not enough balance!');
      return;
    }
    setThugs(buildInitialThugs(user.name));
    setCopPath(undefined);
    setResultMsg('');
    setPhase('choosing');
  };

  const choosePath = (p: Path) => {
    if (phase !== 'choosing') return;
    if (!user) return;
    updateBalance(-bet);

    const next = thugs.map((t) => (t.isPlayer ? { ...t, chosenPath: p } : t));
    setThugs(next);
    setPhase('revealing-bots');

    const botRevealDelay = 700;
    const t1 = window.setTimeout(() => {
      setThugs((cur) => pickBotPaths(cur));
      setPhase('cop-checking');
    }, botRevealDelay);
    timeouts.current.push(t1);

    const t2 = window.setTimeout(() => {
      const cp = pickRandomPath();
      setCopPath(cp);
      setThugs((cur) => {
        const after = applyCopCheck(cur, cp);
        const playerWon = after[0].alive;
        const survivors = after.filter((t) => t.alive).length;
        const payout = playerWon ? bet * PAYOUT_MULTIPLIER : 0;

        if (playerWon) {
          updateBalance(payout);
          setResultMsg(`YOU SURVIVED · +${payout.toLocaleString()}`);
        } else {
          setResultMsg('CAUGHT BY COP');
        }

        storage.pushHistory({
          id: Math.random().toString(36).slice(2),
          bet,
          thugs: after,
          copPath: cp,
          won: playerWon,
          payout,
          timestamp: Date.now(),
        });

        const t3 = window.setTimeout(() => setPhase('result'), 600);
        timeouts.current.push(t3);
        void survivors;
        return after;
      });
    }, botRevealDelay + 1400);
    timeouts.current.push(t2);
  };

  const reset = () => {
    setPhase('idle');
    setCopPath(undefined);
    setResultMsg('');
    setThugs(buildInitialThugs(user?.name ?? 'You'));
  };

  const potentialWin = useMemo(() => bet * PAYOUT_MULTIPLIER, [bet]);

  return (
    <div className="game-shell">
      <TopBar onShowHistory={() => setShowHistory(true)} />

      <div className="game-stage">
        <div className="stage-header">
          <h1 className="stage-title">
            10 THUGS. <span className="accent-gold">3 PATHS.</span> <span className="accent-red">1 COP.</span>
          </h1>
          <p className="stage-sub">CHOOSE WISELY. STAY HIDDEN. STAY ALIVE.</p>
        </div>

        <div className="stage-grid">
          {/* Left: Player List */}
          <div className="panel players-panel">
            <div className="panel-header">
              <span>PLAYERS</span>
              <span className="alive-count">{aliveCount}/10</span>
            </div>
            <div className="players-list">
              {thugs.map((t) => (
                <div
                  key={t.id}
                  className={`player-row ${t.alive ? 'alive' : 'dead'} ${t.isPlayer ? 'is-player' : ''}`}
                >
                  <div className="avatar">{t.avatar}</div>
                  <div className="player-name">
                    {t.id}. {t.name}
                  </div>
                  <div className="player-status">
                    {t.alive ? (phase === 'result' ? 'SAFE' : 'ALIVE') : 'CAUGHT'}
                  </div>
                  {t.chosenPath && (
                    <div
                      className="player-pill"
                      style={{ background: PATH_COLOR[t.chosenPath] }}
                    >
                      {t.chosenPath}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Center: Prison Yard */}
          <div className="yard">
            <div className="yard-sky" />
            <div className="yard-wall">
              <div className="watchtower watchtower-left">
                <div className="tower-roof" />
                <div className="tower-light" />
              </div>
              <div className="watchtower watchtower-right">
                <div className="tower-roof" />
                <div className="tower-light" />
              </div>
              {PATHS.map((p) => (
                <button
                  key={p}
                  className={`door door-${p} ${copPath === p ? 'door-checked' : ''} ${
                    playerThug.chosenPath === p ? 'door-chosen' : ''
                  } ${phase === 'choosing' ? 'door-active' : ''}`}
                  style={{ ['--door-color' as string]: PATH_COLOR[p] }}
                  onClick={() => choosePath(p)}
                  disabled={phase !== 'choosing'}
                >
                  <span className="door-letter">{p}</span>
                </button>
              ))}
            </div>

            <div className="yard-paths">
              {PATHS.map((p) => (
                <div key={p} className={`path path-${p} ${copPath === p ? 'path-cop' : ''}`}>
                  {copPath === p && (
                    <div className="cop-marker">
                      <div className="cop-light" />
                      <span>COP</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Thugs at the bottom */}
            <div className="thug-line">
              {thugs.map((t) => {
                const path = t.chosenPath;
                const reveal = t.isPlayer
                  ? phase !== 'idle'
                  : phase === 'cop-checking' || phase === 'result';
                return (
                  <div
                    key={t.id}
                    className={`thug ${reveal && path ? `thug-on-${path}` : ''} ${
                      t.alive ? '' : 'thug-caught'
                    } ${t.isPlayer ? 'thug-player' : ''}`}
                  >
                    <div className="thug-body">{t.avatar}</div>
                    {t.isPlayer && <div className="you-tag">YOU</div>}
                    {reveal && path && <div className="thug-path-tag">{path}</div>}
                  </div>
                );
              })}
            </div>

            {phase === 'choosing' && (
              <div className="prompt-banner">CHOOSE A DOOR: A, B, or C</div>
            )}

            {phase === 'result' && (
              <div className={`result-banner ${playerThug.alive ? 'win' : 'lose'}`}>
                <div className="result-msg">{resultMsg}</div>
                <button className="btn-play" onClick={reset}>
                  PLAY AGAIN
                </button>
              </div>
            )}
          </div>

          {/* Right: How It Works */}
          <div className="panel how-panel">
            <div className="panel-header how-header">HOW IT WORKS</div>
            <ol className="how-list">
              <li><span className="how-num">1</span><span>10 THUGS CHOOSE 1 OF 3 PATHS</span></li>
              <li><span className="how-num">2</span><span>COP RANDOMLY CHECKS 1 PATH</span></li>
              <li><span className="how-num">3</span><span>CAUGHT THUGS LOSE</span></li>
              <li><span className="how-num">4</span><span>EMPTY PATHS STAY SAFE</span></li>
              <li><span className="how-num">5</span><span>SURVIVORS WIN 10×</span></li>
            </ol>
          </div>
        </div>

        {/* Bottom control bar */}
        <div className="control-bar">
          <div className="bet-block">
            <div className="bar-label">BET</div>
            <div className="bet-controls">
              <button className="bet-btn" onClick={() => adjustBet(-1)} disabled={phase !== 'idle'}>−</button>
              <div className="bet-value">{bet.toLocaleString()}</div>
              <button className="bet-btn" onClick={() => adjustBet(1)} disabled={phase !== 'idle'}>+</button>
            </div>
          </div>

          <div className="cop-block">
            <div className="bar-label">COP CHECKS 1 PATH</div>
            <div className="sirens">
              {PATHS.map((p) => (
                <div
                  key={p}
                  className={`siren ${copPath === p ? 'siren-active' : ''}`}
                  style={{ ['--siren-color' as string]: PATH_COLOR[p] }}
                />
              ))}
            </div>
          </div>

          <div className="win-block">
            <div className="bar-label">POTENTIAL WIN</div>
            <div className="win-value">{potentialWin.toLocaleString()}</div>
          </div>

          <button
            className="btn-play btn-play-main"
            onClick={startRound}
            disabled={phase !== 'idle'}
          >
            {phase === 'idle' ? 'PLAY' : phase === 'choosing' ? 'CHOOSE DOOR' : '...'}
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
          {rounds.length === 0 && <p style={{ color: '#888' }}>No rounds yet.</p>}
          {rounds.map((r) => (
            <div key={r.id} className={`history-row ${r.won ? 'win' : 'lose'}`}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {r.won ? '✓ Won' : '✗ Caught'}
                </div>
                <div style={{ fontSize: 11, color: '#888' }}>
                  {new Date(r.timestamp).toLocaleString()} · Cop: {r.copPath}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#888' }}>Bet {r.bet.toLocaleString()}</div>
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
