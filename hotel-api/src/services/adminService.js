const db = require('../db');
const { CognitoIdentityServiceProvider } = require('aws-sdk');

const cognito = new CognitoIdentityServiceProvider({ region: process.env.AWS_REGION || 'us-east-1' });

async function updateCognitoGroups(cognitoSub, status) {
  if (!cognitoSub || !process.env.COGNITO_USER_POOL_ID) {
    return;
  }

  if (status === 'APPROVED') {
    await cognito.adminAddUserToGroup({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: cognitoSub,
      GroupName: 'HotelPartner',
    }).promise();

    await cognito.adminRemoveUserFromGroup({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: cognitoSub,
      GroupName: 'HotelPartnerPending',
    }).promise();
  }
}

function validatePartnerApplication(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Application payload is required');
  }

  if (!data.companyName || !String(data.companyName).trim()) {
    throw new Error('Company name is required');
  }

  if (!data.taxId || !String(data.taxId).trim()) {
    throw new Error('Tax ID is required');
  }

  if (!data.fullName || !String(data.fullName).trim()) {
    throw new Error('Full name is required');
  }

  if (!data.corporateEmail || !String(data.corporateEmail).trim()) {
    throw new Error('Corporate email is required');
  }

  if (!data.phoneNumber || !String(data.phoneNumber).trim()) {
    throw new Error('Phone number is required');
  }

  if (!data.headOfficeAddress || !String(data.headOfficeAddress).trim()) {
    throw new Error('Head office address is required');
  }

  if (!data.primaryCity || !String(data.primaryCity).trim()) {
    throw new Error('Primary city is required');
  }

  if (!data.websiteUrl || !String(data.websiteUrl).trim()) {
    throw new Error('Website URL is required');
  }

  if (!data.cognitoSub || !String(data.cognitoSub).trim()) {
    throw new Error('Cognito subject is required');
  }
}

function validateCompleteProperty(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Property payload is required');
  }

  if (!payload.hotel || typeof payload.hotel !== 'object') {
    throw new Error('Hotel payload is required');
  }

  if (!payload.hotel.name || !String(payload.hotel.name).trim()) {
    throw new Error('Hotel name is required');
  }

  if (!payload.hotel.location || !String(payload.hotel.location).trim()) {
    throw new Error('Hotel location is required');
  }

  if (!payload.hotel.description || !String(payload.hotel.description).trim()) {
    throw new Error('Hotel description is required');
  }

  if (!payload.hotel.stars || Number(payload.hotel.stars) < 1 || Number(payload.hotel.stars) > 5) {
    throw new Error('Hotel stars must be between 1 and 5');
  }

  if (!Array.isArray(payload.roomTypes)) {
    throw new Error('Room types must be an array');
  }
}

async function createPartnerApplication(data) {
  validatePartnerApplication(data);

  const [result] = await db.query(
    `INSERT INTO hotel_administrators (
      cognito_sub,
      company_name,
      tax_id,
      full_name,
      corporate_email,
      phone_number,
      head_office_address,
      estimated_properties,
      primary_city,
      website_url,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW(), NOW())`,
    [
      data.cognitoSub,
      data.companyName,
      data.taxId,
      data.fullName,
      data.corporateEmail,
      data.phoneNumber,
      data.headOfficeAddress,
      Number(data.estimatedProperties || 0),
      data.primaryCity,
      data.websiteUrl,
    ]
  );

  return { applicantId: result.insertId, status: 'PENDING' };
}

async function createCompleteProperty(payload) {
  validateCompleteProperty(payload);

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const [hotelResult] = await conn.query(
      `INSERT INTO hotel (name, location, description, stars, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [payload.hotel.name, payload.hotel.location, payload.hotel.description, Number(payload.hotel.stars)]
    );

    const hotelId = hotelResult.insertId;

    for (const roomType of payload.roomTypes) {
      const [roomTypeResult] = await conn.query(
        `INSERT INTO room_type (hotel_id, name, max_occupancy, amenities)
         VALUES (?, ?, ?, ?)`,
        [hotelId, roomType.name, Number(roomType.maxOccupancy || 1), JSON.stringify(roomType.amenities || [])]
      );

      const roomTypeId = roomTypeResult.insertId;

      if (roomType.nightlyRate !== undefined && roomType.nightlyRate !== null) {
        const placeholders = Array.from({ length: 365 }, () => '(?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY))').join(', ');
        const params = [];

        for (let dayOffset = 0; dayOffset < 365; dayOffset += 1) {
          params.push(hotelId, roomTypeId, roomType.nightlyRate, dayOffset);
        }

        await conn.query(
          `INSERT INTO room_type_rate (hotel_id, room_type_id, nightly_rate, date)
           VALUES ${placeholders}`,
          params
        );
      }

      if (roomType.inventoryCount !== undefined && roomType.inventoryCount !== null) {
        const placeholders = Array.from({ length: 365 }, () => '(?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), 0)').join(', ');
        const params = [];

        for (let dayOffset = 0; dayOffset < 365; dayOffset += 1) {
          params.push(hotelId, roomTypeId, roomType.inventoryCount, dayOffset);
        }

        await conn.query(
          `INSERT INTO room_type_inventory (hotel_id, room_type_id, total_inventory, date, total_reserved)
           VALUES ${placeholders}`,
          params
        );
      }

      if (Array.isArray(roomType.inventoryRoomNumbers) && roomType.inventoryRoomNumbers.length > 0) {
        for (const roomNumber of roomType.inventoryRoomNumbers) {
          await conn.query(
            `INSERT INTO room (hotel_id, room_type_id, room_number)
             VALUES (?, ?, ?)`,
            [hotelId, roomTypeId, roomNumber]
          );
        }
      }
    }

    await conn.commit();
    return { hotelId, roomTypes: payload.roomTypes };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function getPartnerApplications() {
  const [rows] = await db.query(
    `SELECT admin_id, cognito_sub, company_name, tax_id, full_name, corporate_email, phone_number, head_office_address, estimated_properties, primary_city, website_url, status, created_at
     FROM hotel_administrators
     ORDER BY created_at DESC`
  );

  return rows;
}

async function reviewPartnerApplication(applicantId, status) {
  const allowedStatuses = ['APPROVED', 'REJECTED'];
  if (!allowedStatuses.includes(status)) {
    throw new Error('Status must be APPROVED or REJECTED');
  }

  const [applicantRows] = await db.query(
    `SELECT cognito_sub FROM hotel_administrators WHERE admin_id = ? LIMIT 1`,
    [applicantId]
  );

  if (!applicantRows.length) {
    throw new Error('Applicant not found');
  }

  const [result] = await db.query(
    `UPDATE hotel_administrators SET status = ?, updated_at = NOW() WHERE admin_id = ?`,
    [status, applicantId]
  );

  if (result.affectedRows === 0) {
    throw new Error('Applicant not found');
  }

  if (status === 'APPROVED') {
    await updateCognitoGroups(applicantRows[0].cognito_sub, status);
  }

  return { applicantId, status };
}

async function updateHotelMetadata(hotelId, data) {
  const [result] = await db.query(
    `UPDATE hotel SET name = ?, location = ?, description = ?, stars = ? WHERE hotel_id = ?`,
    [data.name, data.location, data.description, data.stars, hotelId]
  );

  if (result.affectedRows === 0) {
    throw new Error('Hotel not found');
  }

  return { hotelId };
}

async function updateRoomType(roomTypeId, data) {
  const [result] = await db.query(
    `UPDATE room_type SET name = ?, max_occupancy = ?, amenities = ? WHERE room_type_id = ?`,
    [data.name, data.maxOccupancy, JSON.stringify(data.amenities || []), roomTypeId]
  );

  if (result.affectedRows === 0) {
    throw new Error('Room type not found');
  }

  return { roomTypeId };
}

async function addRoomInventory(hotelId, roomTypeId, data) {
  const [result] = await db.query(
    `INSERT INTO room (hotel_id, room_type_id, room_number) VALUES (?, ?, ?)` ,
    [hotelId, roomTypeId, data.roomNumber]
  );

  return { roomId: result.insertId };
}

async function deleteHotel(hotelId) {
  const [result] = await db.query(`UPDATE hotel SET deleted_at = NOW() WHERE hotel_id = ?`, [hotelId]);
  if (result.affectedRows === 0) {
    throw new Error('Hotel not found');
  }
  return { hotelId };
}

module.exports = {
  createPartnerApplication,
  createCompleteProperty,
  getPartnerApplications,
  reviewPartnerApplication,
  updateHotelMetadata,
  updateRoomType,
  addRoomInventory,
  deleteHotel,
};
