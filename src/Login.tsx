import { useState } from 'react';
import { useAuth } from './auth';
import './Login.css';

export function Login() {
  const { loginGuest, loginGoogle, loginEmail } = useAuth();
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (email && name) loginEmail(email, name);
  };

  return (
    <div className="login-screen">
      <div className="login-bg" />
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-badge">CP</div>
          <h1>CRIMINAL PRISONER</h1>
          <p className="tagline">10 THUGS · 3 PATHS · 1 COP</p>
        </div>

        {!showEmail ? (
          <div className="login-buttons">
            <button className="btn btn-google" onClick={loginGoogle}>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                />
              </svg>
              Continue with Google
            </button>
            <button className="btn btn-guest" onClick={loginGuest}>
              Play as Guest
            </button>
            <button className="btn btn-link" onClick={() => setShowEmail(true)}>
              Sign in with Email
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={submitEmail}>
            <input
              type="text"
              placeholder="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-primary">
              Sign In
            </button>
            <button type="button" className="btn btn-link" onClick={() => setShowEmail(false)}>
              ← Back
            </button>
          </form>
        )}

        <p className="login-footer">
          Demo mode · No real money · localStorage only
        </p>
      </div>
    </div>
  );
}
