import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { isAuthEnabled } from './amplifyConfig';

export default function PrivateRoute({ children, requiredGroup }) {
  const { isAuthenticated, loading, user, partnerStatus } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !isAuthenticated && location.state) {
      try {
        sessionStorage.setItem('rh_pending_booking', JSON.stringify(location.state));
      } catch {
        // Navigation state still carries the booking when storage is unavailable.
      }
    }
  }, [isAuthenticated, loading, location.state]);

  // If auth is disabled (local dev), allow access
  if (!isAuthEnabled()) return children;

  // Show nothing while checking auth
  if (loading) return <div style={{ padding: '100px', textAlign: 'center' }}>Loading...</div>;

  // Redirect to sign-in with return path and preserve booking state
  if (!isAuthenticated) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  if (requiredGroup && !user?.groups?.includes(requiredGroup)) {
    if (requiredGroup === 'HotelPartner' && partnerStatus === 'pending') {
      return <Navigate to="/onboarding/pending-review" replace />;
    }
    if (requiredGroup === 'SuperAdmin') {
      return <Navigate to="/" replace />;
    }
    return <Navigate to="/onboarding/professional" replace />;
  }

  return children;
}
