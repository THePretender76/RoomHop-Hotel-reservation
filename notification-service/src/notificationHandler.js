'use strict';

const { sendEmail } = require('./emailSender');
const logger = require('./logger');

async function handleConfirmed(event) {
  logger.info('Processing confirmed event', { reservationId: event.reservationId, guestEmail: event.guestEmail });

  const body = `Dear guest, your booking is confirmed!\nHotel: ${event.hotelName}\nRoom: ${event.roomTypeName}\nCheck-in: ${event.startDate}\nCheck-out: ${event.endDate}\nRooms: ${event.roomCount}\nTotal: $${event.amount}\nReservation ID: ${event.reservationId}`;
  await sendEmail(event.guestEmail, 'Booking Confirmed – RoomHop', body);
}

async function handleCancelled(event) {
  logger.info('Processing cancelled event', { reservationId: event.reservationId, guestEmail: event.guestEmail });

  const body = `Your reservation #${event.reservationId} has been cancelled. We hope to see you again soon.`;
  await sendEmail(event.guestEmail, 'Booking Cancelled – RoomHop', body);
}

module.exports = { handleConfirmed, handleCancelled };
