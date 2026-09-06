import { useCallback, useEffect, useState } from 'react';
import {
  signIn,
  signUp,
  signOut,
  confirmSignUp,
  confirmSignIn,
  resendSignUpCode,
  getCurrentUser,
  fetchUserAttributes,
  fetchAuthSession,
} from 'aws-amplify/auth';
import { isAuthEnabled } from './amplifyConfig';
import { AuthContext } from './useAuth';

const authEnabled = isAuthEnabled();

async function loadCurrentUser(forceRefresh = false) {
  const [currentUser, attributes, session] = await Promise.all([
    getCurrentUser(),
    fetchUserAttributes(),
    fetchAuthSession({ forceRefresh }),
  ]);
  const groups = session.tokens?.idToken?.payload?.['cognito:groups'] || [];
  return { ...currentUser, attributes, groups };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(authEnabled);
  const [localPartnerStatus, setLocalPartnerStatus] = useState('guest');

  const checkUser = useCallback(async (forceRefresh = false) => {
    try {
      const authenticatedUser = await loadCurrentUser(forceRefresh);
      setUser(authenticatedUser);
      return authenticatedUser;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authEnabled) return undefined;
    let active = true;
    loadCurrentUser()
      .then((authenticatedUser) => {
        if (active) setUser(authenticatedUser);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function login(email, password) {
    const result = await signIn({ username: email, password });
    const authenticatedUser = result.isSignedIn ? await checkUser() : null;
    return { ...result, user: authenticatedUser };
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

  async function completeNewPassword(newPassword) {
    const result = await confirmSignIn({ challengeResponse: newPassword });
    const authenticatedUser = result.isSignedIn ? await checkUser() : null;
    return { ...result, user: authenticatedUser };
  }

  async function resendRegistrationCode(email) {
    return resendSignUpCode({ username: email });
  }

  async function logout() {
    await signOut();
    setUser(null);
    setLocalPartnerStatus('guest');
  }

  const getToken = useCallback(async () => {
    if (!authEnabled || !user) return null;
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() || null;
    } catch {
      return null;
    }
  }, [user]);

  const groupStatus = user?.groups?.includes('HotelPartner')
    ? 'approved'
    : user?.groups?.includes('HotelPartnerPending')
      ? 'pending'
      : null;
  const partnerStatus = groupStatus
    || user?.attributes?.['custom:partner_status']
    || localPartnerStatus;

  const value = {
    user,
    loading,
    login,
    register,
    confirmRegistration,
    completeNewPassword,
    resendRegistrationCode,
    logout,
    getToken,
    isAuthenticated: Boolean(user),
    partnerStatus,
    setPartnerStatus: setLocalPartnerStatus,
    refreshUser: checkUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
