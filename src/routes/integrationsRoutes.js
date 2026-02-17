const express = require("express");
const router = express.Router();
const integrationService = require("../services/integrationsService");
const verifyToken = require("../middleware/authMiddleware");

// Middleware de logging
router.use((req, res, next) => {
  console.log(
    `[INTEGRATION-LOG] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`,
  );
  next();
});

// POST /api/integrations/test
router.post("/test", verifyToken, async (req, res) => {
  try {
    const { type, config } = req.body;

    // Ejecutamos el test sin guardar nada en BD
    const result = await integrationService.testConnection(type, config);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "Error en el servidor" });
  }
});

// GET /api/integrations/status
router.get("/status", verifyToken, async (req, res) => {
  try {
    const integrations = await integrationService.getStatuses(req.user.id);

    // Transformamos el array de DTOs en un mapa simple para Flutter { "gemini": true }
    const statusMap = {};
    integrations.forEach((i) => {
      statusMap[i.type] = i.isActive;
    });

    res.status(200).json({ data: statusMap });
  } catch (error) {
    console.error("❌ Error obteniendo estados:", error.message);
    res.status(500).json({ error: "Error al obtener estados de integración" });
  }
});

// GET /api/integrations/:type
router.get("/:type", verifyToken, async (req, res) => {
  try {
    const integrationDto = await integrationService.getConfig(
      req.user.id,
      req.params.type,
    );

    // Si no existe, devolvemos un objeto de configuración vacío
    if (!integrationDto) {
      return res.status(200).json({ data: { config: {} } });
    }

    // Devolvemos el config (que el servicio ya debería haber descifrado)
    res.status(200).json({
      data: {
        config: integrationDto.config,
      },
    });
  } catch (error) {
    console.error("❌ Error obteniendo config:", error.message);
    res.status(500).json({ error: "Error al obtener la configuración" });
  }
});

// POST /api/integrations
router.post("/", verifyToken, async (req, res) => {
  try {
    const { type, config } = req.body;
    const userId = req.user.id;

    if (!type || !config) {
      return res
        .status(400)
        .json({ error: "Tipo y configuración son obligatorios" });
    }

    // Guardamos (el servicio se encarga del cifrado)
    await integrationService.saveConfig(userId, type, config);

    res.status(200).json({
      success: true,
      message: `Integración ${type} guardada correctamente`,
    });
  } catch (error) {
    console.error("❌ Error guardando integración:", error.message);
    res.status(500).json({ error: "Error al guardar la integración" });
  }
});

// DELETE /api/integrations/:type
router.delete("/:type", verifyToken, async (req, res) => {
  try {
    await integrationService.deleteIntegration(req.user.id, req.params.type);
    res.status(200).json({ message: "Integración desactivada" });
  } catch (error) {
    res.status(500).json({ error: "Error al desactivar la integración" });
  }
});

module.exports = router;
