const express = require("express");
const router = express.Router();
const preferencesService = require("../services/preferencesService");
const verifyToken = require("../middleware/authMiddleware");
const {
  AI_MODELS,
  AI_PROVIDERS,
  DEFAULT_MODELS,
} = require("../config/aiConstants");

// GET /api/v1/preferences
router.get("/", verifyToken, async (req, res) => {
  try {
    const preferences = await preferencesService.getPreferences(req.user.id);
    res.json({ success: true, data: preferences });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.use((req, res, next) => {
  console.log(
    `[DEBUG] Método: ${req.method} | Path solicitado: ${req.path} | Full URL: ${req.originalUrl}`,
  );
  next();
});

// PUT /api/v1/preferences/notifications
router.put("/notifications", verifyToken, async (req, res) => {
  try {
    // 1. Obtenemos el ID del usuario del token
    const userId = req.user.id;

    // 2. Llamamos al servicio (necesitaremos crear este método en preferencesService)
    const result = await preferencesService.updateNotificationSettings(
      userId,
      req.body,
    );

    res.json({
      success: true,
      data: result,
      message: "Configuración de notificaciones actualizada",
    });
  } catch (error) {
    console.error("Error en PATCH /notifications:", error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar las notificaciones: " + error.message,
    });
  }
});

// PATCH /api/v1/preferences/ai-status
router.patch("/ai-status", verifyToken, async (req, res) => {
  try {
    const { aiEnabled } = req.body;

    // Validación básica: verificamos que no sea undefined (ya que es un booleano)
    if (aiEnabled === undefined) {
      return res.status(400).json({
        success: false,
        message: "El campo 'aiEnabled' es requerido",
      });
    }

    // Usamos el método unificado del servicio
    const result = await preferencesService.updateAiEnabled(
      req.user.id,
      aiEnabled,
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/v1/preferences/theme
router.get("/theme", verifyToken, async (req, res) => {
  try {
    const config = await preferencesService.getThemePreference(req.user.id);
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/v1/preferences/custom-themes
router.get("/custom-themes", verifyToken, async (req, res) => {
  try {
    // req.user.id viene del middleware verifyToken
    const themes = await preferencesService.getCustomThemes(req.user.id);

    res.json({
      success: true,
      data: themes, // Flutter espera esto en response.data['data']
    });
  } catch (error) {
    console.error("Error al obtener temas:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /api/v1/preferences/visual-settings
router.patch("/visual-settings", verifyToken, async (req, res) => {
  try {
    const { useSystemTheme, isDarkMode } = req.body;

    // Usamos el método unificado que ya actualiza la tabla UserPreferences
    const result = await preferencesService.updatePreferences(req.user.id, {
      useSystemTheme,
      isDarkMode,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/v1/preferences/theme
router.put("/theme", verifyToken, async (req, res) => {
  try {
    const result = await preferencesService.updateThemePreference(
      req.user.id,
      req.body,
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/v1/preferences/language
router.put("/language", verifyToken, async (req, res) => {
  try {
    const { language } = req.body;

    if (!language) {
      return res.status(400).json({
        success: false,
        message: "El campo 'language' es requerido",
      });
    }

    const result = await preferencesService.updateLanguage(
      req.user.id,
      language,
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/currency", verifyToken, async (req, res) => {
  try {
    const { currency } = req.body;

    if (!currency) {
      return res.status(400).json({
        success: false,
        message: "El campo 'currency' es requerido",
      });
    }

    // Validación de longitud básica (ej: 'EUR', 'USD')
    if (currency.length !== 3) {
      return res.status(400).json({
        success: false,
        message: "Formato de moneda inválido (deben ser 3 caracteres)",
      });
    }

    const result = await preferencesService.updateCurrency(
      req.user.id,
      currency.toUpperCase(), // Lo guardamos siempre en mayúsculas
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/v1/preferences/custom-themes
router.post("/custom-themes", verifyToken, async (req, res) => {
  try {
    const result = await preferencesService.saveCustomTheme(
      req.user.id,
      req.body,
    );
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/v1/preferences/custom-themes/:id
router.delete("/custom-themes/:id", verifyToken, async (req, res) => {
  try {
    const themeId = req.params.id;
    const result = await preferencesService.deleteCustomTheme(
      req.user.id,
      themeId,
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/v1/preferences/ai-models
// Devuelve los modelos disponibles por proveedor para que Flutter
// construya el selector dinámicamente sin hardcodear nada en el frontend.
router.get("/ai-models", verifyToken, (req, res) => {
  res.json({ success: true, data: AI_MODELS });
});

// PATCH /api/v1/preferences/ai-provider
router.patch("/ai-provider", verifyToken, async (req, res) => {
  try {
    const { aiProvider, aiModel } = req.body;
    const providerList = Object.values(AI_PROVIDERS);

    // 1. Validar proveedor
    if (!aiProvider || !providerList.includes(aiProvider)) {
      return res.status(400).json({
        success: false,
        message: `Proveedor inválido. Valores posibles: ${providerList.join(", ")}`,
      });
    }

    // 2. Validar que existan modelos para ese proveedor
    const modelsForProvider = AI_MODELS[aiProvider];
    if (!modelsForProvider) {
      throw new Error(
        `No hay modelos configurados para el proveedor: ${aiProvider}`,
      );
    }

    const validModelsIds = modelsForProvider.map((m) => m.id);

    // 3. Determinar el modelo final
    const finalModel =
      aiModel && validModelsIds.includes(aiModel)
        ? aiModel
        : DEFAULT_MODELS[aiProvider];

    const result = await preferencesService.updatePreferences(req.user.id, {
      aiProvider,
      aiModel: finalModel,
    });

    res.json(result.success ? result : res.status(400).json(result));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
