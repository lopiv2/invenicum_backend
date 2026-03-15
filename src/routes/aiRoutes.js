// routes/aiRoutes.js
const express = require("express");
const router = express.Router();
const aiService = require("../services/aiService");
const templateService = require("../services/templateService");
const verifyToken = require("../middleware/authMiddleware");

// Middleware de logging igual al que tienes en otros archivos
router.use((req, res, next) => {
  console.log(
    `[AI-LOG] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`,
  );
  next();
});

router.post("/chat/save-template", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { templateData } = req.body; // El objeto 'data' generado por Gemini

    // Usamos el ID generado o uno nuevo
    const finalTemplate = {
      id: `tpl_ai_${Date.now()}`,
      ...templateData,
      isOfficial: false,
      author: "Veni AI",
    };

    // Guardamos directamente en la biblioteca del usuario
    await templateService.saveTemplateToUser(userId, finalTemplate);

    res.status(200).json({ success: true, message: "Plantilla guardada" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ai/chat/veni
router.post("/chat/veni", verifyToken, async (req, res) => {
  try {
    const { message, context } = req.body;
    const userId = req.user.id;

    // SAY_HELLO_INITIAL es un comando interno — no se guarda en el historial
    // para que no aparezca al cargar el historial de conversación.
    if (message !== "SAY_HELLO_INITIAL") {
      await aiService.saveMessage(userId, message, true);
    }

    const updatedContext = { 
      ...context, 
      userId: userId,
      locale: context?.locale || 'es' // Fallback a español si no viene
    };

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
    const userId = req.user.id; // Extraído por el middleware verifyToken

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

    // PASO CLAVE: Pasamos el userId al servicio para que él gestione la API Key
    const result = await aiService.extractInfoFromUrl(
      url,
      targetFields,
      userId,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("❌ Error en Ruta AI:", error.message);

    // Si el error es específicamente por falta de configuración
    if (
      error.message.includes("configuración") ||
      error.message.includes("activa")
    ) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    // Manejo de cuota de Google (429)
    if (error.status === 429 || error.message.includes("429")) {
      return res.status(429).json({
        success: false,
        message: "Tu cuota de Gemini se ha agotado o está saturada.",
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