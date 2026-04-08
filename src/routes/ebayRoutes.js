const express = require('express');
const router = express.Router();
const ebayService = require('../services/ebayService');

router.get('/market-data', async (req, res) => {
  try {
    // only extraemos data de the request
    const userId = req.user.id; 
    const { keywords } = req.query;

    if (!keywords) return res.status(400).json({ message: "Keywords requeridas" });

    // call única al service
    const result = await ebayService.getMarketDataForUser(userId, keywords);

    // Response directa
    res.json(result);
  } catch (error) {
    // the service lanza the error, the route decide the status code
    const status = error.message.includes('configurada') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

module.exports = router;
