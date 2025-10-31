const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const locationService = require("../services/locationService"); // 🔑 Importamos el nuevo servicio
const containerService = require("../services/containerService"); // Necesario para verificar propiedad del contenedor

// --- Middleware para Logging (Mantenemos la convención) ---
router.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  // No loguear headers o body en producción por seguridad, pero lo mantenemos por consistencia
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("Body:", req.body);
  }
  next();
});

// =======================================================
// === RUTAS PARA UBICACIONES (LOCATIONS) ===
// =======================================================

// 1. OBTENER TODAS LAS UBICACIONES DE UN CONTENEDOR ESPECÍFICO (GET /containers/:containerId/locations)
router.get("/containers/:containerId/locations", verifyToken, async (req, res) => {
  try {
    const containerId = parseInt(req.params.containerId);
    const userId = req.user.id;

    // Verificar que el contenedor existe y pertenece al usuario (Autorización)
    const containerResult = await containerService.getContainerById(containerId, userId);
    if (!containerResult.success) {
      return res.status(404).json({ success: false, message: "Contenedor no encontrado o no autorizado." });
    }

    const locationsResult = await locationService.getLocations(containerId, userId);
    res.json(locationsResult);
    
  } catch (error) {
    console.error("Error al obtener ubicaciones:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener las ubicaciones",
      error: error.message,
    });
  }
});

// 2. CREAR UNA NUEVA UBICACIÓN (POST /locations)
router.post("/locations", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 🔑 Validación de campos requeridos
    const { container_id, name, description, parent_id } = req.body;

    if (!container_id || !name) {
      return res.status(400).json({
        success: false,
        message: "Se requiere 'container_id' y 'name' para crear una ubicación.",
      });
    }

    // Opcional: Verificar que el container_id pertenezca al usuario antes de crear
    const containerResult = await containerService.getContainerById(container_id, userId);
    if (!containerResult.success) {
      return res.status(404).json({ success: false, message: "Contenedor padre no encontrado o no autorizado." });
    }

    const locationData = {
      container_id,
      name,
      description: description || null,
      parent_id: parent_id || null, // Permite null para ubicaciones raíz
    };

    const result = await locationService.createLocation(userId, locationData);

    if (result.success) {
      // 201 Created y devuelve el objeto creado.
      res.status(201).json(result); 
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error("Error al crear ubicación:", error);
    res.status(500).json({
      success: false,
      message: "Error al crear la ubicación",
      error: error.message,
    });
  }
});

// 3. OBTENER UNA UBICACIÓN POR ID (GET /locations/:id)
router.get("/locations/:id", verifyToken, async (req, res) => {
  try {
    const locationId = parseInt(req.params.id);
    const userId = req.user.id;

    const result = await locationService.getLocationById(locationId, userId);

    if (result.success) {
      res.json(result);
    } else {
      // Ubicación no encontrada o no pertenece al usuario.
      return res.status(404).json(result); 
    }
  } catch (error) {
    console.error(`Error al obtener ubicación ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 4. ACTUALIZAR UNA UBICACIÓN (PATCH /locations/:id)
router.patch("/locations/:id", verifyToken, async (req, res) => {
  const locationId = parseInt(req.params.id);
  const userId = req.user.id;
  const updateData = req.body;

  if (!updateData || Object.keys(updateData).length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere al menos un campo para actualizar (name, description, o parent_id).',
    });
  }

  try {
    const result = await locationService.updateLocation(
      locationId,
      userId,
      updateData
    );

    if (result.success) {
      // 200 OK y devuelve el objeto actualizado.
      res.status(200).json(result);
    } else {
      // Ubicación no encontrada o no pertenece al usuario.
      res.status(404).json(result);
    }
  } catch (error) {
    console.error(`Error al actualizar ubicación ${locationId}:`, error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar la ubicación",
      error: error.message,
    });
  }
});

// 5. ELIMINAR UNA UBICACIÓN (DELETE /locations/:id)
router.delete("/locations/:id", verifyToken, async (req, res) => {
  try {
    const locationId = parseInt(req.params.id);
    const userId = req.user.id;

    await locationService.deleteLocation(locationId, userId);
    
    // 204 No Content para indicar eliminación exitosa.
    res.status(204).send(); 
  } catch (error) {
    // Manejar errores como "No autorizado" o "No encontrado"
    if (error.message.includes("no autorizado")) {
        return res.status(403).json({ success: false, message: error.message });
    }
    if (error.message.includes("no encontrado")) {
        return res.status(404).json({ success: false, message: error.message });
    }
    
    console.error(`Error al eliminar ubicación ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;