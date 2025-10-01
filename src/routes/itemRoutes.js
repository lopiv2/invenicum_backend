// routes/itemRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware"); // Asumimos que es tu middleware de autenticación
const containerService = require("../services/containerService");
const inventoryItemService = require("../services/inventoryItemService");

// Middleware de Logging (Opcional, pero útil)
router.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[ItemRoutes - ${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

// ===============================================
// RUTA DE LECTURA (READ - Filtrada)
// GET /containers/:containerId/items?assetTypeId=...
// ===============================================
router.get("/containers/:containerId/items", verifyToken, async (req, res) => {
  try {
    const containerId = parseInt(req.params.containerId);
    const assetTypeId = parseInt(req.query.assetTypeId);
    const userId = req.user.id;

    if (isNaN(containerId) || isNaN(assetTypeId)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid containerId or assetTypeId.",
        });
    }

    // 1. Verificar la pertenencia del contenedor
    const containerResult = await containerService.getContainerById(
      containerId,
      userId
    );
    if (!containerResult.success) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Container not found or access denied.",
        });
    }

    // 2. Llamar al servicio de inventario para obtener los ítems filtrados
    const itemsResult = await inventoryItemService.getItemsByContainerAndType({
      containerId,
      assetTypeId,
      userId,
    });

    // El servicio debe devolver { success: true, data: [...] }
    res.status(200).json(itemsResult);
  } catch (error) {
    console.error("Error fetching inventory items:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===============================================
// RUTA DE CREACIÓN (CREATE)
// POST /items
// ===============================================
router.post("/items", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { containerId, name } = req.body;

    if (!containerId || !name) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Container ID and name are required.",
        });
    }

    // 1. Verificar la pertenencia del contenedor ANTES de crear
    const containerResult = await containerService.getContainerById(
      containerId,
      userId
    );
    if (!containerResult.success) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Container not found or access denied.",
        });
    }

    // 2. Crear el ítem
    const itemResult = await inventoryItemService.createItem(req.body);

    // 201 Created. Devolvemos el objeto creado con su ID.
    res.status(201).json(itemResult);
  } catch (error) {
    console.error("Error creating item:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===============================================
// RUTA DE ACTUALIZACIÓN (UPDATE)
// PUT /items/:id
// ===============================================
router.put("/items/:id", verifyToken, async (req, res) => {
    let itemId; 
    
    try {
        itemId = parseInt(req.params.id); 
        const userId = req.user.id;
        // 💡 1. Extraer containerId del body
        const { containerId } = req.body; 
        
        if (isNaN(itemId) || !containerId) {
            // ... (validación de error)
        }

        // ... (Verificación de pertenencia del contenedor)

        // 🎯 2. Llamar al servicio con los 3 argumentos que espera: id, containerId, y el body completo (data)
        const updatedItem = await inventoryItemService.updateItem(
            itemId, 
            containerId, // <-- Argumento 2: containerId
            req.body     // <-- Argumento 3: data completa
        ); 
        
        if (!updatedItem) {
            return res.status(404).json({ success: false, message: "Item not found." });
        }

        res.status(200).json(updatedItem); 
        
    } catch (error) {
        console.error(`Error updating item ${itemId ? itemId : 'N/A'}:`, error); 
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===============================================
// RUTA DE BORRADO (DELETE)
// DELETE /items/:id
// ===============================================
router.delete("/items/:id", verifyToken, async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const userId = req.user.id;

    if (isNaN(itemId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid itemId." });
    }

    // El servicio de eliminación debe verificar internamente si el ítem
    // existe y pertenece a un contenedor propiedad de `userId`.
    await inventoryItemService.deleteItem(itemId, userId);

    // 204 No Content
    res.status(204).send();
  } catch (error) {
    console.error(`Error deleting item ${itemId}:`, error);
    // Podemos usar 404 si el servicio indica que el ítem no se encontró o no era del usuario
    if (error.message.includes("not found")) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
