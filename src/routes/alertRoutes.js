const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const alertService = require("../services/alertService");

// Obtener todas las alertas del usuario
router.get("/alerts", verifyToken, async (req, res) => {
  try {
    const alerts = await alertService.getAlerts(req.user.id);
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Crear alerta manual
router.post("/alerts", verifyToken, async (req, res) => {
  try {
    const alert = await alertService.createAlert(req.user.id, req.body);
    res.status(201).json({ success: true, data: alert });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Marcar como leída (PATCH)
router.patch("/alerts/:id/read", verifyToken, async (req, res) => {
  try {
    await alertService.markAsRead(req.params.id, req.user.id);
    res.json({ success: true, message: "Alerta marcada como leída" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Eliminar alerta
router.delete("/alerts/:id", verifyToken, async (req, res) => {
  try {
    await alertService.deleteAlert(req.params.id, req.user.id);
    res.json({ success: true, message: "Alerta eliminada" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;