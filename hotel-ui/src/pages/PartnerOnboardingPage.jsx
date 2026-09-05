import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api/client';
import { useAuth } from '../auth/useAuth';
import {
  buildPartnerApplicationPayload,
  savePartnerApplication,
} from './partnerApplication';
import styles from './PartnerOnboardingPage.module.css';

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

function Field({ label, name, type = 'text', value, onChange, ...inputProps }) {
  const inputId = `partner-${name}`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}<span aria-hidden="true"> *</span>
      </label>
      <input
        {...inputProps}
        className={styles.input}
        id={inputId}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        required
      />
    </div>
  );
}

export default function PartnerOnboardingPage() {
  const navigate = useNavigate();
  const { setPartnerStatus } = useAuth();
  const errorRef = useRef(null);
  const [form, setForm] = useState(initialState);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;

    setError('');
    setLoading(true);

    try {
      const payload = buildPartnerApplicationPayload(form);
      const response = await apiPost('/v1/admin/partners/applications', payload);
      const application = {
        applicantId: response?.applicantId,
        corporateEmail: payload.corporateEmail,
        submittedAt: new Date().toISOString(),
      };

      savePartnerApplication(application);
      setPartnerStatus('pending');
      navigate('/onboarding/pending-review', {
        replace: true,
        state: application,
      });
    } catch (err) {
      setError(err.message || 'We could not submit your application. Please try again.');
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.container} aria-labelledby="partner-onboarding-title">
        <header className={styles.pageHeader}>
          <p className={styles.eyebrow}>RoomHop for hotel partners</p>
          <h1 id="partner-onboarding-title">Register your hotel business</h1>
          <p>
            Tell us about your company. Our partner team will review your request before
            giving you access to property management tools.
          </p>
        </header>

        <div className={styles.layout}>
          <aside className={styles.progressCard} aria-label="Application process">
            <p className={styles.progressEyebrow}>Application process</p>
            <ol className={styles.steps}>
              <li className={styles.activeStep} aria-current="step">
                <span className={styles.stepNumber}>1</span>
                <span>
                  <strong>Company profile</strong>
                  <small>Share your business details</small>
                </span>
              </li>
              <li>
                <span className={styles.stepNumber}>2</span>
                <span>
                  <strong>Partner review</strong>
                  <small>Usually 1–2 business days</small>
                </span>
              </li>
              <li>
                <span className={styles.stepNumber}>3</span>
                <span>
                  <strong>Manage properties</strong>
                  <small>Access your partner dashboard</small>
                </span>
              </li>
            </ol>
            <div className={styles.progressNote}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                <path d="M12 10v6M12 7h.01" />
              </svg>
              <p>Your details are used only to review and manage your partner account.</p>
            </div>
          </aside>

          <div className={styles.formCard}>
            <div className={styles.formHeader}>
              <div>
                <p className={styles.formKicker}>Professional registration</p>
                <h2>Tell us about your business</h2>
              </div>
              <p className={styles.requiredNote}><span aria-hidden="true">*</span> Required fields</p>
            </div>

            <form className={styles.form} onSubmit={handleSubmit} aria-busy={loading}>
              {error && (
                <div
                  className={styles.error}
                  ref={errorRef}
                  role="alert"
                  tabIndex="-1"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 9v4M12 17h.01" />
                    <path d="M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                  </svg>
                  <div>
                    <strong>We could not submit your application.</strong>
                    <p>{error}</p>
                  </div>
                </div>
              )}

              <section className={styles.section} aria-labelledby="contact-heading">
                <div className={styles.sectionHeading}>
                  <span aria-hidden="true">01</span>
                  <div>
                    <h3 id="contact-heading">Contact person</h3>
                    <p>Who should we contact about this application?</p>
                  </div>
                </div>
                <div className={styles.grid}>
                  <Field
                    autoComplete="name"
                    disabled={loading}
                    label="Full name"
                    name="fullName"
                    onChange={handleChange}
                    placeholder="Kamel Brown"
                    value={form.fullName}
                  />
                  <Field
                    autoComplete="email"
                    disabled={loading}
                    label="Corporate email"
                    name="corporateEmail"
                    onChange={handleChange}
                    placeholder="you@company.com"
                    type="email"
                    value={form.corporateEmail}
                  />
                  <Field
                    autoComplete="tel"
                    disabled={loading}
                    label="Phone number"
                    name="phoneNumber"
                    onChange={handleChange}
                    placeholder="+33 6 00 00 00 00"
                    type="tel"
                    value={form.phoneNumber}
                  />
                </div>
              </section>

              <section className={styles.section} aria-labelledby="company-heading">
                <div className={styles.sectionHeading}>
                  <span aria-hidden="true">02</span>
                  <div>
                    <h3 id="company-heading">Company details</h3>
                    <p>Use the legal details registered for your hospitality business.</p>
                  </div>
                </div>
                <div className={styles.grid}>
                  <Field
                    autoComplete="organization"
                    disabled={loading}
                    label="Registered company name"
                    name="companyName"
                    onChange={handleChange}
                    placeholder="Amadeus Hospitality Group"
                    value={form.companyName}
                  />
                  <Field
                    disabled={loading}
                    label="Tax ID / VAT number"
                    name="taxId"
                    onChange={handleChange}
                    placeholder="Your registration number"
                    value={form.taxId}
                  />
                  <div className={`${styles.field} ${styles.fullWidth}`}>
                    <label className={styles.label} htmlFor="partner-headOfficeAddress">
                      Head office address<span aria-hidden="true"> *</span>
                    </label>
                    <textarea
                      autoComplete="street-address"
                      className={styles.input}
                      disabled={loading}
                      id="partner-headOfficeAddress"
                      name="headOfficeAddress"
                      onChange={handleChange}
                      placeholder="Street, postal code, city, country"
                      required
                      rows="3"
                      value={form.headOfficeAddress}
                    />
                  </div>
                </div>
              </section>

              <section className={styles.section} aria-labelledby="portfolio-heading">
                <div className={styles.sectionHeading}>
                  <span aria-hidden="true">03</span>
                  <div>
                    <h3 id="portfolio-heading">Property portfolio</h3>
                    <p>Give us a quick overview of where you operate today.</p>
                  </div>
                </div>
                <div className={styles.grid}>
                  <Field
                    disabled={loading}
                    inputMode="numeric"
                    label="Estimated properties"
                    min="1"
                    name="estimatedProperties"
                    onChange={handleChange}
                    placeholder="5"
                    step="1"
                    type="number"
                    value={form.estimatedProperties}
                  />
                  <Field
                    autoComplete="address-level2"
                    disabled={loading}
                    label="Primary city or destination"
                    name="primaryCity"
                    onChange={handleChange}
                    placeholder="Antibes"
                    value={form.primaryCity}
                  />
                  <Field
                    autoComplete="url"
                    disabled={loading}
                    label="Company website"
                    name="websiteUrl"
                    onChange={handleChange}
                    placeholder="https://company.com"
                    type="url"
                    value={form.websiteUrl}
                  />
                </div>
              </section>

              <div className={styles.actions}>
                <p id="submission-note">
                  By submitting, you confirm that these business details are accurate.
                </p>
                <button
                  aria-describedby="submission-note"
                  className={styles.submitButton}
                  disabled={loading}
                  type="submit"
                >
                  {loading ? (
                    <>
                      <span className={styles.spinner} aria-hidden="true" />
                      Submitting application…
                    </>
                  ) : (
                    <>
                      Submit for review
                      <span className={styles.arrow} aria-hidden="true">→</span>
                    </>
                  )}
                </button>
              </div>
              {loading && <p className={styles.srOnly} role="status">Submitting your partner application.</p>}
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
