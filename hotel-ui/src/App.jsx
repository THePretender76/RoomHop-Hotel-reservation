import { Routes, Route } from 'react-router-dom'
import './App.css'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import BackToTop from './components/BackToTop'
import HomePage from './pages/HomePage'
import SearchResultsPage from './pages/SearchResultsPage'
import BookingPage from './pages/BookingPage'
import ReservationsPage from './pages/ReservationsPage'

function App() {
  return (
    <>
      <Navbar />
      <main style={{ flex: '1 1 auto' }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchResultsPage />} />
          <Route path="/booking" element={<BookingPage />} />
          <Route path="/reservations" element={<ReservationsPage />} />
        </Routes>
      </main>
      <BackToTop />
    </>
  )
}

export default App
