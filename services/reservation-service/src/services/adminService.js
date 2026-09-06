'use strict';

const db = require('../db');
const { publishEvent } = require('../eventPublisher');
const { setPartnerAccess } = require('../cognito');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requiredString(value, label, maxLength = 500) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new HttpError(422, `${label} is required`);
  if (normalized.length > maxLength) {
    throw new HttpError(422, `${label} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function normalizePartnerApplication(data, identity) {
  if (!data || typeof data !== 'object') {
    throw new HttpError(422, 'Application payload is required');
  }
  if (!identity?.sub || !identity?.username) {
    throw new HttpError(401, 'Authenticated Cognito identity is required');
  }

  const corporateEmail = requiredString(data.corporateEmail, 'Corporate email', 255).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corporateEmail)) {
    throw new HttpError(422, 'Corporate email is invalid');
  }

  const websiteUrl = requiredString(data.websiteUrl, 'Website URL', 500);
  let parsedWebsite;
  try {
    parsedWebsite = new URL(websiteUrl);
  } catch {
    throw new HttpError(422, 'Website URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsedWebsite.protocol)) {
    throw new HttpError(422, 'Website URL must use http or https');
  }

  const estimatedProperties = Number(data.estimatedProperties);
  if (!Number.isInteger(estimatedProperties) || estimatedProperties < 1 || estimatedProperties > 10000) {
    throw new HttpError(422, 'Estimated properties must be an integer between 1 and 10000');
  }

  return {
    cognitoSub: identity.sub,
    cognitoUsername: identity.username,
    companyName: requiredString(data.companyName, 'Company name', 255),
    taxId: requiredString(data.taxId, 'Tax ID', 100),
    fullName: requiredString(data.fullName, 'Full name', 200),
    corporateEmail,
    phoneNumber: requiredString(data.phoneNumber, 'Phone number', 50),
    headOfficeAddress: requiredString(data.headOfficeAddress, 'Head office address', 1000),
    estimatedProperties,
    primaryCity: requiredString(data.primaryCity, 'Primary city', 150),
    websiteUrl: parsedWebsite.toString(),
  };
}

async function createPartnerApplication(data, identity) {
  const application = normalizePartnerApplication(data, identity);
  const [result] = await db.query(
    `INSERT INTO hotel_administrators (
       cognito_sub, cognito_username, company_name, tax_id, full_name,
       corporate_email, phone_number, head_office_address,
       estimated_properties, primary_city, website_url, status,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       admin_id = LAST_INSERT_ID(admin_id),
       cognito_username = VALUES(cognito_username),
       company_name = VALUES(company_name),
       tax_id = VALUES(tax_id),
       full_name = VALUES(full_name),
       corporate_email = VALUES(corporate_email),
       phone_number = VALUES(phone_number),
       head_office_address = VALUES(head_office_address),
       estimated_properties = VALUES(estimated_properties),
       primary_city = VALUES(primary_city),
       website_url = VALUES(website_url),
       status = 'PENDING',
       updated_at = NOW()`,
    [
      application.cognitoSub,
      application.cognitoUsername,
      application.companyName,
      application.taxId,
      application.fullName,
      application.corporateEmail,
      application.phoneNumber,
      application.headOfficeAddress,
      application.estimatedProperties,
      application.primaryCity,
      application.websiteUrl,
    ]
  );

  const applicantId = result.insertId;
  await setPartnerAccess(application.cognitoUsername, 'PENDING');
  await publishEvent('PartnerApplicationSubmitted', {
    applicantId,
    applicantName: application.fullName,
    companyName: application.companyName,
    corporateEmail: application.corporateEmail,
    status: 'PENDING',
  }, 'roomhop.partner');

  return { applicantId, status: 'PENDING', notificationQueued: true };
}

async function getPartnerApplications() {
  const [rows] = await db.query(
    `SELECT admin_id, company_name, tax_id, full_name, corporate_email,
            phone_number, head_office_address, estimated_properties,
            primary_city, website_url, status, created_at, updated_at
       FROM hotel_administrators
      ORDER BY created_at DESC`
  );
  return rows;
}

async function getOwnPartnerApplication(cognitoSub) {
  const [rows] = await db.query(
    `SELECT admin_id, company_name, full_name, corporate_email, status,
            estimated_properties, primary_city, created_at, updated_at
       FROM hotel_administrators
      WHERE cognito_sub = ?
      LIMIT 1`,
    [cognitoSub]
  );
  if (!rows.length) throw new HttpError(404, 'Partner application not found');
  return rows[0];
}

async function reviewPartnerApplication(applicantIdValue, requestedStatus) {
  const applicantId = Number(applicantIdValue);
  const status = String(requestedStatus || '').toUpperCase();
  if (!Number.isInteger(applicantId) || applicantId < 1) {
    throw new HttpError(422, 'Applicant ID is invalid');
  }
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new HttpError(422, 'Status must be APPROVED or REJECTED');
  }

  const [rows] = await db.query(
    `SELECT admin_id, cognito_username, cognito_sub, company_name,
            full_name, corporate_email, status
       FROM hotel_administrators
      WHERE admin_id = ?
      LIMIT 1`,
    [applicantId]
  );
  if (!rows.length) throw new HttpError(404, 'Partner application not found');

  const application = rows[0];
  await db.query(
    'UPDATE hotel_administrators SET status = ?, updated_at = NOW() WHERE admin_id = ?',
    [status, applicantId]
  );

  await setPartnerAccess(application.cognito_username || application.cognito_sub, status);
  await publishEvent('PartnerApplicationReviewed', {
    applicantId,
    applicantName: application.full_name,
    companyName: application.company_name,
    corporateEmail: application.corporate_email,
    status,
  }, 'roomhop.partner');

  return { applicantId, status, notificationQueued: true };
}

function normalizeHotel(hotel) {
  const stars = Number(hotel?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new HttpError(422, 'Hotel stars must be between 1 and 5');
  }

  const imageKey = typeof hotel?.imageKey === 'string' ? hotel.imageKey.trim() : '';
  if (imageKey && !/^properties\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.(jpg|png|webp)$/.test(imageKey)) {
    throw new HttpError(422, 'Hotel image key is invalid');
  }

  return {
    name: requiredString(hotel?.name, 'Hotel name', 150),
    location: requiredString(hotel?.location, 'Hotel location', 255),
    description: requiredString(hotel?.description, 'Hotel description', 5000),
    stars,
    imageKey,
  };
}

function normalizeCompleteProperty(payload) {
  if (!payload?.hotel || !Array.isArray(payload.roomTypes) || payload.roomTypes.length === 0) {
    throw new HttpError(422, 'Hotel and at least one room type are required');
  }

  const roomTypes = payload.roomTypes.map((roomType, index) => {
    const maxOccupancy = Number(roomType.maxOccupancy);
    const nightlyRate = Number(roomType.nightlyRate);
    const inventoryCount = Number(roomType.inventoryCount);
    if (!Number.isInteger(maxOccupancy) || maxOccupancy < 1 || maxOccupancy > 50) {
      throw new HttpError(422, `Room type ${index + 1} occupancy is invalid`);
    }
    if (!Number.isFinite(nightlyRate) || nightlyRate < 0) {
      throw new HttpError(422, `Room type ${index + 1} nightly rate is invalid`);
    }
    if (!Number.isInteger(inventoryCount) || inventoryCount < 1 || inventoryCount > 10000) {
      throw new HttpError(422, `Room type ${index + 1} inventory is invalid`);
    }

    const amenities = Array.isArray(roomType.amenities)
      ? roomType.amenities.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const roomNumbers = Array.isArray(roomType.inventoryRoomNumbers)
      ? [...new Set(roomType.inventoryRoomNumbers.map((item) => String(item).trim()).filter(Boolean))]
      : [];

    return {
      name: requiredString(roomType.name, `Room type ${index + 1} name`, 100),
      maxOccupancy,
      amenities,
      nightlyRate,
      inventoryCount,
      roomNumbers,
    };
  });

  return {
    hotel: normalizeHotel(payload.hotel),
    roomTypes,
  };
}

async function assertApprovedPartner(cognitoSub, connection = db) {
  const [rows] = await connection.query(
    `SELECT admin_id FROM hotel_administrators
      WHERE cognito_sub = ? AND status = 'APPROVED'
      LIMIT 1`,
    [cognitoSub]
  );
  if (!rows.length) throw new HttpError(403, 'Approved partner application required');
  return rows[0].admin_id;
}

async function assertOwnsHotel(cognitoSub, hotelId, connection = db) {
  const [rows] = await connection.query(
    `SELECT 1
       FROM hotel_admin_properties hap
       JOIN hotel_administrators ha ON ha.admin_id = hap.admin_id
      WHERE ha.cognito_sub = ? AND ha.status = 'APPROVED' AND hap.hotel_id = ?
      LIMIT 1`,
    [cognitoSub, hotelId]
  );
  if (!rows.length) throw new HttpError(403, 'You do not manage this property');
}

async function createCompleteProperty(payload, cognitoSub) {
  const normalized = normalizeCompleteProperty(payload);
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const adminId = await assertApprovedPartner(cognitoSub, connection);
    const [hotelResult] = await connection.query(
      `INSERT INTO hotel (name, location, description, stars, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [normalized.hotel.name, normalized.hotel.location, normalized.hotel.description, normalized.hotel.stars]
    );
    const hotelId = hotelResult.insertId;

    if (normalized.hotel.imageKey) {
      await connection.query(
        'INSERT INTO hotel_images (hotel_id, image_url, is_primary) VALUES (?, ?, TRUE)',
        [hotelId, normalized.hotel.imageKey]
      );
    }

    await connection.query(
      'INSERT INTO hotel_admin_properties (admin_id, hotel_id) VALUES (?, ?)',
      [adminId, hotelId]
    );

    const createdRoomTypes = [];
    for (const roomType of normalized.roomTypes) {
      const [roomTypeResult] = await connection.query(
        `INSERT INTO room_type (hotel_id, name, max_occupancy, amenities)
         VALUES (?, ?, ?, ?)`,
        [hotelId, roomType.name, roomType.maxOccupancy, JSON.stringify(roomType.amenities)]
      );
      const roomTypeId = roomTypeResult.insertId;
      createdRoomTypes.push({ roomTypeId, name: roomType.name });

      const rateRows = [];
      const inventoryRows = [];
      for (let day = 0; day < 365; day += 1) {
        rateRows.push([hotelId, roomTypeId, day, roomType.nightlyRate]);
        inventoryRows.push([hotelId, roomTypeId, day, roomType.inventoryCount]);
      }
      await connection.query(
        `INSERT INTO room_type_rate (hotel_id, room_type_id, date, nightly_rate)
         VALUES ${rateRows.map(() => '(?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?)').join(', ')}`,
        rateRows.flat()
      );
      await connection.query(
        `INSERT INTO room_type_inventory
           (hotel_id, room_type_id, date, total_inventory, total_reserved)
         VALUES ${inventoryRows.map(() => '(?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, 0)').join(', ')}`,
        inventoryRows.flat()
      );

      for (const roomNumber of roomType.roomNumbers) {
        await connection.query(
          'INSERT INTO room (hotel_id, room_type_id, room_number) VALUES (?, ?, ?)',
          [hotelId, roomTypeId, roomNumber]
        );
      }
    }

    await connection.commit();
    return { hotelId, roomTypes: createdRoomTypes };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateHotelMetadata(hotelIdValue, data, cognitoSub) {
  const hotelId = Number(hotelIdValue);
  if (!Number.isInteger(hotelId) || hotelId < 1) throw new HttpError(422, 'Hotel ID is invalid');
  await assertOwnsHotel(cognitoSub, hotelId);
  const normalized = normalizeHotel(data);
  const [result] = await db.query(
    'UPDATE hotel SET name = ?, location = ?, description = ?, stars = ? WHERE hotel_id = ? AND deleted_at IS NULL',
    [normalized.name, normalized.location, normalized.description, normalized.stars, hotelId]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Hotel not found');
  return { hotelId };
}

async function updateRoomType(roomTypeIdValue, data, cognitoSub) {
  const roomTypeId = Number(roomTypeIdValue);
  if (!Number.isInteger(roomTypeId) || roomTypeId < 1) throw new HttpError(422, 'Room type ID is invalid');
  const [rows] = await db.query('SELECT hotel_id FROM room_type WHERE room_type_id = ? LIMIT 1', [roomTypeId]);
  if (!rows.length) throw new HttpError(404, 'Room type not found');
  await assertOwnsHotel(cognitoSub, rows[0].hotel_id);

  const name = requiredString(data?.name, 'Room type name', 100);
  const maxOccupancy = Number(data?.maxOccupancy);
  if (!Number.isInteger(maxOccupancy) || maxOccupancy < 1 || maxOccupancy > 50) {
    throw new HttpError(422, 'Maximum occupancy is invalid');
  }
  const amenities = Array.isArray(data?.amenities) ? data.amenities : [];
  await db.query(
    'UPDATE room_type SET name = ?, max_occupancy = ?, amenities = ? WHERE room_type_id = ?',
    [name, maxOccupancy, JSON.stringify(amenities), roomTypeId]
  );
  return { roomTypeId };
}

async function addRoomInventory(hotelIdValue, data, cognitoSub) {
  const hotelId = Number(hotelIdValue);
  const roomTypeId = Number(data?.roomTypeId);
  if (!Number.isInteger(hotelId) || !Number.isInteger(roomTypeId)) {
    throw new HttpError(422, 'Hotel ID and room type ID are required');
  }
  await assertOwnsHotel(cognitoSub, hotelId);
  const roomNumber = requiredString(data?.roomNumber, 'Room number', 20);
  const [result] = await db.query(
    `INSERT INTO room (hotel_id, room_type_id, room_number)
     SELECT ?, ?, ? FROM room_type WHERE room_type_id = ? AND hotel_id = ?`,
    [hotelId, roomTypeId, roomNumber, roomTypeId, hotelId]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Room type not found for this hotel');
  return { roomId: result.insertId };
}

async function deleteHotel(hotelIdValue, cognitoSub) {
  const hotelId = Number(hotelIdValue);
  if (!Number.isInteger(hotelId) || hotelId < 1) throw new HttpError(422, 'Hotel ID is invalid');
  await assertOwnsHotel(cognitoSub, hotelId);
  const [result] = await db.query(
    'UPDATE hotel SET deleted_at = NOW() WHERE hotel_id = ? AND deleted_at IS NULL',
    [hotelId]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Hotel not found');
  return { hotelId };
}

module.exports = {
  HttpError,
  normalizePartnerApplication,
  normalizeCompleteProperty,
  createPartnerApplication,
  getPartnerApplications,
  getOwnPartnerApplication,
  reviewPartnerApplication,
  createCompleteProperty,
  updateHotelMetadata,
  updateRoomType,
  addRoomInventory,
  deleteHotel,
};
