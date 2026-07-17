import { Link } from 'react-router-dom';

const quickActions = [
  { label: 'Create a new property', to: '/admin/properties/new' },
  { label: 'Review room inventory', to: '/admin/dashboard' },
  { label: 'Adjust pricing', to: '/admin/dashboard' },
];

export default function AdminDashboardPage() {
  return (
    <div style={{ maxWidth: 960, margin: '3rem auto', padding: '0 1rem 3rem' }}>
      <h1>Hotel Admin Dashboard</h1>
      <p style={{ color: '#4b5563', marginBottom: '1.5rem' }}>
        Manage your properties, room types, pricing, and inventory from one place.
      </p>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {quickActions.map((action) => (
          <Link key={action.label} to={action.to} style={{ display: 'block', padding: '1rem', border: '1px solid #d1d5db', borderRadius: 10, textDecoration: 'none', color: '#111827', background: '#fff' }}>
            {action.label}
          </Link>
        ))}
      </div>

      <section style={{ marginTop: '2rem', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Property overview</h2>
        <p style={{ color: '#4b5563' }}>Your newly published properties will appear here once the inventory and pricing data is synced.</p>
      </section>
    </div>
  );
}
