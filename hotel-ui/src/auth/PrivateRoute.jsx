import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { isAuthEnabled } from './amplifyConfig';

export default function PrivateRoute({ children, requiredGroup }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  // If auth is disabled (local dev), allow access
  if (!isAuthEnabled()) return children;

  // Show nothing while checking auth
  if (loading) return <div style={{ padding: '100px', textAlign: 'center' }}>Loading...</div>;

  // Redirect to sign-in with return path and preserve booking state
  if (!isAuthenticated) {
    // Save booking state to sessionStorage so it survives the auth flow
    if (location.state) {
      sessionStorage.setItem('rh_pending_booking', JSON.stringify(location.state));
    }
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  if (requiredGroup && !user?.groups?.includes(requiredGroup)) {
    return <Navigate to="/onboarding/professional" replace />;
  }

  return children;
}
