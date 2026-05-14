const express = require("express");
const router = express.Router();
const integrationService = require("../services/integrationsService");
const verifyToken = require("../middleware/authMiddleware");
const { Temporal } = require("@js-temporal/polyfill");

// Middleware de logging
router.use((req, res, next) => {
  console.log(
    `[INTEGRATION-LOG] ${Temporal.Now.plainDateISO().toString()} ${req.method} ${req.originalUrl}`,
  );
  next();
});

// GET /api/integrations/barcode/lookup/:barcode
router.get("/barcode/lookup/:barcode", verifyToken, async (req, res) => {
  try {
    const { barcode } = req.params;
    const userId = req.user.id;

    const inventoryItemDto = await integrationService.lookupBarcode(
      userId,
      barcode,
    );

    if (inventoryItemDto) {
      // 🚩 Use the método toJSON del DTO
      res.status(200).json({ data: inventoryItemDto.toJSON() });
    } else {
      res.status(404).json({ message: "Producto no encontrado" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/integrations/test
router.post("/test", verifyToken, async (req, res) => {
  try {
    const { type, config } = req.body;
    const userId = req.user.id;

    // Ejecutamos the test without guardar nada en BD
    const result = await integrationService.testConnection(
      type,
      config,
      userId,
    );

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

    // Transformamos the array de DTOs en a mapa simple for Flutter { "gemini": true }
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

// GET /api/integrations/enrich?query=pikachu&source=pokemon&locale=es
router.get("/enrich", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { query, source, locale, fieldOptions, page, pageSize } = req.query;

    // Basic validation
    if (!query) {
      return res
        .status(400)
        .json({ error: "El parámetro 'query' es obligatorio" });
    }

    const enrichedItem = await integrationService.getEnrichedItem(
      userId,
      query,
      source || "bgg",
      locale || "es",
      fieldOptions,
      parseInt(page ?? "1"),
      parseInt(pageSize ?? "30"),
    );

    res.status(200).json({
      success: true,
      data: enrichedItem,
    });
  } catch (error) {
    console.error(`[ENRICH-ERROR] ${error.message}`);

    // if es a error de "no encontrado" mandamos 404, if no 500
    const statusCode = error.message.includes("no encontrado") ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/integrations/enrich/select?source=bgg&itemId=13&locale=es
router.get("/enrich/select", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { source, itemId, locale } = req.query;

    if (!source || !itemId) {
      return res
        .status(400)
        .json({ error: "Los parámetros 'source' e 'itemId' son obligatorios" });
    }

    const enrichedItem = await integrationService.processSelectedItem(
      userId,
      source,
      itemId,
      locale || "es",
    );

    res.status(200).json({
      success: true,
      data: enrichedItem,
    });
  } catch (error) {
    console.error(`[ENRICH-SELECT-ERROR] ${error.message}`);
    const statusCode = error.message.includes("no encontrado") ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/integrations/:type
router.get("/:type", verifyToken, async (req, res) => {
  try {
    const integrationDto = await integrationService.getConfig(
      req.user.id,
      req.params.type,
    );

    // if no existe, devolvemos a objeto de configuración vacío
    if (!integrationDto) {
      return res.status(200).json({ data: { config: {} } });
    }

    // Devolvemos the config (que the service ya debería haber descifrado)
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

    // Guardamos (the service se encarga del encrypted)
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
