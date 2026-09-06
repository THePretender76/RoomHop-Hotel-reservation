'use strict';

const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const sesClient = new SESv2Client({
  region: process.env.AWS_REGION_OVERRIDE || process.env.AWS_REGION || 'us-east-1',
});

function requiredRecipient(value, detailType) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${detailType} is missing a valid recipient email`);
  }
  return email;
}

function buildEmail(detailType, detail) {
  if (detailType === 'BookingConfirmed') {
    return {
      to: requiredRecipient(detail.guestEmail, detailType),
      subject: 'Booking confirmation - RoomHop',
      text: [
        `Dear ${detail.guestName || 'Guest'},`,
        '',
        `Your booking (ID: ${detail.reservationId}) is confirmed.`,
        `Hotel: ${detail.hotelName || 'RoomHop property'}`,
        `Room: ${detail.roomType || ''}`,
        `Check-in: ${detail.checkIn || ''}`,
        `Check-out: ${detail.checkOut || ''}`,
        `Amount: EUR ${detail.totalAmount ?? ''}`,
        '',
        'Thank you for choosing RoomHop.',
      ].join('\n'),
    };
  }

  if (detailType === 'BookingCancelled') {
    return {
      to: requiredRecipient(detail.guestEmail, detailType),
      subject: 'Booking cancellation - RoomHop',
      text: [
        `Dear ${detail.guestName || 'Guest'},`,
        '',
        `Your booking (ID: ${detail.reservationId}) has been cancelled.`,
        '',
        'We hope to see you again soon.',
      ].join('\n'),
    };
  }

  if (detailType === 'PartnerApplicationSubmitted') {
    return {
      to: requiredRecipient(detail.corporateEmail, detailType),
      subject: 'We received your RoomHop partner application',
      text: [
        `Hello ${detail.applicantName || 'there'},`,
        '',
        `We received the partner application for ${detail.companyName || 'your company'}.`,
        `Application ID: ${detail.applicantId}`,
        '',
        'Our team will review it. You will receive another email when a decision is available.',
      ].join('\n'),
    };
  }

  if (detailType === 'PartnerApplicationReviewed') {
    const approved = detail.status === 'APPROVED';
    return {
      to: requiredRecipient(detail.corporateEmail, detailType),
      subject: approved
        ? 'Your RoomHop partner application is approved'
        : 'Update on your RoomHop partner application',
      text: approved
        ? [
            `Hello ${detail.applicantName || 'there'},`,
            '',
            `Your partner application for ${detail.companyName || 'your company'} has been approved.`,
            'Sign in again to refresh your permissions and access the hotel dashboard.',
          ].join('\n')
        : [
            `Hello ${detail.applicantName || 'there'},`,
            '',
            `Your partner application for ${detail.companyName || 'your company'} was not approved.`,
            'Please contact the RoomHop team if you need more information.',
          ].join('\n'),
    };
  }

  throw new Error(`Unsupported notification event type: ${detailType}`);
}

function buildOperationsEmail(detailType, detail, operationsEmail) {
  if (detailType !== 'PartnerApplicationSubmitted') return null;
  return {
    to: requiredRecipient(operationsEmail, detailType),
    subject: `Partner application #${detail.applicantId} requires review - RoomHop`,
    text: [
      'A new hotel partner application is ready for review.',
      '',
      `Application ID: ${detail.applicantId}`,
      `Company: ${detail.companyName || ''}`,
      `Applicant: ${detail.applicantName || ''}`,
      `Corporate email: ${detail.corporateEmail || ''}`,
      '',
      'Sign in as a SuperAdmin to approve or reject the application.',
    ].join('\n'),
  };
}

function parseSqsRecord(record) {
  const envelope = JSON.parse(record.body);
  return {
    detailType: envelope['detail-type'] || envelope.detailType,
    detail: envelope.detail || envelope,
  };
}

async function processRecord(record, client = sesClient) {
  const { detailType, detail } = parseSqsRecord(record);
  const sender = process.env.SENDER_EMAIL;
  if (!sender) throw new Error('SENDER_EMAIL is not configured');

  const recipientEmail = buildEmail(detailType, detail);
  const operationsEmail = process.env.OPERATIONS_EMAIL
    ? buildOperationsEmail(detailType, detail, process.env.OPERATIONS_EMAIL)
    : null;
  const emails = operationsEmail
    ? [{ ...operationsEmail, required: true }, { ...recipientEmail, required: false }]
    : [{ ...recipientEmail, required: true }];

  for (const email of emails) {
    try {
      await client.send(new SendEmailCommand({
        FromEmailAddress: sender,
        Destination: { ToAddresses: [email.to] },
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: email.text, Charset: 'UTF-8' } },
          },
        },
      }));
    } catch (error) {
      if (email.required) throw error;
      // In the SES sandbox, unverified applicant addresses cannot receive
      // transactional mail. The verified operations alert remains mandatory.
      console.warn(JSON.stringify({
        message: 'Optional recipient notification failed',
        detailType,
        recipient: email.to,
        error: error.message,
      }));
    }
  }

  console.log(JSON.stringify({
    message: 'Notification sent',
    detailType,
    messageId: record.messageId,
  }));
}

exports.handler = async (event) => {
  const failures = [];
  for (const record of event.Records || []) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'Notification failed',
        messageId: record.messageId,
        error: error.message,
      }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};

exports.buildEmail = buildEmail;
exports.buildOperationsEmail = buildOperationsEmail;
exports.parseSqsRecord = parseSqsRecord;
exports.processRecord = processRecord;
