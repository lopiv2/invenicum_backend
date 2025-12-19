// routes/itemRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware"); // Asumimos que es tu middleware de autenticación
const containerService = require("../services/containerService");
const inventoryItemService = require("../services/inventoryItemService");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const UPLOAD_DIR = path.join(__dirname, "../uploads/inventory");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  // 1. Dónde guardar el archivo
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  // 2. Cómo nombrar el archivo (usamos un timestamp para unicidad)
  filename: (req, file, cb) => {
    // Obtenemos la extensión original
    const ext = path.extname(file.originalname);
    // Creamos un nombre único (ej: item-1700000000000.jpg)
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "item-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage: storage,
  // Opcional: Limitar el tamaño de los archivos
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Middleware de Logging (Opcional, pero útil)
router.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[ItemRoutes - ${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

// ===============================================
// 🔑 NUEVA RUTA DE CLONACIÓN (CLONE)
// POST /containers/:containerId/asset-types/:assetTypeId/items/clone
// ===============================================
router.post(
  "/containers/:containerId/asset-types/:assetTypeId/items/clone",
  verifyToken, // 💡 IMPORTANTE: SIN MULTER
  async (req, res) => {
    try {
      const containerId = parseInt(req.params.containerId);
      const assetTypeId = parseInt(req.params.assetTypeId);
      const userId = req.user.id;

      // ... (Verificaciones de containerId, assetTypeId, y acceso) ...

      // 2. Preparar los datos para el servicio de clonación
      const cloneData = {
        ...req.body,
        containerId: containerId,
        assetTypeId: assetTypeId,
      };

      // 3. Llamar al nuevo servicio de clonación
      // 🔑 El servicio ya devuelve el objeto Item de Prisma directamente:
      //    const clonedItem = await inventoryItemService.cloneItem(cloneData);
      const clonedItem = await inventoryItemService.cloneItem(cloneData); 

      // 4. Devolver el ítem clonado (HTTP 201 Created)
      //    El frontend de Flutter/Dart espera que el cuerpo de la respuesta
      //    sea el objeto InventoryItem JSON plano para el fromJson.
      // 🔑 CORRECCIÓN: Devolvemos SOLO el objeto creado directamente.
      res.status(201).json(clonedItem); 
      
      
    } catch (error) {
      console.error("Error during item cloning:", error);

      if (
        error.message.includes("Invalid") ||
        error.message.includes("Cloning operation") ||
        error.message.includes("JSON format")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ===============================================
// RUTA DE CREACIÓN POR LOTES (BATCH CREATE)
// POST /containers/:containerId/asset-types/:assetTypeId/items/batch
// ===============================================
router.post(
  "/containers/:containerId/asset-types/:assetTypeId/items/batch",
  verifyToken,
  async (req, res) => {
    try {
      const containerId = parseInt(req.params.containerId);
      const assetTypeId = parseInt(req.params.assetTypeId);
      const userId = req.user.id;

      // 🔑 Los datos de la importación vienen en req.body.items
      const { items } = req.body;

      if (isNaN(containerId) || isNaN(assetTypeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid containerId or assetTypeId.",
        });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No items provided for batch import.",
        });
      }

      // 1. Verificar la pertenencia del contenedor (seguridad)
      const containerResult = await containerService.getContainerById(
        containerId,
        userId
      );
      if (!containerResult.success) {
        return res.status(404).json({
          success: false,
          message: "Container not found or access denied.",
        });
      }

      // 2. Llamar al servicio para el procesamiento masivo
      const result = await inventoryItemService.createBatchItems({
        containerId,
        assetTypeId,
        itemsData: items,
        userId, // Opcional: Puede ser útil para validaciones internas
      });

      // 201 Created. Devolvemos el resultado (que puede incluir errores de validación por fila)
      // Aunque el frontend espera `void`, es útil devolver un 201 o 200 si es exitoso.
      res.status(201).json({
        success: true,
        message: `${result.count} items created successfully.`,
        details: result.details,
      });
    } catch (error) {
      console.error("Error during batch item import:", error);
      // Devuelve 400 Bad Request si el servicio lanza un error de validación de datos
      if (
        error.message.includes("Validation failed") ||
        error.message.includes("Invalid")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ===============================================
// RUTA DE LECTURA (READ - Filtrada)
// GET /containers/:containerId/asset-types/:assetTypeId/items
// ===============================================
router.get(
  "/containers/:containerId/asset-types/:assetTypeId/items",
  verifyToken,
  async (req, res) => {
    try {
      const containerId = parseInt(req.params.containerId);
      const assetTypeId = parseInt(req.params.assetTypeId);
      const userId = req.user.id;
      const aggFiltersString = req.query.aggFilters;

      let aggregationFilters = {};
      if (aggFiltersString && typeof aggFiltersString === "string") {
        // Ejemplo: '10:Dañado,12:Rojo'
        aggregationFilters = aggFiltersString.split(",").reduce((acc, part) => {
          const [fieldId, value] = part.split(":");
          if (fieldId && value) {
            acc[fieldId.trim()] = value.trim();
          }
          return acc;
        }, {});
      }

      if (isNaN(containerId) || isNaN(assetTypeId)) {
        return res.status(400).json({
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
        return res.status(404).json({
          success: false,
          message: "Container not found or access denied.",
        });
      }

      // 2. Llamar al servicio de inventario para obtener los ítems filtrados
      const itemsResult = await inventoryItemService.getItems({
        containerId,
        assetTypeId,
        userId,
        aggregationFilters,
      });

      // El servicio debe devolver { success: true, data: {...} }
      res.status(200).json({
        success: true,
        message: "Items retrieved successfully",
        data: {
          items: itemsResult.data,
          aggregationDefinitions: itemsResult.totals.definitions,
          aggregationResults: itemsResult.totals.aggregations,
        },
      });
    } catch (error) {
      console.error("Error fetching inventory items:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ===============================================
// RUTA DE CREACIÓN (CREATE)
// POST /items
// ===============================================
router.post("/items", verifyToken, upload.array("images"), async (req, res) => {
  // IMPORTANTE: Los archivos ya han sido guardados en ./uploads/inventory en este punto.
  try {
    const userId = req.user.id;

    // Los campos de texto están en req.body; los archivos están en req.files
    const { containerId, name } = req.body;
    const uploadedFiles = req.files || []; // Array de objetos de archivo de Multer

    if (!containerId || !name) {
      // 💡 MANEJO DE ERRORES: Si falla la validación, borra los archivos que ya se subieron.
      uploadedFiles.forEach((file) => fs.unlinkSync(file.path));
      return res.status(400).json({
        success: false,
        message: "Container ID and name are required.",
      });
    }

    // 1. Verificar la pertenencia del contenedor
    const containerResult = await containerService.getContainerById(
      parseInt(containerId),
      userId
    );
    if (!containerResult.success) {
      // 💡 MANEJO DE ERRORES: Si falla la autorización, borra los archivos.
      uploadedFiles.forEach((file) => fs.unlinkSync(file.path));
      return res.status(404).json({
        success: false,
        message: "Container not found or access denied.",
      });
    }

    // 2. Crear el objeto de datos para el servicio
    const itemData = {
      ...req.body,
      // PASAMOS la información de los archivos locales al servicio.
      // El servicio usará `file.filename` para construir la URL pública.
      files: uploadedFiles,
    };

    // 3. Llamar al servicio de inventario para crear el ítem
    const itemResult = await inventoryItemService.createItem(itemData);

    // 201 Created. Devolvemos el objeto creado con su ID.
    res.status(201).json({
      success: true,
      message: "Elemento de inventario creado exitosamente",
      data: itemResult,
    });
  } catch (error) {
    // 💡 MANEJO DE ERRORES: Si ocurre un error en el servicio, borra los archivos.
    // Hay que asegurarse de que `req.files` esté disponible aquí.
    if (req.files) {
      req.files.forEach((file) => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error("Error cleaning up file:", err);
        }
      });
    }

    console.error("Error creating item:", error);
    res.status(500).json({
      success: false,
      message: "Error al crear el elemento de inventario",
      error: error.message,
    });
  }
});

// ===============================================
// RUTA DE ACTUALIZACIÓN (UPDATE)
// PUT /items/:id
// ===============================================
router.patch(
  "/items/:id",
  verifyToken,
  upload.array("images"),
  async (req, res) => {
    let itemId;
    const uploadedFiles = req.files || []; // Archivos nuevos subidos

    try {
      itemId = parseInt(req.params.id);
      const userId = req.user.id;

      // 💡 1. Extraer TODOS los datos del body (Multer los ha parseado)
      const { containerId, imageIdsToDelete } = req.body;

      if (isNaN(itemId) || !containerId) {
        // ... (Manejo de errores si falla la validación)
        uploadedFiles.forEach((file) => fs.unlinkSync(file.path)); // Limpieza
        return res.status(400).json({
          success: false,
          message: "Invalid ID or missing containerId.",
        });
      }

      // 2. Deserializar el array de IDs a eliminar
      const idsToDelete = imageIdsToDelete ? JSON.parse(imageIdsToDelete) : [];

      // 3. Crear el objeto de datos para el servicio
      const itemData = {
        ...req.body, // Incluye name, description, customFieldValues, etc.
        filesToUpload: uploadedFiles, // Archivos nuevos
        imageIdsToDelete: idsToDelete, // IDs de eliminación
      };

      // 4. Llamar al servicio con la data completa
      const updatedItem = await inventoryItemService.updateItem(
        itemId,
        itemData // Pasamos toda la data, incluyendo archivos e IDs
      );

      if (!updatedItem) {
        uploadedFiles.forEach((file) => fs.unlinkSync(file.path)); // Limpieza
        return res
          .status(404)
          .json({ success: false, message: "Item not found." });
      }

      res.status(200).json({
        success: true,
        message: "Elemento de inventario actualizado exitosamente",
        data: updatedItem,
      });
    } catch (error) {
      // Manejo de errores y limpieza de archivos
      uploadedFiles.forEach((file) => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error("Error cleaning up file:", err);
        }
      });
      console.error(`Error updating item ${itemId ? itemId : "N/A"}:`, error);
      res.status(500).json({
        success: false,
        message: "Error al actualizar el elemento de inventario",
        error: error.message,
      });
    }
  }
);

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
