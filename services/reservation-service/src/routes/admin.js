'use strict';

const express = require('express');
const { requireGroup } = require('../middleware/auth');
const adminService = require('../services/adminService');
const logger = require('../logger');
const { markActiveSpanError, withSpan } = require('../tracing');
const { createHotelImageUpload } = require('../imageUpload');

const router = express.Router();

function sendError(res, error, operation) {
  const status = error.status || 500;
  markActiveSpanError(error.status ? 'business_error' : 'admin_error');
  logger.error(`Admin operation failed: ${operation}`, {
    error: error.message,
    stack: error.stack,
  });
  return res.status(status).json({
    error: status >= 500 ? 'Internal server error' : error.message,
  });
}

router.post('/partners/applications', async (req, res) => {
  try {
    const result = await withSpan('admin.partnerApplication', {
      annotations: { operation: 'partner_application_create' },
      errorType: 'admin_partner_application_error',
    }, () => adminService.createPartnerApplication(req.body, req.user));
    return res.status(201).json(result);
  } catch (error) {
    return sendError(res, error, 'create partner application');
  }
});

router.get('/partners/applications/me', async (req, res) => {
  try {
    const result = await adminService.getOwnPartnerApplication(req.user.sub);
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'get own partner application');
  }
});

router.get('/partners/applications', requireGroup('SuperAdmin'), async (_req, res) => {
  try {
    const result = await adminService.getPartnerApplications();
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'list partner applications');
  }
});

router.put('/partners/applications/:id/review', requireGroup('SuperAdmin'), async (req, res) => {
  try {
    const result = await withSpan('admin.reviewPartnerApplication', {
      annotations: { operation: 'partner_application_review' },
      errorType: 'admin_partner_review_error',
    }, () => adminService.reviewPartnerApplication(req.params.id, req.body?.status));
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'review partner application');
  }
});

router.post('/hotels/complete', requireGroup('HotelPartner'), async (req, res) => {
  try {
    const result = await withSpan('admin.createProperty', {
      annotations: { operation: 'property_create' },
      errorType: 'admin_property_create_error',
    }, () => adminService.createCompleteProperty(req.body, req.user.sub));
    return res.status(201).json(result);
  } catch (error) {
    return sendError(res, error, 'create complete property');
  }
});

router.post('/hotels/image-upload', requireGroup('HotelPartner'), async (req, res) => {
  try {
    const result = await createHotelImageUpload(req.body || {}, req.user.sub);
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'create hotel image upload');
  }
});

router.put('/hotels/:id', requireGroup('HotelPartner'), async (req, res) => {
  try {
    return res.status(200).json(
      await adminService.updateHotelMetadata(req.params.id, req.body, req.user.sub)
    );
  } catch (error) {
    return sendError(res, error, 'update hotel');
  }
});

router.post('/hotels/:hotelId/rooms', requireGroup('HotelPartner'), async (req, res) => {
  try {
    return res.status(201).json(
      await adminService.addRoomInventory(req.params.hotelId, req.body, req.user.sub)
    );
  } catch (error) {
    return sendError(res, error, 'add room');
  }
});

router.delete('/hotels/:id', requireGroup('HotelPartner'), async (req, res) => {
  try {
    return res.status(200).json(await adminService.deleteHotel(req.params.id, req.user.sub));
  } catch (error) {
    return sendError(res, error, 'delete hotel');
  }
});

router.put('/room-types/:id', requireGroup('HotelPartner'), async (req, res) => {
  try {
    return res.status(200).json(
      await adminService.updateRoomType(req.params.id, req.body, req.user.sub)
    );
  } catch (error) {
    return sendError(res, error, 'update room type');
  }
});

module.exports = router;
