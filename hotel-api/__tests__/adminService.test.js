const db = require('../src/db');
const { publishOrThrow } = require('../src/services/kafkaProducer');
const adminService = require('../src/services/adminService');

jest.mock('../src/db', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));
jest.mock('../src/services/kafkaProducer', () => ({
  publishOrThrow: jest.fn().mockResolvedValue(undefined),
}));

const partnerForm = {
  fullName: 'Ada Lovelace',
  corporateEmail: 'ada@roomhop.com',
  phoneNumber: '+33123456789',
  companyName: 'RoomHop Labs',
  taxId: 'VAT-001',
  headOfficeAddress: '12 Rue de la Paix',
  estimatedProperties: 2,
  primaryCity: 'Paris',
  websiteUrl: 'https://roomhop.example',
};
const identity = {
  sub: 'trusted-cognito-sub',
  username: 'trusted-cognito-username',
  email: 'ada@roomhop.com',
};
const propertyPayload = {
  hotel: {
    name: 'Harbor Suites',
    location: 'Lisbon',
    description: 'A modern hotel',
    stars: 4,
  },
  roomTypes: [{
    name: 'Deluxe',
    maxOccupancy: 2,
    amenities: ['WiFi'],
    nightlyRate: 120,
    inventoryCount: 5,
    inventoryRoomNumbers: ['101'],
  }],
};

describe('adminService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COGNITO_USER_POOL_ID;
  });

  it('creates a pending application from the trusted identity and queues its notification', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 77 }]);

    const result = await adminService.createPartnerApplication(
      { ...partnerForm, cognitoSub: 'attacker-controlled' },
      identity
    );

    expect(result).toEqual({ applicantId: 77, status: 'PENDING', notificationQueued: true });
    expect(db.query.mock.calls[0][1][0]).toBe(identity.sub);
    expect(db.query.mock.calls[0][1][1]).toBe(identity.username);
    expect(publishOrThrow).toHaveBeenCalledWith(
      'hotel.events.reservations',
      expect.objectContaining({
        eventType: 'partner.application.submitted',
        corporateEmail: partnerForm.corporateEmail,
      })
    );
  });

  it('rejects malformed partner data before writing', async () => {
    await expect(adminService.createPartnerApplication(
      { ...partnerForm, corporateEmail: 'not-an-email' },
      identity
    )).rejects.toThrow('Corporate email is invalid');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('creates a complete property and links it to the approved partner', async () => {
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query: jest.fn().mockImplementation(async (sql) => {
        if (String(sql).includes('SELECT admin_id')) return [[{ admin_id: 9 }]];
        if (String(sql).includes('INSERT INTO hotel (')) return [{ insertId: 12 }];
        if (String(sql).includes('INSERT INTO room_type (')) return [{ insertId: 31 }];
        return [{ affectedRows: 1, insertId: 41 }];
      }),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(connection);

    const result = await adminService.createCompleteProperty(propertyPayload, identity.sub);

    expect(result).toEqual({
      hotelId: 12,
      roomTypes: [{ roomTypeId: 31, name: 'Deluxe' }],
    });
    expect(connection.query).toHaveBeenCalledWith(
      'INSERT INTO hotel_admin_properties (admin_id, hotel_id) VALUES (?, ?)',
      [9, 12]
    );
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it('rolls back property creation when a write fails', async () => {
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query: jest.fn()
        .mockResolvedValueOnce([[{ admin_id: 9 }]])
        .mockRejectedValueOnce(new Error('hotel insert failed')),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(connection);

    await expect(
      adminService.createCompleteProperty(propertyPayload, identity.sub)
    ).rejects.toThrow('hotel insert failed');
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it('rejects incomplete property payloads before opening a transaction', async () => {
    await expect(
      adminService.createCompleteProperty({ hotel: {}, roomTypes: [] }, identity.sub)
    ).rejects.toThrow('Hotel and at least one room type are required');
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  it('blocks hotel changes when the authenticated partner does not own the property', async () => {
    db.query.mockResolvedValueOnce([[]]);

    await expect(adminService.updateHotelMetadata(12, propertyPayload.hotel, identity.sub))
      .rejects.toMatchObject({ status: 403 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
