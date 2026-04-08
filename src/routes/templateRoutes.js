const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const templateService = require("../services/templateService");
const AssetTemplateDTO = require("../models/templateModel"); // 👈 Importamos el DTO aquí también

// GET: Todas the plantillas disponibles en the mercado
router.get("/market", verifyToken, async (req, res) => {
  try {
    const templates = await templateService.getAllMarketTemplates();

    // 🚩 Aunque the service ya debería devolver DTOs,
    // es buena práctica Ensurer que the array sea procesado aquí.
    res.json(AssetTemplateDTO.fromList(templates));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// route for registrar the descarga/instalación
router.post("/:id/download", verifyToken, async (req, res) => {
  try {
    const templateId = req.params.id;

    // Ejecutamos the incremento (puedes no Use 'await' if quieres que the
    // Response al front sea instantánea without esperar a GitHub)
    templateService.incrementDownloadCount(templateId);

    res.json({ success: true, message: "Contador de descarga actualizado" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Publicar a new plantilla en the Market
router.post("/publish", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const templateData = req.body;

    const result = await templateService.publishTemplate(userId, templateData);

    // 🚩 Devolvemos the data a través del DTO so that the frontend
    // reciba inmediatamente the objeto with the formato correcto (Createted_at, author_name, etc.)
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

// GET: Detalle completo de a plantilla
router.get("/detail/:id", verifyToken, async (req, res) => {
  try {
    const template = await templateService.getTemplateDetail(req.params.id);
    if (!template) {
      return res
        .status(404)
        .json({ success: false, message: "Plantilla no encontrada" });
    }

    // 🚩 Ensure que the detalle use the estructura snake_case esperada por Flutter
    res.json(new AssetTemplateDTO(template).toJSON());
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
