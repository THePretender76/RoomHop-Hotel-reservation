import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiPut } from '../api/client';

export default function SuperAdminReviewPage() {
  const { applicantId } = useParams();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const data = await apiGet('/v1/admin/partners/applications');
        setApplications(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err.message || 'Unable to load applications');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  async function handleReview(status) {
    try {
      await apiPut(`/v1/admin/partners/applications/${applicantId}/review`, { status });
      setApplications((current) => current.map((item) => item.admin_id === Number(applicantId) ? { ...item, status } : item));
    } catch (err) {
      setError(err.message || 'Unable to update review');
    }
  }

  const application = applications.find((item) => item.admin_id === Number(applicantId));

  if (loading) return <div style={{ padding: '3rem' }}>Loading review...</div>;

  return (
    <div style={{ maxWidth: 900, margin: '3rem auto', padding: '0 1rem 3rem' }}>
      <h1>Super Admin Review</h1>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {application ? (
        <div style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: '1rem' }}>
          <p><strong>Company:</strong> {application.company_name}</p>
          <p><strong>Tax ID:</strong> {application.tax_id}</p>
          <p><strong>Contact:</strong> {application.full_name} / {application.corporate_email}</p>
          <p><strong>Status:</strong> {application.status}</p>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button onClick={() => handleReview('APPROVED')} style={{ padding: '0.8rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8 }}>Approve</button>
            <button onClick={() => handleReview('REJECTED')} style={{ padding: '0.8rem 1rem', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 8 }}>Reject</button>
          </div>
        </div>
      ) : (
        <p>No matching application.</p>
      )}
    </div>
  );
}
