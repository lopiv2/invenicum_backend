const express = require('express');
const router = express.Router();
const ebayService = require('../services/ebayService');

router.get('/market-data', async (req, res) => {
  try {
    // Solo extraemos datos de la request
    const userId = req.user.id; 
    const { keywords } = req.query;

    if (!keywords) return res.status(400).json({ message: "Keywords requeridas" });

    // Llamada única al servicio
    const result = await ebayService.getMarketDataForUser(userId, keywords);

    // Respuesta directa
    res.json(result);
  } catch (error) {
    // El servicio lanza el error, la ruta decide el status code
    const status = error.message.includes('configurada') ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

module.exports = router;