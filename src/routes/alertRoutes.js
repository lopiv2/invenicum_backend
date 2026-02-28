const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const alertService = require("../services/alertService");
const AlertDTO = require("../models/alertModel");

// 🚀 CREAR ALERTA (Manual o Automática con Notificación)
router.post("/alerts", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // Extraemos priority_channels del body si existe
    const { priority_channels, ...alertData } = req.body;

    // 1. Guardamos la alerta en la DB (Persistencia para la App)
    const newAlert = await alertService.createAlert(userId, {
      ...alertData,
      isRead: false,
    });

    res.status(201).json({ 
      success: true, 
      data: newAlert, 
      dispatch: dispatchResult 
    });
  } catch (error) {
    console.error("Error al crear alerta:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- RESTO DE RUTAS MANTENIDAS ---

// Obtener todas las alertas
router.get("/alerts", verifyToken, async (req, res) => {
  try {
    const alerts = await alertService.getAlerts(req.user.id);
    res.json({ success: true, data: AlertDTO.fromList(alerts) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Marcar como leída
router.patch("/alerts/:id/read", verifyToken, async (req, res) => {
  try {
    await alertService.markAsRead(req.params.id, req.user.id);
    res.json({ success: true, message: "Alerta marcada como leída" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Actualizar alerta/evento
router.put("/alerts/:id", verifyToken, async (req, res) => {
  try {
    const updatedAlert = await alertService.updateAlert(req.params.id, req.user.id, req.body);
    res.json({ success: true, message: "Evento actualizado", data: updatedAlert });
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