const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const alertService = require("../services/alertService");
const AlertDTO = require("../models/alertModel");

// Obtener todas las alertas del usuario
router.get("/alerts", verifyToken, async (req, res) => {
  try {
    const alerts = await alertService.getAlerts(req.user.id);

    // Aplicamos el DTO a la lista antes de enviarla
    const formattedAlerts = AlertDTO.fromList(alerts);

    res.json({ success: true, data: formattedAlerts });
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

// Actualizar alerta/evento (PUT)
router.put("/alerts/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Llamamos al servicio para actualizar
    const updatedAlert = await alertService.updateAlert(id, userId, req.body);
    
    res.json({ 
      success: true, 
      message: "Evento actualizado correctamente",
      data: updatedAlert 
    });
  } catch (error) {
    console.error("Error al actualizar alerta:", error);
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
