'use strict';

const { sendEmail } = require('./emailSender');

async function handleConfirmed(event) {
  const body = `Dear guest, your booking is confirmed!\nHotel: ${event.hotelName}\nRoom: ${event.roomTypeName}\nCheck-in: ${event.startDate}\nCheck-out: ${event.endDate}\nRooms: ${event.roomCount}\nTotal: $${event.amount}\nReservation ID: ${event.reservationId}`;
  await sendEmail(event.guestEmail, 'Booking Confirmed – RoomHop', body);
}

async function handleCancelled(event) {
  const body = `Your reservation #${event.reservationId} has been cancelled. We hope to see you again soon.`;
  await sendEmail(event.guestEmail, 'Booking Cancelled – RoomHop', body);
}

module.exports = { handleConfirmed, handleCancelled };
