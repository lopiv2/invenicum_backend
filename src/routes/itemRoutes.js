// routes/itemRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware"); // Asumimos que es tu middleware de autenticación
const containerService = require("../services/containerService");
const inventoryItemService = require("../services/inventoryItemService");
const multer = require("multer");
const path = require("path");
const { Temporal } = require('@js-temporal/polyfill');
const fs = require("fs");
const prisma = require("../middleware/prisma");
// getPublicUrl: fuente de verdad única for construir URLs de imágenes,
// igual que en assetTypeService. Evita the bug __dirname vs process.cwd().
const { getPublicUrl } = require("../middleware/upload");

// use process.cwd() (igual que upload.js) so that the route de Createción
// de directorio and the de guardado de Multer coincidan siempre.
const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_FOLDER || "uploads/inventory", "items");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Temporal.Now.instant().epochMilliseconds + "-" + Math.round(Math.random() * 1e9);
    cb(null, "item-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Middleware de Logging (Opcional, pero útil)
router.use((req, res, next) => {
  const timestamp = Temporal.Now.plainDateISO().toString();
  console.log(`[ItemRoutes - ${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

// ===============================================
// 🖨️ update deseado o no
// PATCH /items/:id/wishlist
// ===============================================
router.patch("/:id/wishlist", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { wishlisted } = req.body;
    
    await inventoryItemService.updateWishlist(id, wishlisted);
    
    res.status(200).json({ success: true, message: "Wishlist updated" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===============================================
// 🖨️ GENERACIÓN DE ETIQUETA QR for IMPRESIÓN
// GET /items/:id/print-label
// ===============================================
router.get("/items/:id/print-label", verifyToken, async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const userId = req.user.id;

    // 1. Capturamos the dimensiones from the query string
    // Ejemplo: /print-label?width=25&height=15
    const queryOptions = {
      width: req.query.width,
      height: req.query.height,
    };

    if (isNaN(itemId)) {
      return res
        .status(400)
        .json({ success: false, message: "ID de ítem inválido." });
    }

    // 2. Pasamos the queryOptions al service
    await inventoryItemService.generatePrintLabelPDF(
      itemId,
      userId,
      res,
      queryOptions,
      req,
    );
  } catch (error) {
    console.error(
      `Error generando etiqueta para ítem ${req.params.id}:`,
      error,
    );

    if (
      error.message.includes("not found") ||
      error.message.includes("denegado")
    ) {
      return res.status(404).json({ success: false, message: error.message });
    }

    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// ===============================================
// 🔑 new route DE CLONACIÓN (CLONE)
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

      // ... (Verificaciones de containerId, assetTypeId, and acceso) ...

      // 2. Preparar the data for the service de clonación
      const cloneData = {
        ...req.body,
        containerId: containerId,
        assetTypeId: assetTypeId,
      };

      // 3. Llamar al new service de clonación
      // 🔑 the service ya returns the objeto Item de Prisma directamente:
      //    const clonedItem = await inventoryItemService.cloneItem(cloneData);
      const clonedItem = await inventoryItemService.cloneItem(cloneData);

      // 4. Devolver the ítem clonado (HTTP 201 Createted)
      //    the frontend de Flutter/Dart espera que the body de the Response
      //    sea the objeto InventoryItem JSON plano for the fromJson.
      // 🔑 CORRECCIÓN: Devolvemos only the objeto created directamente.
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
  },
);

// ===============================================
// route DE CreateCION POR LOTES
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

      // 🔑 the data de the Importción vienen en req.body.items
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

      // 1. Verify the pertenencia del container (security)
      const containerResult = await containerService.getContainerById(
        containerId,
        userId,
      );
      if (!containerResult.success) {
        return res.status(404).json({
          success: false,
          message: "Container not found or access denied.",
        });
      }

      // 2. Llamar al service for the procesamiento masivo
      const result = await inventoryItemService.createBatchItems({
        containerId,
        assetTypeId,
        itemsData: items,
        userId, // Opcional: Puede ser útil para validaciones internas
      });

      // 201 Createted. Devolvemos the resultado (que puede incluir errores de validación por fila)
      // Aunque the frontend espera `void`, es útil devolver a 201 o 200 if es exitoso.
      res.status(201).json({
        success: true,
        message: `${result.count} items created successfully.`,
        assetType: result.assetType,
        details: result.details,
      });
    } catch (error) {
      console.error("Error during batch item import:", error);
      // returns 400 Bad Request if the service lanza a error de validación de data
      if (
        error.message.includes("Validation failed") ||
        error.message.includes("Invalid")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  },
);

// --- NEW GLOBAL ROUTE FOR DASHBOARD ---
router.get("/items", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id; // Obtenido del token por verifyToken

    // 💡 Aquí we call a a new método en tu service que traiga todo
    // without filtrar por container o tipo.
    const result = await inventoryItemService.getAllItemsForUser(userId);

    res.status(200).json({
      success: true,
      data: result, // El formato que espera tu InventoryResponse.fromJson
    });
  } catch (error) {
    console.error("Error en ruta global de items:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ===============================================
// READ ROUTE (Filtrada)
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

      // 1. Validar IDs
      if (isNaN(containerId) || isNaN(assetTypeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid containerId or assetTypeId.",
        });
      }

      // 2. Parsear filtros de agregación (Custom Fields)
      let aggregationFilters = {};
      if (aggFiltersString && typeof aggFiltersString === "string") {
        aggregationFilters = aggFiltersString.split(",").reduce((acc, part) => {
          const [fieldId, value] = part.split(":");
          if (fieldId && value) {
            acc[fieldId.trim()] = value.trim();
          }
          return acc;
        }, {});
      }

      // 3. Verify pertenencia del container (security)
      const containerResult = await containerService.getContainerById(
        containerId,
        userId,
      );

      if (!containerResult.success) {
        return res.status(404).json({
          success: false,
          message: "Container not found or access denied.",
        });
      }

      // 4. Llamar al service
      // Recordatorio: the service returns { success, items, totals }
      const itemsResult = await inventoryItemService.getItems({
        containerId,
        assetTypeId,
        userId,
        aggregationFilters,
      });
      // 5. Response (Corregida for evitar errores de undefined)
      // Ajustamos the Mapping so that Flutter reciba exactamente lo que espera
      res.status(200).json({
        success: true,
        message: "Items retrieved successfully",
        data: {
          items: itemsResult.items, // 👈 Antes era itemsResult.data
          aggregationDefinitions: itemsResult.totals.definitions, // 👈 Ahora existe porque itemsResult.totals no es undefined
          aggregationResults: itemsResult.totals.aggregations,
          marketValueTotal: itemsResult.totals.marketValueTotal, // Añadido para el dashboard
        },
      });
    } catch (error) {
      console.error("Error fetching inventory items:", error);
      res.status(500).json({
        success: false,
        message: "Error interno al obtener los ítems",
        error: error.message,
      });
    }
  },
);

// ===============================================
// route DE CreateCION
// POST /items
// ===============================================
router.post("/items", verifyToken, upload.array("images"), async (req, res) => {
  const uploadedFiles = req.files || [];

  try {
    const userId = req.user.id;
    console.log("[POST /items] payload resumen:", {
      contentType: req.headers["content-type"],
      bodyKeys: Object.keys(req.body || {}),
      marketValue: req.body?.marketValue,
      market_value: req.body?.market_value,
      filesCount: uploadedFiles.length,
      userId,
    });
    // 🔑 Ya no desestructuramos containerId and name aquí for validar,
    // dejamos que the service o the flujo de data lo maneje,
    // o validamos de forma que no choque with the new Mapping automático.
    const { containerId } = req.body;

    if (!containerId) {
      uploadedFiles.forEach((file) => fs.unlinkSync(file.path));
      return res.status(400).json({
        success: false,
        message: "Container ID is required.",
      });
    }

    // 1. Verify the pertenencia del container (Lógica de security)
    const containerResult = await containerService.getContainerById(
      parseInt(containerId),
      userId,
    );

    if (!containerResult.success) {
      uploadedFiles.forEach((file) => fs.unlinkSync(file.path));
      return res.status(404).json({
        success: false,
        message: "Container not found or access denied.",
      });
    }

    // 2. Preparar the objeto de data
    // 🔑 Important: Pasamos req.body tal cual.
    // the service Userá the operador spread (...) for capturar barcode, marketValue, etc.
    const itemData = {
      ...req.body,
      files: uploadedFiles,
    };

    // 3. Llamar al service
    // 🔑 the itemResult ya vendrá formateado por the InventoryItemDTO.toJSON()
    const itemResult = await inventoryItemService.createItem(itemData);

    // 4. Response exitosa
    // 🔑 Nota que ya no envolvemos en 'data: itemResult' if the DTO ya returns
    // the estructura que prefieres, o mantenemos the consistencia de tu API:
    res.status(201).json({
      success: true,
      message: "Elemento de inventario creado exitosamente",
      data: itemResult, // itemResult ya es el JSON limpio del DTO
    });
  } catch (error) {
    // Manejo de errores and limpieza de archivos
    if (uploadedFiles.length > 0) {
      uploadedFiles.forEach((file) => {
        try {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (err) {
          console.error("Error cleaning up file:", err);
        }
      });
    }

    console.error("Error creating item:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error al crear el elemento de inventario",
    });
  }
});

// ===============================================
// route DE ACTUALIZACIÓN (UPDATE)
// PUT /items/:id
// ===============================================
router.patch(
  "/items/:id",
  verifyToken,
  upload.array("images"),
  async (req, res) => {
    const uploadedFiles = req.files || [];
    const itemId = req.params.id;

    try {
      const userId = req.user.id;
      console.log("[PATCH /items/:id] payload resumen:", {
        itemId,
        contentType: req.headers["content-type"],
        bodyKeys: Object.keys(req.body || {}),
        marketValue: req.body?.marketValue,
        market_value: req.body?.market_value,
        filesCount: uploadedFiles.length,
        userId,
      });

      // 1. EXTRAER and PRE-VALIDAR
      // Extraemos containerId e imageIdsToDelete for tratarlos específicamente
      // 'restOfBody' contendrá name, description, barcode, marketValue, etc.
      const { containerId, imageIdsToDelete, ...restOfBody } = req.body;

      if (!itemId || !containerId) {
        // if falta información vital, borramos lo que Multer guardó físicamente
        uploadedFiles.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
        return res.status(400).json({
          success: false,
          message: "El ID del ítem y el ID del contenedor son obligatorios.",
        });
      }

      // 2. VERIFICACIÓN DE security
      // Validamos que the container realmente pertenezca al Use autenticado
      const containerResult = await containerService.getContainerById(
        parseInt(containerId),
        userId,
      );

      if (!containerResult.success) {
        uploadedFiles.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
        return res.status(404).json({
          success: false,
          message: "Contenedor no encontrado o acceso denegado.",
        });
      }

      // 3. PREPARAR OBJETO for the service
      const itemData = {
        ...restOfBody,
        containerId: containerId, // Lo pasamos explícitamente
        filesToUpload: uploadedFiles, // Archivos nuevos desde req.files
        // Convertimos the string JSON de IDs a borrar en a array real de JS
        imageIdsToDelete: imageIdsToDelete ? JSON.parse(imageIdsToDelete) : [],
      };

      // 4. call AL service
      // the service se encarga de:
      // - Parsear números (quantity, marketValue)
      // - Borrar imágenes viejas (disk and DB)
      // - Guardar imágenes nuevas
      // - Retornar the InventoryItemDTO.toJSON()
      const updatedItem = await inventoryItemService.updateItem(
        itemId,
        itemData,
        userId,
      );

      // 5. Response EXITOSA
      res.status(200).json({
        success: true,
        message: "Elemento de inventario actualizado exitosamente",
        data: updatedItem, // Objeto procesado y formateado por el DTO
      });
    } catch (error) {
      // 6. MANEJO DE ERRORES and LIMPIEZA
      // if algo fails en the process, no queremos dejar archivos huérfanos en the disk
      if (uploadedFiles.length > 0) {
        uploadedFiles.forEach((file) => {
          try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } catch (err) {
            console.error("Error al limpiar archivo tras error en PATCH:", err);
          }
        });
      }

      console.error(`Error crítico actualizando ítem ${itemId}:`, error);

      res.status(500).json({
        success: false,
        message: error.message || "Error interno al actualizar el elemento",
      });
    }
  },
);

// ===============================================
// route DE BORRADO (DELETE)
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

    // the service de eliminación must Verify internamente if the ítem
    // existe and pertenece a a container propiedad de `userId`.
    await inventoryItemService.deleteItem(itemId, userId);

    // 204 No Content
    res.status(204).send();
  } catch (error) {
    console.error(`Error deleting item ${itemId}:`, error);
    // Podemos Use 404 if the service indica que the ítem no se encontró o no era del Use
    if (error.message.includes("not found")) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===============================================
// history DE PRECIOS
// GET /items/:id/price-history
// ===============================================
router.get("/items/:id/price-history", verifyToken, async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const userId = req.user.id;

    if (isNaN(itemId)) {
      return res.status(400).json({
        success: false,
        message: "ID de ítem inválido.",
      });
    }

    // we call al método que ya tienes en the service
    const history = await inventoryItemService.getItemPriceHistory(
      itemId,
      userId,
    );

    res.status(200).json(history);
  } catch (error) {
    console.error(
      `Error obteniendo historial para ítem ${req.params.id}:`,
      error,
    );

    if (
      error.message.includes("no encontrado") ||
      error.message.includes("denegado")
    ) {
      return res.status(404).json({ success: false, message: error.message });
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

// ===============================================
// 📊 get VALOR DE MERCADO TOTAL DEL Use
// GET /items/total-market-value
// ===============================================
router.get("/total-market-value", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id; // Extraído del token de autenticación

    // we call a the función del service que Create antes
    const totalValue = await inventoryItemService.getTotalMarketValue(userId);

    res.status(200).json({
      success: true,
      totalMarketValue: totalValue,
    });
  } catch (error) {
    console.error("Error obteniendo el valor total de mercado:", error);
    res.status(500).json({
      success: false,
      message: "Error al calcular el valor total de mercado",
      error: error.message,
    });
  }
});

// ===============================================
// VERIFICACIÓN DE CANTIDAD
// GET /verify-quantity/:assetTypeId/:quantity
// ===============================================
router.get(
  "/verify-quantity/:assetTypeId/:quantity",
  verifyToken,
  async (req, res) => {
    try {
      const { assetTypeId, quantity } = req.params;
      const assetTypeIdInt = parseInt(assetTypeId);
      const quantityInt = parseInt(quantity);

      // get the AssetType
      const assetType = await prisma.$queryRaw`
        SELECT id, name, is_serialized
        FROM asset_type
        WHERE id = ${assetTypeIdInt}
      `;

      if (!assetType || assetType.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Asset Type not found" });
      }

      const { is_serialized } = assetType[0];
      let finalQuantity;

      if (is_serialized) {
        finalQuantity = 1;
      } else {
        finalQuantity = isNaN(quantityInt) || quantityInt < 1 ? 1 : quantityInt;
      }

      res.status(200).json({
        success: true,
        assetTypeId: assetTypeIdInt,
        isSerialized: is_serialized,
        inputQuantity: quantityInt,
        finalQuantity: finalQuantity,
        message: is_serialized
          ? "This asset type is serialized. Quantity will be stored as 1."
          : `This asset type is not serialized. Quantity will be stored as ${finalQuantity}.`,
      });
    } catch (error) {
      console.error("Error verifying quantity:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
);

module.exports = router;
