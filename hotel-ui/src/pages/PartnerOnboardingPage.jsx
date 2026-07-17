import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const initialState = {
  fullName: '',
  corporateEmail: '',
  phoneNumber: '',
  companyName: '',
  taxId: '',
  headOfficeAddress: '',
  estimatedProperties: '',
  primaryCity: '',
  websiteUrl: '',
};

export default function PartnerOnboardingPage() {
  const navigate = useNavigate();
  const { setPartnerStatus } = useAuth();
  const [form, setForm] = useState(initialState);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiPost('/v1/admin/partners/applications', {
        ...form,
        estimatedProperties: Number(form.estimatedProperties) || 0,
      });

      setPartnerStatus('pending');
      navigate('/onboarding/pending-review', { replace: true, state: { applicantId: response?.applicantId } });
    } catch (err) {
      setError(err.message || 'We could not submit your application.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '3rem auto', padding: '0 1rem' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Professional Hotel Partner Registration</h1>
      <p style={{ marginBottom: '2rem', color: '#4b5563' }}>
        Submit your corporate details and we will review your application before you can manage properties.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        {error && <div style={{ color: '#b91c1c' }}>{error}</div>}

        <fieldset style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: '1rem' }}>
          <legend>Account Credentials</legend>
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            <input name="fullName" value={form.fullName} onChange={handleChange} placeholder="Full Name" required />
            <input name="corporateEmail" type="email" value={form.corporateEmail} onChange={handleChange} placeholder="Corporate Email Address" required />
            <input name="phoneNumber" value={form.phoneNumber} onChange={handleChange} placeholder="Phone Number" required />
          </div>
        </fieldset>

        <fieldset style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: '1rem' }}>
          <legend>Corporate Details</legend>
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            <input name="companyName" value={form.companyName} onChange={handleChange} placeholder="Registered Company Name" required />
            <input name="taxId" value={form.taxId} onChange={handleChange} placeholder="Corporate Tax ID / VAT Number" required />
            <textarea name="headOfficeAddress" value={form.headOfficeAddress} onChange={handleChange} placeholder="Head Office Physical Address" required rows={3} />
          </div>
        </fieldset>

        <fieldset style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: '1rem' }}>
          <legend>Property Overview</legend>
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            <input name="estimatedProperties" type="number" min="1" value={form.estimatedProperties} onChange={handleChange} placeholder="Estimated number of properties" required />
            <input name="primaryCity" value={form.primaryCity} onChange={handleChange} placeholder="Primary city / destination" required />
            <input name="websiteUrl" type="url" value={form.websiteUrl} onChange={handleChange} placeholder="Company Website URL" required />
          </div>
        </fieldset>

        <button type="submit" disabled={loading} style={{ padding: '0.8rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8 }}>
          {loading ? 'Submitting...' : 'Submit Application'}
        </button>
      </form>
    </div>
  );
}
