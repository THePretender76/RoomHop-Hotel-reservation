'use strict';

jest.mock('../src/emailSender', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));

const { sendEmail } = require('../src/emailSender');
const {
  handlePartnerSubmitted,
  handlePartnerReviewed,
} = require('../src/notificationHandler');

describe('partner notifications', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the submission receipt to the corporate address', async () => {
    await handlePartnerSubmitted({
      applicantId: 42,
      applicantName: 'Ada Lovelace',
      companyName: 'RoomHop Labs',
      corporateEmail: 'ada@roomhop.example',
    });

    expect(sendEmail).toHaveBeenCalledWith(
      'ada@roomhop.example',
      'We received your RoomHop partner application',
      expect.stringContaining('Application ID: 42')
    );
  });

  it('sends the approval decision to the corporate address', async () => {
    await handlePartnerReviewed({
      applicantName: 'Ada Lovelace',
      corporateEmail: 'ada@roomhop.example',
      status: 'APPROVED',
    });

    expect(sendEmail).toHaveBeenCalledWith(
      'ada@roomhop.example',
      'Your RoomHop partner application is approved',
      expect.stringContaining('approved')
    );
  });
});
