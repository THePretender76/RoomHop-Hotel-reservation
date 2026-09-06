import { useState } from 'react';
import { useNavigate, useLocation, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import styles from './SignInPage.module.css';

export default function SignInPage() {
  const { login, register, confirmRegistration, resendRegistrationCode, completeNewPassword, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/search';
  const fromState = location.state?.from?.state || null;
  const redirectPath = new URLSearchParams(location.search).get('redirect') || from;
  const resolvedRedirectPath = redirectPath?.startsWith('/') ? redirectPath : '/admin/dashboard';

  // Tab state: 'signin' or 'signup'
  const [activeTab, setActiveTab] = useState(location.state?.tab || 'signin');

  // Sign In form
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [signInError, setSignInError] = useState('');
  const [signInLoading, setSignInLoading] = useState(false);

  // Sign Up form
  const [signUpFirstName, setSignUpFirstName] = useState('');
  const [signUpLastName, setSignUpLastName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpError, setSignUpError] = useState('');
  const [signUpLoading, setSignUpLoading] = useState(false);

  // Confirmation step
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  // Cognito administrator-created users must set a permanent password first.
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [newPasswordError, setNewPasswordError] = useState('');
  const [newPasswordLoading, setNewPasswordLoading] = useState(false);

  // Redirect if already authenticated
  if (isAuthenticated) {
    return <Navigate to={resolvedRedirectPath} replace state={fromState} />;
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setSignInError('');
    setSignInLoading(true);
    try {
      const result = await login(signInEmail, signInPassword);
      if (result.isSignedIn) {
        navigate(resolvedRedirectPath, { replace: true, state: fromState });
      } else if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setNeedsPasswordChange(true);
      } else if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        setConfirmEmail(signInEmail);
        setNeedsConfirmation(true);
      }
    } catch (err) {
      setSignInError(err.message || 'Invalid email or password.');
    } finally {
      setSignInLoading(false);
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    setSignUpError('');
    setSignUpLoading(true);
    try {
      const result = await register(signUpEmail, signUpPassword, signUpFirstName, signUpLastName);
      if (result.isSignUpComplete) {
        // Auto-confirmed, switch to sign in
        setActiveTab('signin');
        setSignInEmail(signUpEmail);
      } else {
        // Needs confirmation code
        setConfirmEmail(signUpEmail);
        setNeedsConfirmation(true);
      }
    } catch (err) {
      setSignUpError(err.message || 'Registration failed. Please try again.');
    } finally {
      setSignUpLoading(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setConfirmError('');
    setConfirmLoading(true);
    try {
      await confirmRegistration(confirmEmail, confirmCode);
      // After confirmation, auto-sign-in and redirect
      try {
        const result = await login(confirmEmail, signUpPassword || signInPassword);
        if (result.isSignedIn) {
          navigate(resolvedRedirectPath, { replace: true, state: fromState });
          return;
        }
      } catch {
        // Auto sign-in failed, fall back to manual sign-in
      }
      setNeedsConfirmation(false);
      setActiveTab('signin');
      setSignInEmail(confirmEmail);
    } catch (err) {
      setConfirmError(err.message || 'Invalid confirmation code.');
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleNewPassword(e) {
    e.preventDefault();
    setNewPasswordError('');
    if (newPassword !== newPasswordConfirm) {
      setNewPasswordError('Passwords do not match.');
      return;
    }
    setNewPasswordLoading(true);
    try {
      const result = await completeNewPassword(newPassword);
      if (result.isSignedIn) {
        navigate(resolvedRedirectPath, { replace: true, state: fromState });
      }
    } catch (err) {
      setNewPasswordError(err.message || 'Unable to set the new password.');
    } finally {
      setNewPasswordLoading(false);
    }
  }

  if (needsPasswordChange) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h1 className={styles.title}>Set your password</h1>
            <p className={styles.subtitle}>Choose a permanent password for your RoomHop account.</p>
          </div>
          <form onSubmit={handleNewPassword} className={styles.form}>
            {newPasswordError && <div className={styles.error}>{newPasswordError}</div>}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-password">New password</label>
              <input id="new-password" className={styles.input} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} autoFocus required />
              <small className={styles.passwordHint}>At least 8 characters, with uppercase, lowercase, number, and symbol.</small>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-password-confirm">Confirm new password</label>
              <input id="new-password-confirm" className={styles.input} type="password" value={newPasswordConfirm} onChange={(e) => setNewPasswordConfirm(e.target.value)} minLength={8} required />
            </div>
            <button type="submit" className={styles.submitBtn} disabled={newPasswordLoading || !newPassword || !newPasswordConfirm}>
              {newPasswordLoading ? 'Saving...' : 'Set password and sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  async function handleResendCode() {
    setConfirmError('');
    setConfirmMessage('');
    setResendLoading(true);
    try {
      await resendRegistrationCode(confirmEmail);
      setConfirmMessage(`A new confirmation code was sent to ${confirmEmail}.`);
    } catch (err) {
      setConfirmError(err.message || 'Unable to resend the confirmation code.');
    } finally {
      setResendLoading(false);
    }
  }

  // Confirmation code view
  if (needsConfirmation) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h1 className={styles.title}>Verify Your Email</h1>
            <p className={styles.subtitle}>We sent a confirmation code to <strong>{confirmEmail}</strong></p>
          </div>

          <form onSubmit={handleConfirm} className={styles.form}>
            {confirmError && <div className={styles.error}>{confirmError}</div>}
            {confirmMessage && <div className={styles.success}>{confirmMessage}</div>}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="confirm-code">Confirmation Code</label>
              <input
                id="confirm-code"
                className={styles.input}
                type="text"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="Enter 6-digit code"
                autoFocus
                required
              />
            </div>

            <button type="submit" className={styles.submitBtn} disabled={confirmLoading || !confirmCode.trim()}>
              {confirmLoading ? 'Verifying...' : 'Verify Email'}
            </button>
          </form>

          <p className={styles.switchText}>
            Didn&apos;t receive the code?{' '}
            <button type="button" className={styles.switchLink} onClick={handleResendCode} disabled={resendLoading}>
              {resendLoading ? 'Sending...' : 'Resend code'}
            </button>
          </p>

          <p className={styles.switchText}>
            <button type="button" className={styles.switchLink} onClick={() => setNeedsConfirmation(false)}>
              ← Back to Sign In
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <Link to="/" className={styles.brandLink}>
            <span className={styles.brandName}>RoomHop</span>
          </Link>
          <p className={styles.subtitle}>
            {activeTab === 'signin' ? 'Welcome back! Sign in to your account.' : 'Create an account to start booking.'}
          </p>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'signin' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('signin')}
          >
            Sign In
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'signup' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('signup')}
          >
            Sign Up
          </button>
        </div>

        {/* Sign In Form */}
        {activeTab === 'signin' && (
          <form onSubmit={handleSignIn} className={styles.form}>
            {signInError && <div className={styles.error}>{signInError}</div>}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="signin-email">Email</label>
              <input
                id="signin-email"
                className={styles.input}
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="signin-password">Password</label>
              <input
                id="signin-password"
                className={styles.input}
                type="password"
                value={signInPassword}
                onChange={(e) => setSignInPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
            </div>

            <button type="submit" className={styles.submitBtn} disabled={signInLoading || !signInEmail.trim() || !signInPassword}>
              {signInLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* Sign Up Form */}
        {activeTab === 'signup' && (
          <form onSubmit={handleSignUp} className={styles.form}>
            {signUpError && <div className={styles.error}>{signUpError}</div>}

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="signup-first">First Name</label>
                <input
                  id="signup-first"
                  className={styles.input}
                  type="text"
                  value={signUpFirstName}
                  onChange={(e) => setSignUpFirstName(e.target.value)}
                  placeholder="First name"
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="signup-last">Last Name</label>
                <input
                  id="signup-last"
                  className={styles.input}
                  type="text"
                  value={signUpLastName}
                  onChange={(e) => setSignUpLastName(e.target.value)}
                  placeholder="Last name"
                  required
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                className={styles.input}
                type="email"
                value={signUpEmail}
                onChange={(e) => setSignUpEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                className={styles.input}
                type="password"
                value={signUpPassword}
                onChange={(e) => setSignUpPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                minLength={8}
              />
            </div>

            <button type="submit" className={styles.submitBtn} disabled={signUpLoading || !signUpEmail.trim() || !signUpPassword || !signUpFirstName.trim() || !signUpLastName.trim()}>
              {signUpLoading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
        )}

        <p className={styles.switchText}>
          {activeTab === 'signin' ? (
            <>Don&apos;t have an account? <button className={styles.switchLink} onClick={() => setActiveTab('signup')}>Sign up</button></>
          ) : (
            <>Already have an account? <button className={styles.switchLink} onClick={() => setActiveTab('signin')}>Sign in</button></>
          )}
        </p>
      </div>
    </div>
  );
}
