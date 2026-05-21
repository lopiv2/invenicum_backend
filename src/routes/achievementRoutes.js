const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const achievementService = require('../services/achievementService');

// GET /api/v1/achievements
router.get('/', verifyToken, async (req, res) => {
  try {
    const data = await achievementService.getUserAchievements(req.user.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/v1/achievements/event
// Body: { type: "ITEM_CREATED", value: 1, metadata: {} }
router.post('/event', verifyToken, async (req, res) => {
  try {
    const { type, value = 1, metadata } = req.body;
    if (!type) {
      return res.status(400).json({ success: false, message: 'type is required' });
    }
    const result = await achievementService.processEvent(req.user.id, {
      type, value, metadata,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;