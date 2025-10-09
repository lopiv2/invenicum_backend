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
// RUTA DE LECTURA (READ - Filtrada)
// GET /containers/:containerId/items?assetTypeId=...
// ===============================================
router.get("/containers/:containerId/items", verifyToken, async (req, res) => {
  try {
    const containerId = parseInt(req.params.containerId);
    const assetTypeId = parseInt(req.query.assetTypeId);
    const userId = req.user.id;

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
    res.status(201).json(itemResult);
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
    res.status(500).json({ success: false, error: error.message });
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

      res.status(200).json(updatedItem);
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
      res.status(500).json({ success: false, error: error.message });
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
