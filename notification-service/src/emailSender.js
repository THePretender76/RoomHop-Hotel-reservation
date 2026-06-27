'use strict';

async function sendEmail(to, subject, body) {
  console.log(`[EmailSender] Sending email to: ${to}`);
  console.log(`[EmailSender] Subject: ${subject}`);
  console.log(`[EmailSender] Body: ${body}`);
}

module.exports = { sendEmail };
