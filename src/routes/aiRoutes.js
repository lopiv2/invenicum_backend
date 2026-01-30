// routes/aiRoutes.js
const express = require("express");
const router = express.Router();
const aiService = require("../services/aiService");
const verifyToken = require("../middleware/authMiddleware");

// Middleware de logging igual al que tienes en otros archivos
router.use((req, res, next) => {
  console.log(
    `[AI-LOG] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`
  );
  next();
});

// POST /api/ai/extract
router.post("/extract", verifyToken, async (req, res) => {
  try {
    const { url, fields } = req.body;

    if (!url) {
      return res
        .status(400)
        .json({ success: false, message: "La URL es obligatoria" });
    }

    // Definimos campos por defecto si la App no envía específicos
    const targetFields = fields || [
      "Nombre",
      "Precio",
      "Descripción",
      "Especificaciones",
    ];

    // Llamamos al servicio que ya probamos y funciona
    const result = await aiService.extractInfoFromUrl(url, targetFields);

    // Devolvemos la respuesta limpia
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("❌ Error en Ruta AI:", error.message);

    // Manejo de cuota de Google (429)
    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        message: "La IA está saturada, espera un minuto.",
      });
    }

    res.status(500).json({
      success: false,
      message: "No se pudo extraer la información",
      error: error.message,
    });
  }
});

module.exports = router;
