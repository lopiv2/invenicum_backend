// routes/aiRoutes.js
const express = require("express");
const router = express.Router();
const aiService = require("../services/aiService");
const verifyToken = require("../middleware/authMiddleware");

// Middleware de logging igual al que tienes en otros archivos
router.use((req, res, next) => {
  console.log(
    `[AI-LOG] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`,
  );
  next();
});

// POST /api/ai/chat/veni
router.post("/chat/veni", verifyToken, async (req, res) => {
  try {
    const { message, context } = req.body;
    const userId = req.user.id;

    // 1. GUARDAR MENSAJE DEL USUARIO (Lo que tú escribes)
    // Esto es lo que te faltaba o estaba fallando
    await aiService.saveMessage(userId, message, true);

    const updatedContext = { ...context, userId: userId };

    // 2. PROCESAR CON LA IA
    const result = await aiService.processChatConversation(
      message,
      updatedContext,
    );

    // 3. GUARDAR RESPUESTA DE LA IA (Lo que dice Veni)
    if (result && result.answer) {
      await aiService.saveMessage(userId, result.answer, false);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("❌ Error en el chat:", error);
    res.status(500).json({ error: "Error en el chat" });
  }
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

// 1. Obtener historial (Solo últimas 24h)
router.get("/chat/history", verifyToken, async (req, res) => {
  try {
    const history = await aiService.getRecentHistory(req.user.id);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

module.exports = router;
