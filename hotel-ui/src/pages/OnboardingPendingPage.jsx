import { useEffect } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { readPartnerApplication } from './partnerApplication';
import styles from './PartnerOnboardingPage.module.css';

export default function OnboardingPendingPage() {
  const location = useLocation();
  const { partnerStatus, refreshUser } = useAuth();
  const storedApplication = readPartnerApplication();
  const applicantId = location.state?.applicantId ?? storedApplication.applicantId;
  const corporateEmail = location.state?.corporateEmail ?? storedApplication.corporateEmail;

  useEffect(() => {
    // Approval changes Cognito groups outside the current browser session.
    // Force a token refresh so the new HotelPartner group is visible immediately.
    refreshUser(true);
  }, [refreshUser]);

  if (partnerStatus === 'approved') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <div className={`${styles.page} ${styles.successPage}`}>
      <main className={styles.successCard} aria-labelledby="application-submitted-title">
        <div className={styles.successIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="m5 12 4 4L19 6" />
          </svg>
        </div>

        <p className={styles.successEyebrow}>Request received</p>
        <h1 id="application-submitted-title">Application submitted</h1>
        <p className={styles.successCopy}>
          Your hotel partner request is now under review. You should receive a confirmation
          email shortly{corporateEmail ? <> at <strong>{corporateEmail}</strong></> : null}.
        </p>

        {applicantId && (
          <div className={styles.reference}>
            <span>Application reference</span>
            <strong>#{applicantId}</strong>
          </div>
        )}

        <ol className={styles.reviewSteps} aria-label="Application status">
          <li className={styles.reviewStepComplete}>
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Submitted</strong>
              <small>Your application was received</small>
            </div>
          </li>
          <li className={styles.reviewStepCurrent} aria-current="step">
            <span aria-hidden="true">2</span>
            <div>
              <strong>Partner review</strong>
              <small>Usually completed in 1–2 business days</small>
            </div>
          </li>
          <li>
            <span aria-hidden="true">3</span>
            <div>
              <strong>Dashboard access</strong>
              <small>Available as soon as your request is approved</small>
            </div>
          </li>
        </ol>

        <div className={styles.emailNote}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16v14H4z" />
            <path d="m4 7 8 6 8-6" />
          </svg>
          <p>
            Email delivery can take a few minutes. We will also email you when a decision is ready.
          </p>
        </div>

        <div className={styles.successActions}>
          <Link to="/" className={styles.primaryLink}>Return home</Link>
          <Link to="/search" className={styles.secondaryLink}>Browse hotels</Link>
        </div>
      </main>
    </div>
  );
}
