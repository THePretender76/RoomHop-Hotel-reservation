import { useLocation, Link } from 'react-router-dom';

export default function OnboardingPendingPage() {
  const location = useLocation();
  const applicantId = location.state?.applicantId;

  return (
    <div style={{ maxWidth: 760, margin: '3rem auto', padding: '0 1rem' }}>
      <h1>Application Submitted</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
        Your hotel partner request is now under review. Once approved, you will receive an email and be able to access the admin dashboard.
      </p>
      {applicantId && <p><strong>Reference:</strong> {applicantId}</p>}
      <Link to="/" style={{ color: '#2563eb' }}>Return home</Link>
    </div>
  );
}
