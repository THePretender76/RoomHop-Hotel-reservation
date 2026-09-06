import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api/client';
import styles from './PropertyRegistrationPage.module.css';

const emptyRoomType = () => ({ name: '', maxOccupancy: 2, amenities: '', nightlyRate: '', inventoryCount: '', inventoryRoomNumbers: '' });

function Field({ label, className = '', ...props }) {
  const id = `property-${props.name}`;
  return <div className={`${styles.field} ${className}`}><label htmlFor={id}>{label}</label><input {...props} id={id} className={styles.input} /></div>;
}

export default function PropertyRegistrationPage() {
  const navigate = useNavigate();
  const [hotel, setHotel] = useState({ name: '', stars: '4', address: '', city: '', zipCode: '', description: '' });
  const [roomTypes, setRoomTypes] = useState([emptyRoomType()]);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);

  function handleHotelChange(event) { const { name, value } = event.target; setHotel((current) => ({ ...current, [name]: value })); }
  function handleRoomChange(index, event) { const { name, value } = event.target; setRoomTypes((current) => current.map((room, i) => i === index ? { ...room, [name]: value } : room)); }
  function addRoomType() { setRoomTypes((current) => [...current, emptyRoomType()]); }
  function removeRoomType(index) { setRoomTypes((current) => current.filter((_, i) => i !== index)); }
  function handleImageChange(event) {
    const file = event.target.files?.[0] || null;
    if (file && file.size > 10 * 1024 * 1024) { setError('The hotel image must be smaller than 10 MB.'); return; }
    setError(''); setImageFile(file); setImagePreview(file ? URL.createObjectURL(file) : '');
  }

  async function uploadImage() {
    if (!imageFile) return '';
    const signed = await apiPost('/v1/admin/hotels/image-upload', { contentType: imageFile.type, contentLength: imageFile.size });
    const response = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': imageFile.type }, body: imageFile });
    if (!response.ok) throw new Error('The hotel image could not be uploaded.');
    return signed.imageKey;
  }

  async function handleSubmit(event) {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const imageKey = await uploadImage();
      const payload = {
        hotel: { name: hotel.name, location: `${hotel.address}, ${hotel.city} ${hotel.zipCode}`.trim(), description: hotel.description, stars: Number(hotel.stars), imageKey },
        roomTypes: roomTypes.map((room) => ({ name: room.name, maxOccupancy: Number(room.maxOccupancy), amenities: room.amenities.split(',').map((v) => v.trim()).filter(Boolean), nightlyRate: Number(room.nightlyRate), inventoryCount: Number(room.inventoryCount), inventoryRoomNumbers: room.inventoryRoomNumbers.split(',').map((v) => v.trim()).filter(Boolean) })),
      };
      const response = await apiPost('/v1/admin/hotels/complete', payload);
      navigate('/admin/dashboard', { replace: true, state: { createdHotelId: response?.hotelId } });
    } catch (err) { setError(err.message || 'We could not publish the property.'); }
    finally { setLoading(false); }
  }

  return <div className={styles.page}><main className={styles.container} aria-labelledby="property-title">
    <header className={styles.pageHeader}><p className={styles.eyebrow}>RoomHop partner portal</p><h1 id="property-title">Publish a new property</h1><p>Capture hotel details, room types, pricing, inventory, and a primary image in one submission.</p></header>
    <div className={styles.layout}>
      <aside className={styles.progressCard}><p className={styles.progressEyebrow}>Property setup</p><ol className={styles.steps}>{['Hotel details','Room types','Pricing','Inventory','Publish'].map((label, i) => <li key={label}><span>{String(i + 1).padStart(2, '0')}</span><strong>{label}</strong></li>)}</ol><p className={styles.progressNote}>All information can be updated later from your partner dashboard.</p></aside>
      <form className={styles.formCard} onSubmit={handleSubmit} aria-busy={loading}>
        <div className={styles.formHeader}><div><p className={styles.formKicker}>Property registration</p><h2>Tell us about your hotel</h2></div><p><span>*</span> Required fields</p></div>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <section className={styles.section}><div className={styles.sectionHeading}><span>01</span><div><h3>Hotel data</h3><p>Use the public details guests should see.</p></div></div><div className={styles.grid}>
          <Field label="Hotel name *" name="name" value={hotel.name} onChange={handleHotelChange} placeholder="Grand Hôtel RoomHop" required />
          <Field label="Star rating *" name="stars" type="number" min="1" max="5" value={hotel.stars} onChange={handleHotelChange} required />
          <Field label="Physical address *" name="address" value={hotel.address} onChange={handleHotelChange} placeholder="12 Rue de Rivoli" required className={styles.fullWidth} />
          <Field label="City *" name="city" value={hotel.city} onChange={handleHotelChange} placeholder="Paris" required />
          <Field label="Postal code *" name="zipCode" value={hotel.zipCode} onChange={handleHotelChange} placeholder="75001" required />
          <div className={`${styles.field} ${styles.fullWidth}`}><label htmlFor="property-description">Property description *</label><textarea id="property-description" className={styles.input} name="description" value={hotel.description} onChange={handleHotelChange} rows="4" placeholder="Describe the property, atmosphere, and location." required /></div>
          <div className={`${styles.field} ${styles.fullWidth}`}><label htmlFor="property-image">Primary hotel image</label><div className={styles.imageUpload}>{imagePreview ? <img src={imagePreview} alt="Hotel preview" /> : <div className={styles.imagePlaceholder}>Add a clear landscape photo of the hotel</div>}<div><input id="property-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} disabled={loading} /><small>JPEG, PNG or WebP, maximum 10 MB.</small></div></div></div>
        </div></section>
        <section className={styles.section}><div className={styles.sectionHeading}><span>02</span><div><h3>Room type data</h3><p>Create one entry for each accommodation category.</p></div></div>{roomTypes.map((room, index) => <div className={styles.roomBlock} key={index}><div className={styles.roomTitle}><h4>Room type {index + 1}</h4>{roomTypes.length > 1 && <button type="button" onClick={() => removeRoomType(index)}>Remove</button>}</div><div className={styles.grid}><Field label="Room type name *" name="name" value={room.name} onChange={(e) => handleRoomChange(index, e)} placeholder="Deluxe room" required /><Field label="Maximum guests *" name="maxOccupancy" type="number" min="1" value={room.maxOccupancy} onChange={(e) => handleRoomChange(index, e)} required /><Field label="Amenities *" name="amenities" value={room.amenities} onChange={(e) => handleRoomChange(index, e)} placeholder="WiFi, air conditioning, minibar" required className={styles.fullWidth} /></div></div>)}<button className={styles.secondaryButton} type="button" onClick={addRoomType}>+ Add another room type</button></section>
        <section className={styles.section}><div className={styles.sectionHeading}><span>03</span><div><h3>Pricing data</h3><p>Set the initial base nightly rate for each room type.</p></div></div><div className={styles.grid}>{roomTypes.map((room, index) => <Field key={index} label={`${room.name || `Room type ${index + 1}`} nightly rate *`} name="nightlyRate" type="number" min="0" step="0.01" value={room.nightlyRate} onChange={(e) => handleRoomChange(index, e)} placeholder="180.00" required />)}</div></section>
        <section className={styles.section}><div className={styles.sectionHeading}><span>04</span><div><h3>Inventory data</h3><p>Define capacity and optionally list physical room numbers.</p></div></div>{roomTypes.map((room, index) => <div className={styles.grid} key={index}><Field label={`${room.name || `Room type ${index + 1}`} inventory *`} name="inventoryCount" type="number" min="1" value={room.inventoryCount} onChange={(e) => handleRoomChange(index, e)} placeholder="10" required /><Field label="Room numbers" name="inventoryRoomNumbers" value={room.inventoryRoomNumbers} onChange={(e) => handleRoomChange(index, e)} placeholder="101, 102, 103" /></div>)}</section>
        <div className={styles.actions}><p>Publishing creates 365 days of initial pricing and availability.</p><button className={styles.submitButton} type="submit" disabled={loading}>{loading ? 'Publishing property…' : <>Publish property <span aria-hidden="true">→</span></>}</button></div>
      </form>
    </div>
  </main></div>;
}
