import { useState } from 'react';
import { useAuth } from './auth';
import './TopBar.css';

export function TopBar({ onShowHistory }: { onShowHistory: () => void }) {
  const { user, logout, updateBalance, setBalance } = useAuth();
  const [open, setOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('10000');

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
        <button className="menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu">
          <span /><span /><span />
        </button>

        <div className="topbar-center">
          <div className="brand">
            <div className="brand-badge">CP</div>
            <span>CRIMINAL PRISONER</span>
          </div>
        </div>

        <div className="balance-block">
          <button className="balance-btn" onClick={() => setDepositOpen(true)}>
            <div className="balance-coin">$</div>
            <div className="balance-num">{user.balance.toLocaleString()}</div>
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
