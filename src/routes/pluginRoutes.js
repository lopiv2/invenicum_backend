const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const { validatePlugin } = require("../middleware/jsValidator");
const pluginService = require("../services/pluginService");

// GET: Plugins instalados por el usuario (Para los StacSlots)
router.get("/installed", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // Pasamos el userId para que el servicio calcule el campo 'isMine'
    const plugins = await pluginService.getUserPlugins(userId);
    res.json(plugins);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT: Activar o desactivar un plugin instalado (Toggle)
router.put("/user/toggle", async (req, res) => {
  try {
    const { pluginId, isActive } = req.body;
    const userId = req.user.id; // El ID viene del token JWT

    if (!pluginId || isActive === undefined) {
      return res.status(400).json({
        message_es: "pluginId and isActive are required",
      });
    }

    const updatedRelation = await pluginService.toggleUserPlugin(
      userId,
      pluginId,
      isActive,
    );

    res.json({
      message: "Plugin status updated successfully",
      data: updatedRelation,
    });
  } catch (error) {
    console.error("Error en toggleUserPlugin:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// POST: Crear un nuevo plugin global
router.post("/", verifyToken, validatePlugin, async (req, res) => {
  try {
    const result = await pluginService.createPlugin(req.body, req.user.id);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT: Actualizar un plugin existente
router.put("/:id", verifyToken, validatePlugin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pluginService.updatePlugin(id, req.body, req.user.id);
    res.json(result);
  } catch (error) {
    res.status(403).json({ success: false, message: error.message });
  }
});

// DELETE: Eliminar un plugin de la base de datos global
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    // 💡 Solo el autor podrá borrarlo
    await pluginService.deletePlugin(id, req.user.id);
    res.json({ success: true, message: "Plugin eliminado correctamente" });
  } catch (error) {
    res.status(403).json({ success: false, message: error.message });
  }
});

// GET: Plugins disponibles en la comunidad
router.get("/community", verifyToken, async (req, res) => {
  try {
    // 💡 Pasamos el ID para saber cuáles de la comunidad son "míos"
    const plugins = await pluginService.getAllCommunityPlugins(req.user.id);
    res.json(plugins);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST: Instalar un plugin
router.post("/install", verifyToken, async (req, res) => {
  try {
    const { id } = req.body;
    const userId = req.user.id;
    await pluginService.installPlugin(userId, id);
    res.json({ success: true, message: "Plugin instalado correctamente" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE: Desinstalar un plugin
router.delete("/uninstall/:id", verifyToken, async (req, res) => {
  try {
    const pluginId = req.params.id;
    const userId = req.user.id;
    await pluginService.uninstallPlugin(userId, pluginId);
    res.json({ success: true, message: "Plugin desinstalado" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
