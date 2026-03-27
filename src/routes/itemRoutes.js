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
// getPublicUrl: fuente de verdad única para construir URLs de imágenes,
// igual que en assetTypeService. Evita el bug __dirname vs process.cwd().
const { getPublicUrl } = require("../middleware/upload");

// Usamos process.cwd() (igual que upload.js) para que la ruta de creación
// de directorio y la de guardado de Multer coincidan siempre.
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
// 🖨️ Actualizar deseado o no
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
// 🖨️ GENERACIÓN DE ETIQUETA QR PARA IMPRESIÓN
// GET /items/:id/print-label
// ===============================================
router.get("/items/:id/print-label", verifyToken, async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const userId = req.user.id;

    // 1. Capturamos las dimensiones desde el query string
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

    // 2. Pasamos las queryOptions al servicio
    await inventoryItemService.generatePrintLabelPDF(
      itemId,
      userId,
      res,
      queryOptions,
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
  },
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
        userId,
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
  },
);

// --- NUEVA RUTA GLOBAL PARA EL DASHBOARD ---
router.get("/items", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id; // Obtenido del token por verifyToken

    // 💡 Aquí llamamos a un nuevo método en tu servicio que traiga todo
    // sin filtrar por contenedor o tipo.
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

      // 3. Verificar pertenencia del contenedor (Seguridad)
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

      // 4. Llamar al servicio
      // Recordatorio: El servicio devuelve { success, items, totals }
      const itemsResult = await inventoryItemService.getItems({
        containerId,
        assetTypeId,
        userId,
        aggregationFilters,
      });
      // 5. RESPUESTA (Corregida para evitar errores de undefined)
      // Ajustamos el mapeo para que Flutter reciba exactamente lo que espera
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
// RUTA DE CREACIÓN (CREATE)
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
    // 🔑 Ya no desestructuramos containerId y name aquí para validar,
    // dejamos que el servicio o el flujo de datos lo maneje,
    // o validamos de forma que no choque con el nuevo mapeo automático.
    const { containerId } = req.body;

    if (!containerId) {
      uploadedFiles.forEach((file) => fs.unlinkSync(file.path));
      return res.status(400).json({
        success: false,
        message: "Container ID is required.",
      });
    }

    // 1. Verificar la pertenencia del contenedor (Lógica de seguridad)
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

    // 2. Preparar el objeto de datos
    // 🔑 IMPORTANTE: Pasamos req.body tal cual.
    // El servicio usará el operador spread (...) para capturar barcode, marketValue, etc.
    const itemData = {
      ...req.body,
      files: uploadedFiles,
    };

    // 3. Llamar al servicio
    // 🔑 El itemResult ya vendrá formateado por el InventoryItemDTO.toJSON()
    const itemResult = await inventoryItemService.createItem(itemData);

    // 4. Respuesta exitosa
    // 🔑 Nota que ya no envolvemos en 'data: itemResult' si el DTO ya devuelve
    // la estructura que prefieres, o mantenemos la consistencia de tu API:
    res.status(201).json({
      success: true,
      message: "Elemento de inventario creado exitosamente",
      data: itemResult, // itemResult ya es el JSON limpio del DTO
    });
  } catch (error) {
    // Manejo de errores y limpieza de archivos
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
// RUTA DE ACTUALIZACIÓN (UPDATE)
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

      // 1. EXTRAER Y PRE-VALIDAR
      // Extraemos containerId e imageIdsToDelete para tratarlos específicamente
      // 'restOfBody' contendrá name, description, barcode, marketValue, etc.
      const { containerId, imageIdsToDelete, ...restOfBody } = req.body;

      if (!itemId || !containerId) {
        // Si falta información vital, borramos lo que Multer guardó físicamente
        uploadedFiles.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
        return res.status(400).json({
          success: false,
          message: "El ID del ítem y el ID del contenedor son obligatorios.",
        });
      }

      // 2. VERIFICACIÓN DE SEGURIDAD
      // Validamos que el contenedor realmente pertenezca al usuario autenticado
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

      // 3. PREPARAR OBJETO PARA EL SERVICIO
      const itemData = {
        ...restOfBody,
        containerId: containerId, // Lo pasamos explícitamente
        filesToUpload: uploadedFiles, // Archivos nuevos desde req.files
        // Convertimos el string JSON de IDs a borrar en un array real de JS
        imageIdsToDelete: imageIdsToDelete ? JSON.parse(imageIdsToDelete) : [],
      };

      // 4. LLAMADA AL SERVICIO
      // El servicio se encarga de:
      // - Parsear números (quantity, marketValue)
      // - Borrar imágenes viejas (disco y DB)
      // - Guardar imágenes nuevas
      // - Retornar el InventoryItemDTO.toJSON()
      const updatedItem = await inventoryItemService.updateItem(
        itemId,
        itemData,
        userId,
      );

      // 5. RESPUESTA EXITOSA
      res.status(200).json({
        success: true,
        message: "Elemento de inventario actualizado exitosamente",
        data: updatedItem, // Objeto procesado y formateado por el DTO
      });
    } catch (error) {
      // 6. MANEJO DE ERRORES Y LIMPIEZA
      // Si algo falla en el proceso, no queremos dejar archivos huérfanos en el disco
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

// ===============================================
// HISTORIAL DE PRECIOS
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

    // Llamamos al método que ya tienes en el servicio
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
// 📊 OBTENER VALOR DE MERCADO TOTAL DEL USUARIO
// GET /items/total-market-value
// ===============================================
router.get("/total-market-value", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id; // Extraído del token de autenticación

    // Llamamos a la función del servicio que creamos antes
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

      // Obtener el AssetType
      const assetType = await require("@prisma/client").PrismaClient()
        .$queryRaw`SELECT id, name, is_serialized FROM asset_type WHERE id = ${assetTypeIdInt}`;

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