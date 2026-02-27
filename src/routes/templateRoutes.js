const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const templateService = require("../services/templateService");
const AssetTemplateDTO = require("../models/templateModel"); // 👈 Importamos el DTO aquí también

// GET: Todas las plantillas disponibles en el mercado
router.get("/market", verifyToken, async (req, res) => {
  try {
    const templates = await templateService.getAllMarketTemplates();

    // 🚩 Aunque el service ya debería devolver DTOs,
    // es buena práctica asegurar que el array sea procesado aquí.
    res.json(AssetTemplateDTO.fromList(templates));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Ruta para registrar la descarga/instalación
router.post("/:id/download", verifyToken, async (req, res) => {
  try {
    const templateId = req.params.id;

    // Ejecutamos el incremento (puedes no usar 'await' si quieres que la
    // respuesta al front sea instantánea sin esperar a GitHub)
    templateService.incrementDownloadCount(templateId);

    res.json({ success: true, message: "Contador de descarga actualizado" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Publicar una nueva plantilla en el Market
router.post("/publish", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const templateData = req.body;

    const result = await templateService.publishTemplate(userId, templateData);

    // 🚩 Devolvemos la data a través del DTO para que el frontend
    // reciba inmediatamente el objeto con el formato correcto (created_at, author_name, etc.)
    res.status(201).json({
      success: true,
      message:
        "Plantilla publicada correctamente. Se ha creado un Pull Request para revisión.",
      data: new AssetTemplateDTO(result).toJSON(),
    });
  } catch (error) {
    console.error("[TEMPLATE_PUBLISH_ROUTE_ERROR]:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET: Detalle completo de una plantilla
router.get("/detail/:id", verifyToken, async (req, res) => {
  try {
    const template = await templateService.getTemplateDetail(req.params.id);
    if (!template) {
      return res
        .status(404)
        .json({ success: false, message: "Plantilla no encontrada" });
    }

    // 🚩 Aseguramos que el detalle use la estructura snake_case esperada por Flutter
    res.json(new AssetTemplateDTO(template).toJSON());
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
