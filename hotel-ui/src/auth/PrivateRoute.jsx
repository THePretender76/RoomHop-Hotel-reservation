import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { isAuthEnabled } from './amplifyConfig';

export default function PrivateRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // If auth is disabled (local dev), allow access
  if (!isAuthEnabled()) return children;

  // Show nothing while checking auth
  if (loading) return <div style={{ padding: '100px', textAlign: 'center' }}>Loading...</div>;

  // Redirect to sign-in with return path
  if (!isAuthenticated) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  return children;
}
