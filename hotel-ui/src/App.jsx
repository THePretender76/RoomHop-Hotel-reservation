import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import BackToTop from './components/BackToTop'
import HomePage from './pages/HomePage'
import SearchResultsPage from './pages/SearchResultsPage'
import BookingPage from './pages/BookingPage'
import ReservationsPage from './pages/ReservationsPage'
import SignInPage from './pages/SignInPage'
import PrivateRoute from './auth/PrivateRoute'
import { useAuth } from './auth/AuthContext'
import { setAuthTokenGetter } from './api/client'

function App() {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(getToken);
  }, [getToken]);

  return (
    <>
      <Navbar />
      <main style={{ flex: '1 1 auto' }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchResultsPage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/booking" element={
            <PrivateRoute>
              <BookingPage />
            </PrivateRoute>
          } />
          <Route path="/reservations" element={
            <PrivateRoute>
              <ReservationsPage />
            </PrivateRoute>
          } />
        </Routes>
      </main>
      <BackToTop />
    </>
  )
}

export default App
