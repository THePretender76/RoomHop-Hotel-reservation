const db = require('../src/db');
const adminService = require('../src/services/adminService');

jest.mock('../src/db', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

describe('adminService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a pending partner application with a generated applicant id', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 77 }]);

    const result = await adminService.createPartnerApplication({
      fullName: 'Ada Lovelace',
      corporateEmail: 'ada@roomhop.com',
      phoneNumber: '+33123456789',
      companyName: 'RoomHop Labs',
      taxId: 'VAT-001',
      headOfficeAddress: '12 Rue de la Paix',
      primaryCity: 'Paris',
      websiteUrl: 'https://roomhop.example',
      cognitoSub: 'cognito-user-1',
    });

    expect(result.applicantId).toBe(77);
    expect(result.status).toBe('PENDING');
    expect(db.query).toHaveBeenCalled();
  });

  it('creates a complete property payload and returns a hotel id', async () => {
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query: jest.fn().mockResolvedValue([{ insertId: 12 }]),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(connection);

    const result = await adminService.createCompleteProperty({
      hotel: {
        name: 'Harbor Suites',
        location: 'Lisbon',
        description: 'A modern hotel',
        stars: 4,
      },
      roomTypes: [],
    });

    expect(result.hotelId).toBe(12);
    expect(result.roomTypes).toEqual([]);
  });

  it('rolls back the transaction when room type insertion fails', async () => {
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query: jest.fn()
        .mockResolvedValueOnce([{ insertId: 15 }])
        .mockRejectedValueOnce(new Error('room insert failed')),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(connection);

    await expect(adminService.createCompleteProperty({
      hotel: { name: 'Harbor Suites', location: 'Lisbon', description: 'A modern hotel', stars: 4 },
      roomTypes: [{ name: 'Deluxe', maxOccupancy: 2, amenities: ['WiFi'], nightlyRate: 120, inventoryCount: 5 }],
    })).rejects.toThrow('room insert failed');

    expect(connection.rollback).toHaveBeenCalled();
  });

  it('rejects incomplete property payloads before writing to the database', async () => {
    await expect(adminService.createCompleteProperty({ hotel: {}, roomTypes: [] })).rejects.toThrow('Hotel name is required');
  });

  it('rejects incomplete partner applications before writing to the database', async () => {
    await expect(adminService.createPartnerApplication({
      companyName: 'RoomHop Labs',
      taxId: 'VAT-001',
      cognitoSub: 'cognito-user-1',
    })).rejects.toThrow('Full name is required');
  });

  it('uses bulk inserts for 365-day room rate and inventory seeding', async () => {
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query: jest.fn().mockResolvedValue([{ insertId: 1 }]),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(connection);

    await adminService.createCompleteProperty({
      hotel: { name: 'Harbor Suites', location: 'Lisbon', description: 'A modern hotel', stars: 4 },
      roomTypes: [{ name: 'Deluxe', maxOccupancy: 2, amenities: ['WiFi'], nightlyRate: 120, inventoryCount: 5 }],
    });

    const rateQueries = connection.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO room_type_rate'));
    const inventoryQueries = connection.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO room_type_inventory'));

    expect(rateQueries).toHaveLength(1);
    expect(inventoryQueries).toHaveLength(1);
  });
});
