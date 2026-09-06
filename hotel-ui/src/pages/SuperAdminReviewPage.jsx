import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPut } from '../api/client';
import styles from './SuperAdminReviewPage.module.css';

function StatusBadge({ status }) {
  return <span className={`${styles.status} ${styles[`status${status}`]}`}>{status}</span>;
}

export default function SuperAdminReviewPage() {
  const { applicantId } = useParams();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try { setApplications((await apiGet('/v1/admin/partners/applications')) || []); }
      catch (err) { setError(err.message || 'Unable to load applications'); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  async function handleReview(status) {
    try {
      await apiPut(`/v1/admin/partners/applications/${applicantId}/review`, { status });
      setApplications((items) => items.map((item) => item.admin_id === Number(applicantId) ? { ...item, status } : item));
    } catch (err) { setError(err.message || 'Unable to update review'); }
  }

  const application = applicantId ? applications.find((item) => item.admin_id === Number(applicantId)) : null;
  const pendingCount = applications.filter((item) => item.status === 'PENDING').length;
  if (loading) return <main className={styles.page}><div className={styles.container}>Loading applications...</div></main>;

  return <main className={styles.page} aria-labelledby="review-title"><div className={styles.container}>
    <header className={styles.pageHeader}><p className={styles.eyebrow}>RoomHop operations</p><h1 id="review-title">Partner applications</h1><p>Review hotel partner applications and grant access to property management tools.</p></header>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {!applicantId ? <section className={styles.reviewCard} aria-label="Partner applications">
      <div className={styles.cardHeader}><div><p className={styles.cardKicker}>Review queue</p><h2>Applications awaiting review</h2></div><span className={styles.counter}>{pendingCount} pending</span></div>
      {applications.length ? <div className={styles.applicationList}>{applications.map((item) => <article className={styles.application} key={item.admin_id}>
        <div className={styles.applicationMain}><div className={styles.companyMark} aria-hidden="true">{item.company_name?.charAt(0) || 'H'}</div><div><h3>{item.company_name}</h3><p>{item.full_name} · {item.corporate_email}</p></div></div>
        <div className={styles.applicationActions}><StatusBadge status={item.status} /><Link className={styles.reviewLink} to={`/admin/super/reviews/${item.admin_id}`}>Review application <span aria-hidden="true">→</span></Link></div>
      </article>)}</div> : <p className={styles.empty}>There are no partner applications to review.</p>}
    </section> : application ? <section className={styles.reviewCard} aria-label="Application details">
      <div className={styles.cardHeader}><div><p className={styles.cardKicker}>Application details</p><h2>{application.company_name}</h2></div><StatusBadge status={application.status} /></div>
      <dl className={styles.details}><div><dt>Tax ID / VAT number</dt><dd>{application.tax_id}</dd></div><div><dt>Contact person</dt><dd>{application.full_name}</dd></div><div><dt>Corporate email</dt><dd>{application.corporate_email}</dd></div></dl>
      <div className={styles.actions}><Link className={styles.backLink} to="/admin/super/reviews">← Back to applications</Link><div className={styles.decisionButtons}><button className={styles.rejectButton} disabled={application.status !== 'PENDING'} onClick={() => handleReview('REJECTED')}>Reject</button><button className={styles.approveButton} disabled={application.status !== 'PENDING'} onClick={() => handleReview('APPROVED')}>Approve application</button></div></div>
    </section> : <section className={styles.reviewCard}><p className={styles.empty}>No matching application was found.</p><Link className={styles.backLink} to="/admin/super/reviews">← Back to applications</Link></section>}
  </div></main>;
}
