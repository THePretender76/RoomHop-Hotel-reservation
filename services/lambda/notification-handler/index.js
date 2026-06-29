'use strict';

const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const sesClient = new SESv2Client({ region: process.env.AWS_REGION || 'eu-west-1' });

exports.handler = async (event) => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    const detail = body.detail || body;
    const detailType = body['detail-type'] || 'BookingConfirmed';

    const subject = detailType === 'BookingConfirmed'
      ? 'Booking Confirmation - RoomHop'
      : 'Booking Cancellation - RoomHop';

    const emailBody = detailType === 'BookingConfirmed'
      ? `Dear ${detail.guestName || 'Guest'},\n\nYour booking (ID: ${detail.reservationId}) is confirmed.\nHotel: ${detail.hotelName || ''}\nCheck-in: ${detail.checkIn}\nCheck-out: ${detail.checkOut}\nAmount: €${detail.totalAmount}\n\nThank you for choosing RoomHop!`
      : `Dear ${detail.guestName || 'Guest'},\n\nYour booking (ID: ${detail.reservationId}) has been cancelled.\n\nWe hope to see you again soon.`;

    await sesClient.send(new SendEmailCommand({
      FromEmailAddress: process.env.SENDER_EMAIL || 'noreply@roomhop.com',
      Destination: { ToAddresses: [detail.guestEmail] },
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: emailBody } } } },
    }));

    console.log(`Email sent to ${detail.guestEmail} for ${detailType}`);
  }
};
