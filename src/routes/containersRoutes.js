const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const containerService = require("../services/containerService");
const inventoryItemService = require("../services/inventoryItemService");
const { Temporal } = require('@js-temporal/polyfill');

// Middleware for logging
router.use((req, res, next) => {
  const timestamp = Temporal.Now.plainDateISO().toString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  console.log("Headers:", req.headers);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("Body:", req.body);
  }
  next();
});

// ROUTES for containers
router.get("/containers", verifyToken, async (req, res) => {
  try {
    // We verify that the user is authenticated and we have their ID
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated correctly",
      });
    }

    const containersResult = await containerService.getContainers(req.user.id);
    res.json(containersResult);
  } catch (error) {
    console.error("Error getting containers:", error);
    res.status(500).json({
      success: false,
      message: "Error getting containers",
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
      message: "User not authenticated correctly",
    });
  }

  if (!updateData || (!updateData.name && !updateData.description)) {
    return res.status(400).json({
      success: false,
      message:
        'At least the "name" or "description" field is required to update.',
    });
  }

  try {
    const result = await containerService.updateContainer(
      containerId,
      userId,
      updateData,
    );

    // We assume that the service returns { success: true, data: container }
    if (result.success) {
      // 200 OK and returns the updated object.
      res.status(200).json(result);
    } else {
      // The service returned success: false (e.g., container not found or not belonging to the user).  
      res.status(404).json(result);
    }
  } catch (error) {
    console.error(`Error updating container ${containerId}:`, error);
    res.status(500).json({
      success: false,
      message: "Error updating container",
      error: error.message,
    });
  }
});

// Global asset search
router.get("/search/assets", verifyToken, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res
        .status(400)
        .json({ success: false, message: "Query parameter 'q' is required" });
    }

    const result = await containerService.searchAssets(req.user.id, query);

    if (result.success) {
      res.json(result); // The helper _extractData in Flutter will look for result.data
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/containers", verifyToken, async (req, res) => {
  try {
    // We verify que tenemos the ID del use
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated correctly",
      });
    }

    // We verify that we have the necessary data (at least the name)
    if (!req.body || !req.body.name) {
      return res.status(400).json({
        success: false,
        message: "Container name is required",
      });
    }

    const containerData = {
      name: req.body.name,
      description: req.body.description || null,
      isCollection: req.body.isCollection || false,
    };

    const result = await containerService.createContainer(
      req.user.id,
      containerData,
    );

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error("Error creating container:", error);
    res.status(500).json({
      success: false,
      message: "Error creating container",
      error: error.message,
    });
  }
});

router.get("/containers/:id", verifyToken, async (req, res) => {
  try {
    const result = await containerService.getContainerById(
      parseInt(req.params.id),
      req.user.id,
    );

    if (result.success) {
      // The service returns { success: true, data: container }
      res.json(result);
    } else {
      // The service returned success: false (e.g., container not found or not belonging to the user)
      return res.status(404).json(result);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/containers/:id", verifyToken, async (req, res) => {
  try {
    await containerService.deleteContainer(
      parseInt(req.params.id),
      req.user.id,
    );
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ROUTES for inventory items
router.get("/containers/:containerId/items", verifyToken, async (req, res) => {
  try {
    // Verify that the container belongs to the user
    const container = await containerService.getContainerById(
      parseInt(req.params.containerId),
      req.user.id,
    );
    if (!container) {
      return res.status(404).json({ error: "Container not found" });
    }

    const items = await inventoryItemService.getItems(
      parseInt(req.params.containerId),
    );
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/containers/:containerId/items", verifyToken, async (req, res) => {
  try {
    // Verify that the container belongs to the user
    const container = await containerService.getContainerById(
      parseInt(req.params.containerId),
      req.user.id,
    );
    if (!container) {
      return res.status(404).json({ error: "Container not found" });
    }
    const item = await inventoryItemService.createItem(
      parseInt(req.params.containerId),
      req.body,
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
      // Verify that the container belongs to the user
      const container = await containerService.getContainerById(
        parseInt(req.params.containerId),
        req.user.id,
      );
      if (!container) {
        return res.status(404).json({ error: "Container not found" });
      }

      const item = await inventoryItemService.updateItem(
        parseInt(req.params.id),
        parseInt(req.params.containerId),
        req.body,
      );
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

router.delete(
  "/containers/:containerId/items/:id",
  verifyToken,
  async (req, res) => {
    try {
      // Verify that the container belongs to the user
      const container = await containerService.getContainerById(
        parseInt(req.params.containerId),
        req.user.id,
      );
      if (!container) {
        return res.status(404).json({ error: "Container not found" });
      }

      await inventoryItemService.deleteItem(
        parseInt(req.params.id),
        parseInt(req.params.containerId),
      );
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

router.patch(
  "/containers/:containerId/items/:id/options",
  verifyToken,
  async (req, res) => {
    try {
      // Verify that the container belongs to the user
      const container = await containerService.getContainerById(
        parseInt(req.params.containerId),
        req.user.id,
      );
      if (!container) {
        return res.status(404).json({ error: "Container not found" });
      }

      const item = await inventoryItemService.updateItemOptions(
        parseInt(req.params.id),
        parseInt(req.params.containerId),
        req.body,
      );
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

module.exports = router;
