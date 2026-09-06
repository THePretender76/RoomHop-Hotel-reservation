import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import styles from './AdminDashboardPage.module.css';

const quickActions = [
  {
    number: '01',
    title: 'Create a new property',
    description: 'Add your hotel details, room types, prices, and available inventory.',
    to: '/admin/properties/new',
    action: 'Register a property',
  },
  {
    number: '02',
    title: 'Review room inventory',
    description: 'Keep room availability and accommodation details up to date.',
    to: '/admin/dashboard',
    action: 'View inventory',
  },
  {
    number: '03',
    title: 'Adjust pricing',
    description: 'Review nightly rates and prepare seasonal pricing for your properties.',
    to: '/admin/dashboard',
    action: 'Manage pricing',
  },
];

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const firstName = user?.attributes?.given_name;

  return (
    <div className={styles.page}>
      <main className={styles.container} aria-labelledby="dashboard-title">
        <header className={styles.pageHeader}>
          <p className={styles.eyebrow}>RoomHop partner portal</p>
          <h1 id="dashboard-title">{firstName ? `Welcome, ${firstName}` : 'Hotel Admin Dashboard'}</h1>
          <p>Manage your properties, room types, pricing, and inventory from one place.</p>
        </header>

        <div className={styles.layout}>
          <aside className={styles.partnerCard}>
            <p className={styles.partnerEyebrow}>Partner account</p>
            <div className={styles.approvedMark} aria-hidden="true">✓</div>
            <h2>Access approved</h2>
            <p>Your RoomHop partner account is active. You can now publish and manage hotel properties.</p>
            <div className={styles.accountStatus}><span /> Hotel Partner</div>
          </aside>

          <section className={styles.actionsCard} aria-labelledby="quick-actions-title">
            <div className={styles.cardHeader}>
              <div><p className={styles.cardKicker}>Property management</p><h2 id="quick-actions-title">What would you like to do?</h2></div>
            </div>
            <div className={styles.actionList}>
              {quickActions.map((action) => (
                <article className={styles.actionRow} key={action.title}>
                  <span className={styles.actionNumber}>{action.number}</span>
                  <div className={styles.actionCopy}><h3>{action.title}</h3><p>{action.description}</p></div>
                  <Link className={styles.actionButton} to={action.to}>{action.action}<span aria-hidden="true">→</span></Link>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className={styles.overviewCard}>
          <div><p className={styles.cardKicker}>Portfolio overview</p><h2>Your properties</h2><p>Your newly published properties will appear here once their inventory and pricing data is configured.</p></div>
          <Link className={styles.primaryButton} to="/admin/properties/new">Create your first property <span aria-hidden="true">→</span></Link>
        </section>
      </main>
    </div>
  );
}
