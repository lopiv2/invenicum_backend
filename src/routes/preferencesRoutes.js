const express = require("express");
const router = express.Router();
const userService = require("../services/userService");
const verifyToken = require("../middleware/authMiddleware");

// GET /api/v1/preferences
router.get("/", verifyToken, async (req, res) => {
  try {
    const preferences = await userService.getPreferences(req.user.id);
    res.json({ success: true, data: preferences });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/v1/preferences/theme
router.get("/theme", verifyToken, async (req, res) => {
  try {
    const config = await userService.getThemePreference(req.user.id);
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/v1/preferences/custom-themes
router.get("/custom-themes", verifyToken, async (req, res) => {
  try {
    // req.user.id viene del middleware verifyToken
    const themes = await userService.getCustomThemes(req.user.id);

    res.json({
      success: true,
      data: themes, // Flutter espera esto en response.data['data']
    });
  } catch (error) {
    console.error("Error al obtener temas:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/v1/preferences/theme
router.put("/theme", verifyToken, async (req, res) => {
  try {
    const result = await userService.updateThemePreference(
      req.user.id,
      req.body
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
        message: "El campo 'language' es requerido" 
      });
    }

    const result = await userService.updateLanguage(req.user.id, language);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/v1/preferences/custom-themes
router.post("/custom-themes", verifyToken, async (req, res) => {
  try {
    const result = await userService.saveCustomTheme(req.user.id, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/v1/preferences/custom-themes/:id
router.delete("/custom-themes/:id", verifyToken, async (req, res) => {
  try {
    const themeId = req.params.id;
    const result = await userService.deleteCustomTheme(req.user.id, themeId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
