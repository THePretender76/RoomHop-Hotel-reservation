'use strict';

const { sendEmail } = require('./emailSender');
const logger = require('./logger');

async function handleConfirmed(event) {
  logger.info('Processing confirmed event', {
    reservationId: event.reservationId,
    guestEmail: event.guestEmail,
  });
  const body = `Dear guest, your booking is confirmed!\nHotel: ${event.hotelName}\nRoom: ${event.roomTypeName}\nCheck-in: ${event.startDate}\nCheck-out: ${event.endDate}\nRooms: ${event.roomCount}\nTotal: EUR ${event.amount}\nReservation ID: ${event.reservationId}`;
  await sendEmail(event.guestEmail, 'Booking Confirmed - RoomHop', body);
}

async function handleCancelled(event) {
  logger.info('Processing cancelled event', {
    reservationId: event.reservationId,
    guestEmail: event.guestEmail,
  });
  const body = `Your reservation #${event.reservationId} has been cancelled. We hope to see you again soon.`;
  await sendEmail(event.guestEmail, 'Booking Cancelled - RoomHop', body);
}

async function handlePartnerSubmitted(event) {
  const body = [
    `Hello ${event.applicantName || 'there'},`,
    '',
    `We received the partner application for ${event.companyName || 'your company'}.`,
    `Application ID: ${event.applicantId}`,
    '',
    'Our team will contact you when a decision is available.',
  ].join('\n');
  await sendEmail(
    event.corporateEmail,
    'We received your RoomHop partner application',
    body
  );
}

async function handlePartnerReviewed(event) {
  const approved = event.status === 'APPROVED';
  const body = approved
    ? `Hello ${event.applicantName || 'there'},\n\nYour RoomHop partner application has been approved.`
    : `Hello ${event.applicantName || 'there'},\n\nYour RoomHop partner application was not approved.`;
  await sendEmail(
    event.corporateEmail,
    approved
      ? 'Your RoomHop partner application is approved'
      : 'Update on your RoomHop partner application',
    body
  );
}

module.exports = {
  handleConfirmed,
  handleCancelled,
  handlePartnerSubmitted,
  handlePartnerReviewed,
};
