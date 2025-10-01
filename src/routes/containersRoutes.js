const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const containerService = require("../services/containerService");
const inventoryItemService = require("../services/inventoryItemService");

// Middleware para logging
router.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  console.log("Headers:", req.headers);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("Body:", req.body);
  }
  next();
});

// Rutas para contenedores
router.get("/containers", verifyToken, async (req, res) => {
  try {
    // Verificamos que tenemos el ID del usuario
    if (!req.user || !req.user.id) {
      console.log("Datos del usuario en el request:", req.user);
      return res.status(401).json({
        success: false,
        message: "Usuario no autenticado correctamente",
      });
    }

    const containersResult = await containerService.getContainers(req.user.id);
    res.json(containersResult);
  } catch (error) {
    console.error("Error completo al obtener contenedores:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener los contenedores",
      error: error.message,
    });
  }
});

router.patch("/containers/:id", verifyToken, async (req, res) => {
  const containerId = parseInt(req.params.id);
  const userId = req.user.id;

  const updateData = req.body;

  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      message: "Usuario no autenticado correctamente",
    });
  }

  if (!updateData || (!updateData.name && !updateData.description)) {
    return res.status(400).json({
      success: false,
      message:
        'Se requiere al menos el campo "name" o "description" para actualizar.',
    });
  }

  try {
    const result = await containerService.updateContainer(
      containerId,
      userId,
      updateData
    );

    // Asumimos que el service devuelve { success: true, data: container }
    if (result.success) {
      // 200 OK y devuelve el objeto actualizado.
      res.status(200).json(result);
    } else {
      // El servicio devolvió success: false (ej: Contenedor no encontrado)
      res.status(404).json(result);
    }
  } catch (error) {
    console.error(`Error al actualizar contenedor ${containerId}:`, error);
    res.status(500).json({
      success: false,
      message: "Error al renombrar el contenedor",
      error: error.message,
    });
  }
});

router.post("/containers", verifyToken, async (req, res) => {
  try {
    // Verificamos que tenemos el ID del usuario
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Usuario no autenticado correctamente",
      });
    }

    // Verificamos que tenemos los datos necesarios
    if (!req.body || !req.body.name) {
      return res.status(400).json({
        success: false,
        message: "Se requiere el nombre del contenedor",
      });
    }

    const containerData = {
      name: req.body.name,
      description: req.body.description,
    };

    const result = await containerService.createContainer(
      req.user.id,
      containerData
    );

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error("Error completo al crear contenedor:", error);
    res.status(500).json({
      success: false,
      message: "Error al crear el contenedor",
      error: error.message,
    });
  }
});

router.get("/containers/:id", verifyToken, async (req, res) => {
  try {
    const result = await containerService.getContainerById(
      parseInt(req.params.id),
      req.user.id
    );

    if (result.success) {
      // El servicio devuelve { success: true, data: container }
      res.json(result);
    } else {
      // El servicio devolvió success: false (Contenedor no encontrado)
      return res.status(404).json(result);
    }
  } catch (error) {
    // ...
    res.status(500).json({ error: error.message });
  }
});

router.delete("/containers/:id", verifyToken, async (req, res) => {
  try {
    await containerService.deleteContainer(
      parseInt(req.params.id),
      req.user.id
    );
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rutas para elementos del inventario
router.get("/containers/:containerId/items", verifyToken, async (req, res) => {
  try {
    // Verificar que el contenedor pertenece al usuario
    const container = await containerService.getContainerById(
      parseInt(req.params.containerId),
      req.user.id
    );
    if (!container) {
      return res.status(404).json({ error: "Container not found" });
    }

    const items = await inventoryItemService.getItems(
      parseInt(req.params.containerId)
    );
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/containers/:containerId/items", verifyToken, async (req, res) => {
  try {
    // Verificar que el contenedor pertenece al usuario
    const container = await containerService.getContainerById(
      parseInt(req.params.containerId),
      req.user.id
    );
    if (!container) {
      return res.status(404).json({ error: "Container not found" });
    }
    const item = await inventoryItemService.createItem(
      parseInt(req.params.containerId),
      req.body
    );
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put(
  "/containers/:containerId/items/:id",
  verifyToken,
  async (req, res) => {
    try {
      // Verificar que el contenedor pertenece al usuario
      const container = await containerService.getContainerById(
        parseInt(req.params.containerId),
        req.user.id
      );
      if (!container) {
        return res.status(404).json({ error: "Container not found" });
      }

      const item = await inventoryItemService.updateItem(
        parseInt(req.params.id),
        parseInt(req.params.containerId),
        req.body
      );
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.delete(
  "/containers/:containerId/items/:id",
  verifyToken,
  async (req, res) => {
    try {
      // Verificar que el contenedor pertenece al usuario
      const container = await containerService.getContainerById(
        parseInt(req.params.containerId),
        req.user.id
      );
      if (!container) {
        return res.status(404).json({ error: "Container not found" });
      }

      await inventoryItemService.deleteItem(
        parseInt(req.params.id),
        parseInt(req.params.containerId)
      );
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.patch(
  "/containers/:containerId/items/:id/options",
  verifyToken,
  async (req, res) => {
    try {
      // Verificar que el contenedor pertenece al usuario
      const container = await containerService.getContainerById(
        parseInt(req.params.containerId),
        req.user.id
      );
      if (!container) {
        return res.status(404).json({ error: "Container not found" });
      }

      const item = await inventoryItemService.updateItemOptions(
        parseInt(req.params.id),
        parseInt(req.params.containerId),
        req.body
      );
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

module.exports = router;
