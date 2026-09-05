'use strict';

const express = require('express');
const adminService = require('../../services/adminService');
const { authenticate, requireGroup } = require('../../middleware/auth');

const router = express.Router();
router.use(authenticate);

function sendError(res, error, fallback) {
  const status = error.status || 500;
  console.error(fallback, error.message);
  return res.status(status).json({
    error: status >= 500 ? fallback : error.message,
  });
}

router.post('/partners/applications', async (req, res) => {
  try {
    const result = await adminService.createPartnerApplication(req.body, req.user);
    return res.status(201).json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to process partner application');
  }
});

router.get('/partners/applications/me', async (req, res) => {
  try {
    return res.json(await adminService.getOwnPartnerApplication(req.user.sub));
  } catch (error) {
    return sendError(res, error, 'Unable to load partner application');
  }
});

router.get('/partners/applications', requireGroup('SuperAdmin'), async (_req, res) => {
  try {
    return res.json(await adminService.getPartnerApplications());
  } catch (error) {
    return sendError(res, error, 'Unable to load applications');
  }
});

router.put('/partners/applications/:id/review', requireGroup('SuperAdmin'), async (req, res) => {
  try {
    return res.json(await adminService.reviewPartnerApplication(req.params.id, req.body?.status));
  } catch (error) {
    return sendError(res, error, 'Unable to review application');
  }
});

router.post('/hotels/complete', requireGroup('HotelPartner'), async (req, res) => {
  try {
    const result = await adminService.createCompleteProperty(req.body, req.user.sub);
    return res.status(201).json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to create property');
  }
});

router.put('/hotels/:id', requireGroup('HotelPartner'), async (req, res) => {
  try {
    return res.json(await adminService.updateHotelMetadata(req.params.id, req.body, req.user.sub));
  } catch (error) {
    return sendError(res, error, 'Unable to update hotel metadata');
  }
});

router.put('/room-types/:id', requireGroup('HotelPartner'), async (req, res) => {
  try {
    return res.json(await adminService.updateRoomType(req.params.id, req.body, req.user.sub));
  } catch (error) {
    return sendError(res, error, 'Unable to update room type');
  }
});

router.post('/hotels/:hotelId/rooms', requireGroup('HotelPartner'), async (req, res) => {
  try {
    const result = await adminService.addRoomInventory(
      req.params.hotelId,
      req.body?.roomTypeId,
      req.body,
      req.user.sub
    );
    return res.status(201).json(result);
  } catch (error) {
    return sendError(res, error, 'Unable to add room inventory');
  }
});

router.delete('/hotels/:id', requireGroup('HotelPartner'), async (req, res) => {
  try {
    return res.json(await adminService.deleteHotel(req.params.id, req.user.sub));
  } catch (error) {
    return sendError(res, error, 'Unable to delete hotel');
  }
});

module.exports = router;
