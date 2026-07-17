import { createContext, useContext, useState, useEffect } from 'react';
import { signIn, signUp, signOut, confirmSignUp, getCurrentUser, fetchUserAttributes, fetchAuthSession } from 'aws-amplify/auth';
import { isAuthEnabled } from './amplifyConfig';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [partnerStatus, setPartnerStatusState] = useState('guest');

  useEffect(() => {
    if (!isAuthEnabled()) {
      setLoading(false);
      return;
    }
    checkUser();
  }, []);

  async function checkUser() {
    try {
      const currentUser = await getCurrentUser();
      const attrs = await fetchUserAttributes();
      const session = await fetchAuthSession();
      const groups = session.tokens?.idToken?.payload?.['cognito:groups'] || [];
      setUser({ ...currentUser, attributes: attrs, groups });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(email, password) {
    const result = await signIn({ username: email, password });
    if (result.isSignedIn) {
      await checkUser();
    }
    return result;
  }

  async function register(email, password, givenName, familyName) {
    return signUp({
      username: email,
      password,
      options: { userAttributes: { email, given_name: givenName, family_name: familyName } },
    });
  }

  async function confirmRegistration(email, code) {
    return confirmSignUp({ username: email, confirmationCode: code });
  }

  async function logout() {
    await signOut();
    setUser(null);
    setPartnerStatusState('guest');
  }

  async function getToken() {
    if (!isAuthEnabled() || !user) return null;
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() || null;
    } catch {
      return null;
    }
  }

  function setPartnerStatus(value) {
    setPartnerStatusState(value);
  }

  const derivedPartnerStatus = user?.attributes?.['custom:partner_status'] || partnerStatus;

  return (
    <AuthContext.Provider value={{ user, loading, login, register, confirmRegistration, logout, getToken, isAuthenticated: !!user, partnerStatus: derivedPartnerStatus, setPartnerStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
