// routes/assetTypeRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");
const containerService = require("../services/containerService");
const assetTypeService = require("../services/assetTypeService");
const fs = require("fs");
require("dotenv").config(); // Cargar las variables de entorno
const { Temporal } = require('@js-temporal/polyfill');

// Middleware for logging (opcional)
router.use((req, res, next) => {
  const timestamp = Temporal.Now.plainDateISO().toString();
  console.log(
    `[${timestamp}] AssetTypeRoutes - ${req.method} ${req.originalUrl}`
  );
  // Omitir the log del body en archivos grandes
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
// C (Create) - Create a new Tipo de Activo (Anidado bajo container)
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

      // 1. Verificación de propiedad del container
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
      const isSerialized = req.body.isSerialized === "true";

      // 2. Preparar the data
      const assetTypeData = {
        ...req.body,
        isSerialized: isSerialized,
        // CORRECCIÓN: fieldDefinitions se parsea and se incluyen the archivos
        fieldDefinitions: JSON.parse(req.body.fieldDefinitions || "[]"),
        files: uploadedFiles,
      };

      // 3. Delegar the Createción al service (the service maneja the resto de the lógica de URL and DB)
      const result = await assetTypeService.createAssetType(
        containerId,
        userId,
        assetTypeData
      );

      if (result.success) {
        res.status(201).json(result);
      } else {
        // if the service fails, limpia the archivos subidos
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
// R (Read) - get a único Tipo de Activo
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
// U (Update) - update a Tipo de Activo
// --------------------------------------------------------------------
router.patch(
  "/asset-types/:id",
  verifyToken,
  upload.array("files"),
  async (req, res) => {
    // req.files contiene the archivos subidos por Multer (new imagen)
    const filesToUpload = req.files || [];

    // 🔑 1. Capturar the flag booleano 'removeExistingImage'.
    // Viene como string 'true' o 'false' en FormData, por eso comparamos with 'true'.
    const removeExistingImage = req.body.removeExistingImage === "true";

    try {
      const assetTypeId = req.params.id;
      // Make sure req.use.id esté disponible por the middleware verifyToken
      const userId = req.user.id;

      // 2. Preparar the data
      const updateData = {
        // Incluir the nombre only if está presente
        ...(req.body.name && { name: req.body.name }),

        // 🔑 new: Incluir isSerialized and quantity if están definidos
        // isSerialized se convierte a booleano. Viene como string 'true'/'false'
        ...(req.body.isSerialized !== undefined && {
          isSerialized: req.body.isSerialized === "true",
        }),

        // quantity se parsea a entero if existe
        ...(req.body.quantity !== undefined && {
          quantity: parseInt(req.body.quantity, 10),
        }),

        // Parsear the definiciones de campo, que vienen como a string JSON
        fieldDefinitions: req.body.fieldDefinitions
          ? JSON.parse(req.body.fieldDefinitions)
          : undefined,

        // Nuevos archivos subidos (for reemplazo)
        filesToUpload: filesToUpload,

        // Flag for the eliminación
        removeExistingImage: removeExistingImage,
      };

      // 3. Delegar the actualización al service de AssetType
      const result = await assetTypeService.updateAssetType(
        assetTypeId,
        userId,
        updateData
      );

      if (result.success) {
        // Devolver the AssetType actualizado
        res.json({ success: true, data: result.data });
      } else {
        // if the service fails, limpiar the archivos subidos temporalmente
        filesToUpload.forEach((file) => fs.unlinkSync(file.path));
        res.status(400).json(result);
      }
    } catch (error) {
      // Limpiar archivos subidos en caso de error del server o service
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

// 🎯 new route: update only the campos de colección de a AssetType
// PATCH /asset-types/:id/collection-fields
// Esto permite update possessionFieldId and desiredFieldId without necesidad de multipart/form-data
router.patch("/asset-types/:id/collection-fields", verifyToken, async (req, res) => {
  try {
    const assetTypeId = req.params.id;
    const userId = req.user.id;
    const { possessionFieldId, desiredFieldId } = req.body;

    if (!assetTypeId) {
      return res.status(400).json({
        success: false,
        message: "Se requiere el ID del tipo de activo.",
      });
    }

    const result = await assetTypeService.updateAssetTypeCollectionFields(
      assetTypeId,
      userId,
      { possessionFieldId, desiredFieldId }
    );

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error(
      "Error al actualizar campos de colección del Tipo de Activo:",
      error
    );
    res.status(500).json({
      success: false,
      message:
        "Error interno al actualizar los campos de colección del Tipo de Activo",
      error: error.message,
    });
  }
});

// --------------------------------------------------------------------
// D (Delete) - delete todos the ítems asociados a a Tipo de Activo
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
// D (Delete) - delete a Tipo de Activo and sus archivos
// DELETE /asset-types/:id
// --------------------------------------------------------------------
router.delete("/asset-types/:id", verifyToken, async (req, res) => {
  try {
    const assetTypeId = req.params.id;
    const userId = req.user.id;

    // the service maneja the limpieza de archivos del disk and the DB
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
