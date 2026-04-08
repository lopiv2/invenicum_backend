const express = require("express");
const router = express.Router();
const reportService = require("../services/reportService");
const authMiddleware = require("../middleware/authMiddleware");
const fs = require("fs");

// 🔒 Aplicar middleware de autenticación a todas the ROUTES
router.use(authMiddleware);

/**
 * GET /api/v1/reports/generate/:containerId
 * Genera a new reporte al vuelo and lo descarga
 *
 * Query params:
 * - type: inventory|loans|assets (requerido)
 * - format: pdf|excel (requerido)
 * - Otros parámetros serán tratados como filtros (assetTypeId, locationId, status, etc.)
 */
router.get("/generate/:containerId", async (req, res) => {
  try {
    const { containerId } = req.params;
    const userId = req.user.id;
    const { type: reportType, format } = req.query;
    const currency = req.query.currency || "USD";
    const locale =
      req.query.locale ||
      req.headers["accept-language"]?.split(",")[0]?.split("-")[0] ||
      "es";

    // Validar entrada
    if (!reportType || !format) {
      return res.status(400).json({
        error: "Los parámetros 'type' y 'format' son requeridos",
      });
    }

    const validTypes = ["inventory", "loans", "assets"];
    const validFormats = ["pdf", "excel"];

    if (!validTypes.includes(reportType)) {
      return res.status(400).json({
        error: `Tipo de reporte inválido. Debe ser uno de: ${validTypes.join(", ")}`,
      });
    }

    if (!validFormats.includes(format)) {
      return res.status(400).json({
        error: `Formato inválido. Debe ser uno de: ${validFormats.join(", ")}`,
      });
    }

    // Extraer filtros del query string (excluyendo type and format)
    const filters = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== "type" && key !== "format") {
        // Intentar convertir a número if es posible
        filters[key] = isNaN(value) ? value : parseInt(value);
      }
    }

    const result = await reportService.generateReport(
      containerId,
      userId,
      reportType,
      format,
      filters,
      locale,
      currency
    );

    // Verify que the archivo existe
    if (!fs.existsSync(result.filePath)) {
      return res.status(404).json({
        error: "El archivo del reporte no se generó correctamente",
      });
    }

    // Descargar the archivo directamente
    res.download(result.filePath, result.fileName, (err) => {
      if (err) {
        console.error("Error downloading report:", err);
      }
    });
  } catch (error) {
    console.error("Error in GET /reports/generate:", error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
