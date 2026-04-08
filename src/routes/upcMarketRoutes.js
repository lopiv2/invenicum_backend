const express = require("express");
const router = express.Router();
const upcService = require("../services/upcService");
const inventoryItemService = require("../services/inventoryItemService"); // Para actualizar el item
const verifyToken = require("../middleware/authMiddleware");

/**
 * GET /api/market/lookup/:barcode
 * only consulta the API externa and returns the info (Previsualización)
 */
router.get("/lookup/:barcode", verifyToken, async (req, res) => {
  try {
    const { barcode } = req.params;
    const userId = req.user.id;

    const data = await upcService.getMarketDataByBarcode(userId, barcode);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "No se encontraron datos para este código de barras",
      });
    }

    res.json({ success: true, data });
  } catch (error) {
    const status = error.message.includes("configurada") ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/market/sync-item/:itemId
 * Consulta the API and GUARDA the precio directamente en the ítem de inventario
 */
router.post("/sync-item/:itemId", verifyToken, async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user.id;

    // we call a a new método en the service de inventario
    const updatedItem = await inventoryItemService.syncItemMarketValue(
      itemId,
      userId,
    );

    res.json({
      success: true,
      message: "Valor de mercado actualizado y guardado",
      data: updatedItem,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/market/sync-asset-type
 * updates the valor de mercado de todos the ítems with barcode de a assetType.
 * body: { assetTypeId, containerId }
 *
 * Response: {
 *   success: true,
 *   summary: { total, updated, skipped, errors },
 *   details: [{ id, name, status, reason? }]
 * }
 */
router.post("/sync-asset-type", verifyToken, async (req, res) => {
  try {
    const { assetTypeId, containerId } = req.body;
    const userId = req.user.id;

    if (!assetTypeId || !containerId) {
      return res.status(400).json({
        success: false,
        message: "Se requieren assetTypeId y containerId",
      });
    }

    const results = await inventoryItemService.syncAssetTypeMarketValues(
      assetTypeId,
      containerId,
      userId,
    );

    res.json({
      success: true,
      message: `Sincronización completada: ${results.updated} actualizados, ${results.skipped} sin precio, ${results.errors} errores`,
      summary: {
        total:   results.total,
        updated: results.updated,
        skipped: results.skipped,
        errors:  results.errors,
      },
      details: results.details,
    });
  } catch (error) {
    const status = error.message.includes("denegado") ? 403 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

module.exports = router;
