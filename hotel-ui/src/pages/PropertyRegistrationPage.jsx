import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api/client';

const emptyRoomType = () => ({
  name: '',
  maxOccupancy: 2,
  amenities: '',
  nightlyRate: '',
  inventoryCount: '',
  inventoryRoomNumbers: '',
});

export default function PropertyRegistrationPage() {
  const navigate = useNavigate();
  const [hotel, setHotel] = useState({
    name: '',
    stars: '4',
    address: '',
    city: '',
    zipCode: '',
    description: '',
  });
  const [roomTypes, setRoomTypes] = useState([emptyRoomType()]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleHotelChange(event) {
    const { name, value } = event.target;
    setHotel((current) => ({ ...current, [name]: value }));
  }

  function handleRoomChange(index, event) {
    const { name, value } = event.target;
    setRoomTypes((current) => current.map((room, roomIndex) => roomIndex === index ? { ...room, [name]: value } : room));
  }

  function addRoomType() {
    setRoomTypes((current) => [...current, emptyRoomType()]);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = {
        hotel: {
          name: hotel.name,
          location: `${hotel.address}, ${hotel.city} ${hotel.zipCode}`.trim(),
          description: hotel.description,
          stars: Number(hotel.stars),
        },
        roomTypes: roomTypes.map((room) => ({
          name: room.name,
          maxOccupancy: Number(room.maxOccupancy),
          amenities: room.amenities.split(',').map((entry) => entry.trim()).filter(Boolean),
          nightlyRate: Number(room.nightlyRate),
          inventoryCount: Number(room.inventoryCount),
          inventoryRoomNumbers: room.inventoryRoomNumbers.split(',').map((entry) => entry.trim()).filter(Boolean),
        })),
      };

      const response = await apiPost('/v1/admin/hotels/complete', payload);
      navigate('/admin/dashboard', { replace: true, state: { createdHotelId: response?.hotelId } });
    } catch (err) {
      setError(err.message || 'We could not publish the property.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '3rem auto', padding: '0 1rem 3rem' }}>
      <h1>Publish a New Property</h1>
      <p style={{ color: '#4b5563', marginBottom: '2rem' }}>Capture hotel details, room types, pricing, and inventory in one submission.</p>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.5rem' }}>
        {error && <div style={{ color: '#b91c1c' }}>{error}</div>}

        <section style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: '1rem' }}>
          <h2>Section A: Hotel Data</h2>
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            <input name="name" value={hotel.name} onChange={handleHotelChange} placeholder="Hotel Name" required />
            <input name="stars" type="number" min="1" max="5" value={hotel.stars} onChange={handleHotelChange} placeholder="Star Rating" required />
            <input name="address" value={hotel.address} onChange={handleHotelChange} placeholder="Physical Address" required />
            <input name="city" value={hotel.city} onChange={handleHotelChange} placeholder="City" required />
            <input name="zipCode" value={hotel.zipCode} onChange={handleHotelChange} placeholder="Zip Code" required />
            <textarea name="description" value={hotel.description} onChange={handleHotelChange} placeholder="Property description" rows={4} required />
          </div>
        </section>

        <section style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: '1rem' }}>
          <h2>Section B: Room Type Data</h2>
          {roomTypes.map((room, index) => (
            <div key={index} style={{ borderTop: index > 0 ? '1px solid #e5e7eb' : 'none', paddingTop: index > 0 ? '1rem' : 0, marginTop: index > 0 ? '1rem' : 0 }}>
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                <input name="name" value={room.name} onChange={(event) => handleRoomChange(index, event)} placeholder="Room Type Name" required />
                <input name="maxOccupancy" type="number" min="1" value={room.maxOccupancy} onChange={(event) => handleRoomChange(index, event)} placeholder="Maximum Guest Capacity" required />
                <input name="amenities" value={room.amenities} onChange={(event) => handleRoomChange(index, event)} placeholder="Amenities (comma separated)" required />
              </div>
            </div>
          ))}
          <button type="button" onClick={addRoomType} style={{ marginTop: '1rem' }}>Add Another Room Type</button>
        </section>

        <section style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: '1rem' }}>
          <h2>Section C: Pricing Data</h2>
          {roomTypes.map((room, index) => (
            <div key={index} style={{ marginBottom: '0.8rem' }}>
              <label>{room.name || `Room Type ${index + 1}`} nightly rate</label>
              <input name="nightlyRate" type="number" min="0" step="0.01" value={room.nightlyRate} onChange={(event) => handleRoomChange(index, event)} placeholder="Base nightly rate" required />
            </div>
          ))}
        </section>

        <section style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: '1rem' }}>
          <h2>Section D: Inventory Data</h2>
          {roomTypes.map((room, index) => (
            <div key={index} style={{ marginBottom: '0.8rem' }}>
              <label>{room.name || `Room Type ${index + 1}`} inventory</label>
              <input name="inventoryCount" type="number" min="0" value={room.inventoryCount} onChange={(event) => handleRoomChange(index, event)} placeholder="Total physical rooms" required />
              <input name="inventoryRoomNumbers" value={room.inventoryRoomNumbers} onChange={(event) => handleRoomChange(index, event)} placeholder="Optional specific room IDs (comma separated)" />
            </div>
          ))}
        </section>

        <button type="submit" disabled={loading} style={{ padding: '0.8rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8 }}>
          {loading ? 'Publishing...' : 'Publish Property'}
        </button>
      </form>
    </div>
  );
}
