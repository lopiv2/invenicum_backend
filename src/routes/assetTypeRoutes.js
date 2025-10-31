// routes/assetTypeRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const containerService = require("../services/containerService");
const assetTypeService = require("../services/assetTypeService");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config(); // Cargar las variables de entorno

// 💡 RUTAS Y CARPETAS DE SUBIDA
// 🔑 AJUSTE CLAVE: Usamos las variables de entorno para construir la ruta física
const UPLOAD_BASE_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
const ASSET_TYPES_SUBDIR =
  process.env.UPLOAD_FOLDER_ASSET_TYPES_SUBDIR || "asset-types";

// La ruta de subida de Asset Types es: ../uploads/inventory/asset-types
const UPLOAD_DIR = path.join(
  __dirname,
  "..",
  UPLOAD_BASE_FOLDER,
  ASSET_TYPES_SUBDIR
);

// Crear el directorio si no existe
if (!fs.existsSync(UPLOAD_DIR)) {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log(`Created asset-types upload directory: ${UPLOAD_DIR}`);
  } catch (error) {
    console.error(`Error creating upload directory ${UPLOAD_DIR}:`, error);
  }
}

// Configuración de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 🔑 USAR LA RUTA AJUSTADA (uploads/inventory/asset-types)
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "asset-type-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB límite por archivo
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(
        new Error("Solo se permiten archivos de imagen (jpeg, jpg, png, gif)")
      );
    }
  },
});

// Middleware para logging (opcional)
router.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] AssetTypeRoutes - ${req.method} ${req.originalUrl}`
  );
  // Omitir el log del cuerpo en archivos grandes
  if (
    req.body &&
    Object.keys(req.body).length > 0 &&
    !req.is("multipart/form-data")
  ) {
    console.log("Body:", req.body);
  }
  next();
});

// --------------------------------------------------------------------
// C (Create) - Crear un nuevo Tipo de Activo (Anidado bajo contenedor)
// POST /containers/:containerId/asset-types
// --------------------------------------------------------------------
router.post(
  "/containers/:containerId/asset-types",
  verifyToken,
  upload.array("files"),
  async (req, res) => {
    const uploadedFiles = req.files || []; // Array de archivos subidos
    try {
      const containerId = parseInt(req.params.containerId);
      const userId = req.user.id;

      // 1. Verificación de propiedad del contenedor
      const container = await containerService.getContainerById(
        containerId,
        userId
      );
      if (!container) {
        uploadedFiles.forEach((file) => fs.unlinkSync(file.path)); // Limpiar si falla la verificación
        return res.status(404).json({
          success: false,
          message: "Contenedor no encontrado o acceso denegado.",
        });
      }

      // 2. Preparar los datos
      const assetTypeData = {
        ...req.body,
        // CORRECCIÓN: fieldDefinitions se parsea y se incluyen los archivos
        fieldDefinitions: JSON.parse(req.body.fieldDefinitions || "[]"),
        files: uploadedFiles,
      };

      // 3. Delegar la creación al servicio (el servicio maneja el resto de la lógica de URL y DB)
      const result = await assetTypeService.createAssetType(
        containerId,
        userId,
        assetTypeData
      );

      if (result.success) {
        res.status(201).json(result);
      } else {
        // Si el servicio falla, limpia los archivos subidos
        uploadedFiles.forEach((file) => fs.unlinkSync(file.path));
        res.status(400).json(result);
      }
    } catch (error) {
      // Limpiar archivos subidos en caso de error
      uploadedFiles.forEach((file) => {
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkError) {
          console.error("Error eliminando archivo temporal:", unlinkError);
        }
      });

      console.error("Error al crear Tipo de Activo:", error);
      res.status(500).json({
        success: false,
        message: "Error interno al crear el Tipo de Activo",
        error: error.message,
      });
    }
  }
);

// --------------------------------------------------------------------
// R (Read) - Obtener un único Tipo de Activo
// --------------------------------------------------------------------
router.get("/asset-types/:id", verifyToken, async (req, res) => {
  try {
    const assetTypeId = parseInt(req.params.id);
    const userId = req.user.id;

    const result = await assetTypeService.getAssetTypeById(assetTypeId, userId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error("Error al obtener Tipo de Activo:", error);
    res.status(500).json({
      success: false,
      message: "Error interno al obtener el Tipo de Activo",
      error: error.message,
    });
  }
});

// --------------------------------------------------------------------
// U (Update) - Actualizar un Tipo de Activo
// --------------------------------------------------------------------
router.patch(
  "/asset-types/:id",
  verifyToken,
  // El nombre del campo debe coincidir con el que usa Dio en el frontend (files)
  upload.array("files"),
  async (req, res) => {
    // req.files contiene los archivos subidos por Multer (nueva imagen)
    const filesToUpload = req.files || [];

    // 🔑 1. Capturar el flag booleano 'removeExistingImage'.
    // Viene como string 'true' o 'false' en FormData, por eso comparamos con 'true'.
    const removeExistingImage = req.body.removeExistingImage === "true";

    try {
      const assetTypeId = req.params.id;
      // Asegúrate de que req.user.id esté disponible por el middleware verifyToken
      const userId = req.user.id;

      // 2. Preparar los datos
      const updateData = {
        // Incluir el nombre solo si está presente
        ...(req.body.name && { name: req.body.name }),

        // Parsear las definiciones de campo, que vienen como un string JSON
        fieldDefinitions: req.body.fieldDefinitions
          ? JSON.parse(req.body.fieldDefinitions)
          : undefined,

        // Nuevos archivos subidos (para reemplazo)
        filesToUpload: filesToUpload,

        // Flag para la eliminación
        removeExistingImage: removeExistingImage,
      };

      // 3. Delegar la actualización al servicio de AssetType
      const result = await assetTypeService.updateAssetType(
        assetTypeId,
        userId,
        updateData
      );

      if (result.success) {
        // Devolver el AssetType actualizado
        res.json({ success: true, data: result.data });
      } else {
        // Si el servicio falla, limpiar los archivos subidos temporalmente
        filesToUpload.forEach((file) => fs.unlinkSync(file.path));
        res.status(400).json(result);
      }
    } catch (error) {
      // Limpiar archivos subidos en caso de error del servidor o servicio
      filesToUpload.forEach((file) => {
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkError) {
          console.error("Error eliminando archivo temporal:", unlinkError);
        }
      });

      console.error("Error al actualizar Tipo de Activo:", error);
      res.status(500).json({
        success: false,
        message: "Error interno al actualizar el Tipo de Activo",
        error: error.message,
      });
    }
  }
);

// --------------------------------------------------------------------
// D (Delete) - Eliminar todos los ítems asociados a un Tipo de Activo
// --------------------------------------------------------------------
router.delete("/asset-types/:id/assets", verifyToken, async (req, res) => {
  try {
    const assetTypeId = req.params.id;
    const userId = req.user.id;

    const result = await assetTypeService.deleteAssetTypeItems(
      assetTypeId,
      userId
    );

    if (result.success) {
      res.status(204).send();
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error("Error al eliminar elementos del Tipo de Activo:", error);
    if (error.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Error interno al eliminar los elementos del Tipo de Activo",
      error: error.message,
    });
  }
});

// --------------------------------------------------------------------
// D (Delete) - Eliminar un Tipo de Activo y sus archivos
// DELETE /asset-types/:id
// --------------------------------------------------------------------
router.delete("/asset-types/:id", verifyToken, async (req, res) => {
  try {
    const assetTypeId = req.params.id;
    const userId = req.user.id;

    // El servicio maneja la limpieza de archivos del disco y la DB
    const result = await assetTypeService.deleteAssetType(assetTypeId, userId);

    if (result.success) {
      res.status(204).send(); // 204 No Content
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error("Error al eliminar Tipo de Activo:", error);
    if (error.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Error interno al eliminar el Tipo de Activo",
      error: error.message,
    });
  }
});

module.exports = router;
