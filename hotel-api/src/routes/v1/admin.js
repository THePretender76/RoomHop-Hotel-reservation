const express = require('express');
const router = express.Router();
const adminService = require('../../services/adminService');
const { authenticate, requireGroup } = require('../../middleware/auth');

router.use(authenticate);

router.post('/partners/applications', requireGroup('HotelPartnerPending'), async (req, res) => {
  try {
    const result = await adminService.createPartnerApplication({
      ...req.body,
      cognitoSub: req.user.sub,
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Admin partner application failed', error.message);
    res.status(400).json({ error: 'Unable to process partner application' });
  }
});

router.post('/hotels/complete', requireGroup('HotelPartner'), async (req, res) => {
  try {
    const result = await adminService.createCompleteProperty(req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('Admin property creation failed', error.message);
    res.status(400).json({ error: 'Unable to create property' });
  }
});

router.get('/partners/applications', requireGroup('SuperAdmin'), async (req, res) => {
  try {
    const result = await adminService.getPartnerApplications();
    res.json(result);
  } catch (error) {
    console.error('Admin partner app listing failed', error.message);
    res.status(400).json({ error: 'Unable to load applications' });
  }
});

router.put('/partners/applications/:id/review', requireGroup('SuperAdmin'), async (req, res) => {
  try {
    const result = await adminService.reviewPartnerApplication(req.params.id, req.body.status);
    res.json(result);
  } catch (error) {
    console.error('Admin partner review failed', error.message);
    res.status(400).json({ error: 'Unable to review application' });
  }
});

router.put('/hotels/:id', requireGroup('HotelPartner'), async (req, res) => {
  try {
    const result = await adminService.updateHotelMetadata(req.params.id, req.body);
    res.json(result);
  } catch (error) {
    console.error('Hotel metadata update failed', error.message);
    res.status(400).json({ error: 'Unable to update hotel metadata' });
  }
});

router.put('/room-types/:id', requireGroup('HotelPartner'), async (req, res) => {
  try {
    const result = await adminService.updateRoomType(req.params.id, req.body);
    res.json(result);
  } catch (error) {
    console.error('Room type update failed', error.message);
    res.status(400).json({ error: 'Unable to update room type' });
  }
});

router.post('/hotels/:hotelId/rooms', requireGroup('HotelPartner'), async (req, res) => {
  try {
    const result = await adminService.addRoomInventory(req.params.hotelId, req.body.roomTypeId, req.body);
    res.status(201).json(result);
  } catch (error) {
    console.error('Room inventory add failed', error.message);
    res.status(400).json({ error: 'Unable to add room inventory' });
  }
});

router.delete('/hotels/:id', requireGroup('HotelPartner'), async (req, res) => {
  try {
    const result = await adminService.deleteHotel(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Hotel deletion failed', error.message);
    res.status(400).json({ error: 'Unable to delete hotel' });
  }
});

module.exports = router;
