import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
import { isMuted, toggleMuted, sfx } from './sound';
import './TopBar.css';

/** Tweens a number from previous → current over ~600ms whenever it changes.
 *  Adds a CSS class while ticking to glow the balance pill. */
function useTickingNumber(target: number): { display: number; isTicking: boolean; trend: 'up' | 'down' | null } {
  const [display, setDisplay] = useState(target);
  const [trend, setTrend] = useState<'up' | 'down' | null>(null);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === display) return;
    setTrend(target > fromRef.current ? 'up' : 'down');
    fromRef.current = display;
    startRef.current = performance.now();
    const duration = 700;
    const step = (now: number) => {
      const t = Math.min(1, (now - (startRef.current ?? now)) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setDisplay(v);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        // clear trend after a short hold so the glow fades
        window.setTimeout(() => setTrend(null), 400);
      }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return { display, isTicking: trend !== null, trend };
}

export function TopBar({
  onShowHistory,
  onShowRules,
}: {
  onShowHistory: () => void;
  onShowRules: () => void;
}) {
  const { user, logout, updateBalance, setBalance } = useAuth();
  const [open, setOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('10000');
  const [muted, setMutedState] = useState(isMuted());

  // Hooks must run unconditionally — call before any early return.
  const { display: tickedBalance, isTicking, trend } = useTickingNumber(user?.balance ?? 0);

  if (!user) return null;

  const initials = user.name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const submitDeposit = () => {
    const amt = parseInt(depositAmount.replace(/\D/g, ''), 10);
    if (!isNaN(amt) && amt > 0) {
      updateBalance(amt);
      setDepositOpen(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <button className="menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <span /><span /><span />
          </button>
          <button className="rules-btn" onClick={onShowRules} aria-label="How to play" title="How to play">
            ?
          </button>
          <button
            className="rules-btn mute-btn"
            onClick={() => {
              const next = toggleMuted();
              setMutedState(next);
              if (!next) sfx.click(); // brief audible confirmation when unmuting
            }}
            aria-label={muted ? 'Unmute' : 'Mute'}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {/* Custom speaker icon — waves when on, an X when muted. */}
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M4 9.5h3l4-3.5v12l-4-3.5H4z"
                fill="currentColor" stroke="currentColor" strokeWidth="1.6"
                strokeLinejoin="round"
              />
              {muted ? (
                <path d="M15.5 9.5l4 5m0-5l-4 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              ) : (
                <>
                  <path d="M15 9.5a4 4 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M17.5 7.5a7 7 0 0 1 0 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </>
              )}
            </svg>
          </button>
        </div>

        <div className="topbar-center">
          <div className="brand">
            <div className="brand-badge">ESC</div>
          </div>
        </div>

        <div className="balance-block">
          <button
            className={`balance-btn ${isTicking ? 'balance-ticking' : ''} ${trend ? `balance-${trend}` : ''}`}
            onClick={() => setDepositOpen(true)}
          >
            <div className="balance-coin">$</div>
            <div className="balance-num">{tickedBalance.toLocaleString()}</div>
            <div className="balance-plus">+</div>
          </button>
          <div className="user-avatar" title={user.name}>
            {user.avatar ? <img src={user.avatar} alt={user.name} /> : <span>{initials}</span>}
          </div>
        </div>

        {open && (
          <div className="menu-drop">
            <div className="menu-user">
              <div className="user-avatar large">
                {user.avatar ? <img src={user.avatar} alt={user.name} /> : <span>{initials}</span>}
              </div>
              <div>
                <div className="menu-name">{user.name}</div>
                <div className="menu-email">{user.email ?? user.provider}</div>
              </div>
            </div>
            <button className="menu-item" onClick={() => { setDepositOpen(true); setOpen(false); }}>
              💰 Deposit (Test)
            </button>
            <button className="menu-item" onClick={() => { setBalance(0); setOpen(false); }}>
              ↺ Reset Balance
            </button>
            <button className="menu-item" onClick={() => { onShowHistory(); setOpen(false); }}>
              📜 Game History
            </button>
            <button className="menu-item" onClick={() => { onShowRules(); setOpen(false); }}>
              ❓ How to Play
            </button>
            <button className="menu-item danger" onClick={logout}>
              ⎋ Sign Out
            </button>
          </div>
        )}
      </div>

      {depositOpen && (
        <div className="modal-backdrop" onClick={() => setDepositOpen(false)}>
          <div className="modal modal-deposit" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>DEPOSIT (TEST)</h2>
              <button className="modal-x" onClick={() => setDepositOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ color: '#888', fontSize: 13, marginTop: 0 }}>
                Add any amount to your test balance. No real money is involved.
              </p>
              <div className="quick-amts">
                {[10000, 50000, 100000, 500000, 1000000].map((amt) => (
                  <button
                    key={amt}
                    className="quick-amt"
                    onClick={() => setDepositAmount(String(amt))}
                  >
                    +{amt.toLocaleString()}
                  </button>
                ))}
              </div>
              <input
                className="deposit-input"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="Amount"
                inputMode="numeric"
              />
              <button className="btn-play" onClick={submitDeposit}>
                ADD {parseInt(depositAmount || '0', 10).toLocaleString()} TO BALANCE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
