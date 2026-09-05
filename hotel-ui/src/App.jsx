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
import PartnerOnboardingPage from './pages/PartnerOnboardingPage'
import OnboardingPendingPage from './pages/OnboardingPendingPage'
import AdminDashboardPage from './pages/AdminDashboardPage'
import PropertyRegistrationPage from './pages/PropertyRegistrationPage'
import SuperAdminReviewPage from './pages/SuperAdminReviewPage'
import PrivateRoute from './auth/PrivateRoute'
import { useAuth } from './auth/useAuth'
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
          <Route path="/auth/portal" element={<SignInPage />} />
          <Route path="/onboarding/professional" element={
            <PrivateRoute>
              <PartnerOnboardingPage />
            </PrivateRoute>
          } />
          <Route path="/onboarding/pending-review" element={
            <PrivateRoute>
              <OnboardingPendingPage />
            </PrivateRoute>
          } />
          <Route path="/admin/dashboard" element={
            <PrivateRoute requiredGroup="HotelPartner">
              <AdminDashboardPage />
            </PrivateRoute>
          } />
          <Route path="/admin/properties/new" element={
            <PrivateRoute requiredGroup="HotelPartner">
              <PropertyRegistrationPage />
            </PrivateRoute>
          } />
          <Route path="/admin/super/reviews/:applicantId" element={
            <PrivateRoute requiredGroup="SuperAdmin">
              <SuperAdminReviewPage />
            </PrivateRoute>
          } />
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
      <Footer />
      <BackToTop />
    </>
  )
}

export default App
