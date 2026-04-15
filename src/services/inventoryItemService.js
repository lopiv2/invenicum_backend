const prisma = require("../middleware/prisma");
const InventoryItemDTO = require("../models/inventoryItemModel");
const upcService = require("../services/upcService");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
const alertService = require("./alertService");
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const { Temporal } = require("@js-temporal/polyfill");
const { AppConstants } = require("../config/appConstants");

// Use process.cwd() to match exactly with upload.js (which also uses process.cwd()).
// If we used __dirname and the server started from another directory, the files
// would be saved in one place and searched in another when deleting them → ENOENT.
const UPLOAD_DIR_ABSOLUTE = path.resolve(
  process.cwd(),
  process.env.UPLOAD_FOLDER || "uploads/inventory",
);

// getPublicUrl: converts Multer's file.path to the correct public URL.
const { getPublicUrl } = require("../middleware/upload");

class InventoryItemService {
  parseNumericInput(value, fallback = 0) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "number") return Number.isFinite(value) ? value : fallback;

    let str = String(value).trim();
    // Clean monetary symbols and accidental text
    str = str.replace(/[^\d,.-]/g, "");

    const lastComma = str.lastIndexOf(",");
    const lastDot = str.lastIndexOf(".");

    // If both exist, the rightmost separator is considered decimal
    if (lastComma !== -1 && lastDot !== -1) {
      if (lastComma > lastDot) {
        str = str.replace(/\./g, "").replace(",", ".");
      } else {
        str = str.replace(/,/g, "");
      }
    } else if (lastComma !== -1) {
      // Only comma: use it as decimal
      str = str.replace(",", ".");
    }

    const parsed = parseFloat(str);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async createItem(data) {
    const files = data.files || [];

    // 1. DYNAMIC DESTRUCTURING
    // Extract what requires special logic and leave the rest in 'restOfData'
    const {
      containerId,
      assetTypeId,
      locationId,
      customFieldValues,
      files: _,
      barcode,
      serialNumber,
      // Excluimos campos que Prisma no reconoce o que manejamos manualmente
      id: _id,
      images: _images,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      totalMarketValue: _tmv,
      isLowStock: _isLowStock,
      imageUrl: _imageUrl,
      location: _location,
      priceHistory: _ph,
      ...restOfData
    } = data;

    // Explicitly extract and parse marketValue (it may come as a string from form-data)
    // isDraft is a field from DraftItemDTO that Prisma does not know → we exclude it
    const {
      marketValue: _rawMarketValue,
      market_value: _rawMarketValueSnake,
      isDraft: _isDraft,
      ...cleanRestOfData
    } = restOfData;
    const marketValue = this.parseNumericInput(
      _rawMarketValue ?? _rawMarketValueSnake,
      0,
    );

    // 2. PARSING IDs and ASSET TYPE VALIDATION
    const cId = parseInt(containerId);
    const aTId = parseInt(assetTypeId);
    const lId = parseInt(locationId);

    if (isNaN(cId) || isNaN(aTId) || isNaN(lId)) {
      files.forEach((f) => fs.unlinkSync(f.path));
      throw new Error("Invalid Container, Asset Type or Location ID.");
    }

    const assetType = await prisma.assetType.findUnique({
      where: { id: aTId },
    });
    if (!assetType) {
      files.forEach((f) => fs.unlinkSync(f.path));
      throw new Error("Asset Type not found.");
    }

    // 3. BUSINESS LOGIC (Quantity, MinStock and CustomFields)
    const quantityInput = parseInt(cleanRestOfData.quantity) || 1;
    const quantity = assetType.isSerialized
      ? 1
      : quantityInput > 0
        ? quantityInput
        : 1;

    const minStock = parseInt(cleanRestOfData.minStock) || 0;
    const finalBarcode =
      barcode && barcode.toString().trim() !== "" && barcode !== "null"
        ? barcode.toString().trim()
        : null;

    const finalSerialNumber =
      serialNumber &&
      serialNumber.toString().trim() !== "" &&
      serialNumber !== "null"
        ? serialNumber.toString().trim()
        : null;

    let parsedCustomFields = {};
    try {
      parsedCustomFields =
        typeof customFieldValues === "string"
          ? JSON.parse(customFieldValues)
          : customFieldValues || {};

      await this.validateCustomFieldValues(aTId, parsedCustomFields);
    } catch (error) {
      files.forEach((f) => fs.unlinkSync(f.path));
      throw error;
    }

    // 4. Mapping DE IMÁGENES — getPublicUrl construye the URL correcta from file.path
    const imageRelations = files.map((file, index) => ({
      url: getPublicUrl(file.path), // ✅ "/images/items/item-xxx.jpg"
      order: index,
    }));

    try {
      // 5. CreateCIÓN EN PRISMA
      const newItem = await prisma.inventoryItem.create({
        data: {
          ...cleanRestOfData,
          quantity,
          minStock,
                    marketValue,
          barcode: finalBarcode,
          serialNumber: finalSerialNumber,
          customFieldValues: parsedCustomFields,
          container: { connect: { id: cId } },
          assetType: { connect: { id: aTId } },
          location: { connect: { id: lId } },
          images: { create: imageRelations },
        },
        include: {
          images: { orderBy: { order: "asc" } },
        },
      });

      // 6. RETORNO AUTOMATIZADO with the DTO 🏆
      // Esto Ensure que the Response sea idéntica a lo que Flutter espera.
      return new InventoryItemDTO(newItem).toJSON();
    } catch (error) {
      console.error("Prisma error:", error);
      // Limpieza de archivos física en caso de error catastrófico
      files.forEach((file) => {
        const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, file.filename);
        if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
      });
      throw new Error("Failed to create item.");
    }
  }

  // =================================================================
  // 2. MÉTODO for COPIAR a ÍTEM EXISTENTE (cloneItem)
  // =================================================================
  async cloneItem(data) {
    // 1. Validación inicial
    if (data.files && data.files.length > 0) {
      throw new Error("Cloning operation cannot include new file uploads.");
    }
    console.log(data);
    // 2. DESESTRUCTURACIÓN DINÁMICA (Igual que en CreateteItem)
    const {
      id: _oldId,
      containerId,
      assetTypeId,
      locationId,
      images: imagesFromRequest,
      customFieldValues,
      barcode,
      totalMarketValue: _tmv, // Lo extraemos para que no caiga en restOfData
      lastPriceUpdate: _lpu, // Lo mismo si existe
      createdAt: _ca,
      updatedAt: _ua,
      ...restOfData
    } = data;

    const cId = parseInt(containerId);
    const aTId = parseInt(assetTypeId);
    const lId = parseInt(locationId);

    if (isNaN(cId) || isNaN(aTId) || isNaN(lId)) {
      throw new Error("Invalid Container, Asset Type or Location ID.");
    }

    // 3. LÓGICA DE ASSET TYPE and CANTIDAD
    const assetType = await prisma.assetType.findUnique({
      where: { id: aTId },
    });
    if (!assetType) throw new Error("Asset Type not found.");

    const quantityInput = parseInt(restOfData.quantity) || 1;
    const quantity = assetType.isSerialized
      ? 1
      : quantityInput > 0
        ? quantityInput
        : 1;
    const minStock = parseInt(restOfData.minStock) || 0;
    const finalBarcode = null;

    // 4. COPIA FÍSICA DE IMÁGENES EN disk
    const allImageRelations = [];
    const newlyCopiedFilenames = [];
    // for the copia de archivos necesitamos the prefijo for extraer the filename relativo.
    // Use STATIC_URL_PREFIX como referencia, igual que antes, pero ahora
    // the URL de the imagen copiada se construye with getPublicUrl(newPath).
    const baseImageUrl = AppConstants.STATIC_URL_PREFIX;
    const cleanBaseImageUrl = baseImageUrl.endsWith("/")
      ? baseImageUrl
      : `${baseImageUrl}/`;

    // Subdirectorio donde se guardan the imágenes de items (relativo a UPLOAD_DIR_ABSOLUTE)
    const ITEMS_SUBDIR = "items";
    const ITEMS_DIR_ABSOLUTE = path.join(UPLOAD_DIR_ABSOLUTE, ITEMS_SUBDIR);

    // Ensure que the subdirectorio existe antes de copiar
    if (!fs.existsSync(ITEMS_DIR_ABSOLUTE)) {
      fs.mkdirSync(ITEMS_DIR_ABSOLUTE, { recursive: true });
    }

    if (Array.isArray(imagesFromRequest)) {
      for (const [index, img] of imagesFromRequest.entries()) {
        // Normalizamos separadores and quitamos the prefijo estático (/images)
        // for get the route relativa: "items/item-123.jpg"
        let relativePath = img.url.replace(/\\/g, "/");

        if (relativePath.startsWith(cleanBaseImageUrl)) {
          relativePath = relativePath.substring(cleanBaseImageUrl.length);
        } else if (relativePath.startsWith("/")) {
          relativePath = relativePath.substring(1);
          if (relativePath.startsWith("images/")) {
            relativePath = relativePath.substring("images/".length);
          }
        } else {
          relativePath = path.basename(relativePath);
        }

        const originalPath = path.join(UPLOAD_DIR_ABSOLUTE, relativePath);

        if (fs.existsSync(originalPath)) {
          const ext = path.extname(relativePath);
          const uniqueSuffix =
            Temporal.Now.instant().epochMilliseconds +
            "-" +
            Math.round(Math.random() * 1e9);
          const newFilename = `item-clone-${uniqueSuffix}${ext}`;
          // the clon se guarda en the mismo subdirectorio items/ que the original
          const newPath = path.join(ITEMS_DIR_ABSOLUTE, newFilename);

          try {
            fs.copyFileSync(originalPath, newPath);
            // Guardamos the route relativa for the limpieza en caso de error de DB
            newlyCopiedFilenames.push(path.join(ITEMS_SUBDIR, newFilename));

            allImageRelations.push({
              url: getPublicUrl(newPath), // → /images/items/item-clone-xxx.jpg
              altText: img.altText || null,
              order: img.order || index + 1,
            });
          } catch (copyError) {
            console.error(`Error copying file ${originalPath}:`, copyError);
          }
        } else {
          console.warn(
            `[cloneItem] Imagen original no encontrada: ${originalPath}`,
          );
        }
      }
    }

    // 5. CreateCIÓN EN the BASE DE data
    try {
      const newItem = await prisma.inventoryItem.create({
        data: {
          barcode: finalBarcode,
          ...restOfData, // 👈 Se clonan automáticamente barcode, marketValue, etc.
          quantity,
          minStock,
          customFieldValues: customFieldValues || {},
          container: { connect: { id: cId } },
          assetType: { connect: { id: aTId } },
          location: { connect: { id: lId } },
          images: { create: allImageRelations },
        },
        include: { images: { orderBy: { order: "asc" } } },
      });

      // 6. RETORNO with the DTO 🏆
      return new InventoryItemDTO(newItem).toJSON();
    } catch (error) {
      // Limpieza de archivos if the DB fails
      // newlyCopiedFilenames contiene ROUTES relativas a UPLOAD_DIR_ABSOLUTE (ej: items/item-clone-xxx.jpg)
      newlyCopiedFilenames.forEach((relativePath) => {
        const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, relativePath);
        if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
      });
      throw new Error("Failed to clone item.");
    }
  }

  // inventoryItemService.js

  async getGlobalTotalValue(userId) {
    try {
      const parsedUserId = parseInt(userId, 10);
      if (isNaN(parsedUserId)) return 0;

      const result = await prisma.$queryRaw`
      SELECT SUM(
        COALESCE(
          CAST(
            JSON_EXTRACT(
              i.custom_field_values, 
              CONCAT('$."', CAST(cfd.id AS CHAR), '"') -- 👈 Se añaden comillas dobles al ID
            ) AS DECIMAL(15,2)
          ), 
          0
        ) * i.quantity
      ) as total
      FROM inventory_item i
      JOIN custom_field_definition cfd ON i.asset_type_id = cfd.asset_type_id
      JOIN container c ON i.containerId = c.id
      WHERE c.userId = ${parsedUserId}
      AND (cfd.type = 'price' OR cfd.is_monetary = 1)
    `;

      if (!result || result.length === 0) return 0;

      // Safe access to the 'total' value
      const totalValue = result[0].total;
      return totalValue ? parseFloat(totalValue) : 0;
    } catch (error) {
      const errorText = String(error?.message || "");
      const adapterCode = error?.driverAdapterError?.code || error?.cause?.code;
      const isMissingTable =
        errorText.includes("TableDoesNotExist") ||
        errorText.includes("doesn't exist") ||
        adapterCode === "TableDoesNotExist";

      if (isMissingTable) {
        console.warn(
          "[getGlobalTotalValue] Missing table in current instance schema. Returning 0.",
        );
        return 0;
      }

      console.error("Error SQL Detallado:", error);
      return 0;
    }
  }

  // ----------------------------------------------------
  // 🔑 new MÉTODO DE VALIDACIÓN DE VALORES PERSONALIZADOS
  // ----------------------------------------------------
  async validateCustomFieldValues(assetTypeId, values) {
    if (!values || Object.keys(values).length === 0) {
      return; // No hay valores que validar
    }

    // 1. get todas the definiciones de campo for este AssetType
    const definitions = await prisma.customFieldDefinition.findMany({
      where: { assetTypeId },
    });

    for (const def of definitions) {
      const fieldKey = def.id.toString();
      const value = values[fieldKey];

      // 2. Validar campos requeridos (if es necesario)
      if (
        def.isRequired &&
        (value === null || value === undefined || value === "")
      ) {
        throw new Error(`Field '${def.name}' is required but was empty.`);
      }

      // 3. Validar tipo de data (Important for 'isSummable')
      if (value !== null && value !== undefined && value !== "") {
        // if es tipo 'number' o 'currency', Ensure que sea convertible a número
        if (def.type === "number" || def.type === "currency") {
          const numValue = parseFloat(value);
          if (isNaN(numValue)) {
            throw new Error(`Field '${def.name}' must be a valid number.`);
          }
          // Opcional: if quieres guardar the valor como número en the JSON (no string),
          // puedes convertirlo aquí, pero the parseo de Multer/JSON.parse
          // a menudo lo deja como string, lo cual MySQL acepta en JSON.
        }
      }
    }
  }

  async getItemsByAssetType(containerId, assetTypeId) {
    try {
      return await prisma.inventoryItem.findMany({
        where: {
          containerId: parseInt(containerId),
          assetTypeId: parseInt(assetTypeId), // 🚩 FILTRO CRUCIAL
        },
        include: {
          images: true,
          location: true,
        },
      });
    } catch (error) {
      throw new Error("Error al obtener items filtrados: " + error.message);
    }
  }

  /**
   * gets the history de precios del producto
   * @param {*} itemId
   * @param {*} userId
   * @returns
   */
  async getItemPriceHistory(itemId, userId) {
    // We verify that the item belongs to the user for security
    const item = await prisma.inventoryItem.findUnique({
      where: { id: parseInt(itemId) },
      select: { container: { select: { userId: true } } },
    });

    if (!item || item.container.userId !== userId) {
      throw new Error("Ítem no encontrado o acceso denegado");
    }

    // we get the history
    const history = await prisma.priceHistory.findMany({
      where: { inventoryItemId: parseInt(itemId) },
      orderBy: { createdAt: "asc" }, // De más antiguo a más reciente para la gráfica
      select: {
        price: true,
        createdAt: true,
      },
    });

    return history;
  }

  /**
   * gets the ítems de a container and tipo de activo específicos,
   * aplicando filtros sobre campos personalizados and calculando totales.
   */
  async getItems({
    containerId,
    assetTypeId,
    userId,
    aggregationFilters = {},
  }) {
    // 1. Validar and convertir IDs
    const cId = parseInt(containerId);
    const aTId = parseInt(assetTypeId);

    if (isNaN(cId) || isNaN(aTId)) {
      throw new Error(
        "Formato de ID inválido para contenedor o tipo de activo.",
      );
    }

    // 2. get definiciones de campos personalizados (for saber cuáles son sumables)
    const allFieldDefinitions = await prisma.customFieldDefinition.findMany({
      where: { assetTypeId: aTId },
      select: { id: true, name: true, type: true, isSummable: true },
    });

    const summableFieldDefinitions = allFieldDefinitions.filter(
      (def) => def.isSummable,
    );

    // 3. Query the DB via Prisma (security: filter by the container's userId)
    const allItems = await prisma.inventoryItem.findMany({
      where: {
        containerId: cId,
        assetTypeId: aTId,
        container: { userId: userId },
      },
      include: {
        location: true,
        assetType: true,
        images: {
          orderBy: { order: "asc" },
        },
      },
    });

    // 4. Filtrado en Memoria (JS) for campos dinámicos (Custom Fields)
    let filteredItems = allItems;
    if (Object.keys(aggregationFilters).length > 0) {
      // Tomamos the first filtro (puedes extenderlo a múltiples if lo necesitas)
      const fieldId = Object.keys(aggregationFilters)[0].toString();
      const filterValue = String(aggregationFilters[fieldId]).trim();

      filteredItems = allItems.filter((item) => {
        const customValues = item.customFieldValues || {};
        const itemValueRaw = customValues[fieldId];

        const itemValueString =
          itemValueRaw !== null && itemValueRaw !== undefined
            ? String(itemValueRaw).trim()
            : "";

        return itemValueString === filterValue;
      });
    }

    // 5. Cálculo de Agregaciones (Sumas and Conteos)
    const aggregationResults = {};

    // Conteo de the selección actual
    if (Object.keys(aggregationFilters).length > 0) {
      aggregationResults[`count_${Object.keys(aggregationFilters)[0]}`] =
        filteredItems.length;
    }

    // Sumatorios de campos marcados como 'isSummable'
    for (const def of summableFieldDefinitions) {
      const fieldKey = def.id.toString();
      let totalSum = 0;

      filteredItems.forEach((item) => {
        const value = item.customFieldValues?.[fieldKey];
        if (value !== undefined && value !== null && value !== "") {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) totalSum += numValue;
        }
      });

      aggregationResults[`sum_${fieldKey}`] = totalSum;
    }

    // 6. Mapping to DTO (transformation for Flutter)
    // Aquí es donde convertimos the data crudos de Prisma en objetos limpios
    const dtoItems = filteredItems.map((item) =>
      new InventoryItemDTO(item).toJSON(),
    );

    // 7. Calculation of the Total Market Value of the selection
    const totalMarketSelection = dtoItems.reduce(
      (acc, item) => acc + (item.totalMarketValue || 0),
      0,
    );
    // 8. ESTRUCTURA DE RETORNO (Clave for evitar the error de 'definitions')
    // Return 'items' and 'totals' at the top level so the router can find them easily
    return {
      success: true,
      items: dtoItems, // Lista de ítems procesados
      totals: {
        // Objeto de totales que the router searches
        definitions: summableFieldDefinitions,
        aggregations: aggregationResults,
        marketValueTotal: parseFloat(totalMarketSelection.toFixed(2)),
      },
    };
  }

  async getItemById(id, containerId) {
    return prisma.inventoryItem.findFirst({
      where: {
        id,
        containerId,
      },
      include: {
        images: {
          orderBy: { order: "asc" },
        },
      },
    });
  }

  async updateItem(id, data, userId) {
    // 1. DESESTRUCTURACIÓN DINÁMICA
    const {
      imageIdsToDelete,
      filesToUpload,
      containerId: containerIdStr,
      assetTypeId: assetTypeIdStr,
      locationId: locationIdStr,
      customFieldValues,
      barcode,
      serialNumber,
      // Excluimos campos que Prisma no reconoce o que manejamos manualmente
      id: _id,
      images: _images,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      totalMarketValue: _tmv,
      isLowStock: _isLowStock,
      imageUrl: _imageUrl,
      location: _location,
      priceHistory: _ph,
      ...restOfData
    } = data;
    // 2. CONVERSIÓN DE TIPOS CRÍTICOS
    const itemIdInt = parseInt(id);
    const cId = parseInt(containerIdStr);
    const aTId = parseInt(assetTypeIdStr);
    const lId = parseInt(locationIdStr);
    if (isNaN(itemIdInt) || isNaN(cId) || isNaN(aTId)) {
      throw new Error("Invalid ID format provided.");
    }

    // 3. LÓGICA DE ASSET TYPE and CANTIDAD
    const assetType = await prisma.assetType.findUnique({
      where: { id: aTId },
    });
    if (!assetType) throw new Error("Asset Type not found.");

    let quantity = undefined;
    if (assetType.isSerialized) {
      quantity = 1;
    } else if (restOfData.quantity !== undefined) {
      const parsedQty = parseInt(restOfData.quantity, 10);
      quantity = !isNaN(parsedQty) && parsedQty > 0 ? parsedQty : undefined;
    }

    // 4. PARSEO DE CUSTOM FIELDS and CAMPOS NUMÉRICOS (Important for Prisma)
    let parsedCustomFields = undefined;
    if (customFieldValues) {
      parsedCustomFields =
        typeof customFieldValues === "string"
          ? JSON.parse(customFieldValues)
          : customFieldValues;
    }

    // 🔑 TRUCO: Convertimos marketValue a número if existe en restOfData
    if (
      restOfData.marketValue !== undefined ||
      restOfData.market_value !== undefined
    ) {
      restOfData.marketValue = this.parseNumericInput(
        restOfData.marketValue ?? restOfData.market_value,
        0,
      );
      delete restOfData.market_value;
    }

    const updateActions = [];

    // ===========================================
    // PASO A: ELIMINACIÓN DE IMÁGENES
    // ===========================================
    if (imageIdsToDelete && imageIdsToDelete.length > 0) {
      // Ensure que sea array (a veces llega como string from the cliente)
      const idsArray = Array.isArray(imageIdsToDelete)
        ? imageIdsToDelete
        : [imageIdsToDelete];
      const idsToDeleteInt = idsArray
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));

      const imagesToDelete = await prisma.inventoryItemImage.findMany({
        where: { id: { in: idsToDeleteInt }, inventoryItemId: itemIdInt },
        select: { url: true },
      });

      for (const img of imagesToDelete) {
        const filename = path.basename(img.url);
        // Make sure UPLOAD_DIR_ABSOLUTE is defined at the top of the file
        const imagePath = path.join(UPLOAD_DIR_ABSOLUTE, filename);
        try {
          if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        } catch (err) {
          console.error("Error deleting file:", err);
        }
      }

      updateActions.push(
        prisma.inventoryItemImage.deleteMany({
          where: { id: { in: idsToDeleteInt }, inventoryItemId: itemIdInt },
        }),
      );
    }

    // ===========================================
    // PASO B: update the ITEM PRINCIPAL
    // ===========================================
    const finalSerialNumber =
      serialNumber === "" ||
      serialNumber === null ||
      serialNumber === undefined ||
      serialNumber === "null"
        ? null
        : serialNumber.toString().trim();

    const itemUpdateData = {
      barcode:
        barcode === "" ||
        barcode === null ||
        barcode === undefined ||
        barcode === "null"
          ? null
          : barcode,
      serialNumber: finalSerialNumber,
      ...restOfData,
      quantity,
      minStock:
        restOfData.minStock !== undefined
          ? parseInt(restOfData.minStock) || 0
          : undefined,
      containerId: cId,
      assetTypeId: aTId,
      locationId: !isNaN(lId) ? lId : undefined,
      customFieldValues: parsedCustomFields,
    };

    delete itemUpdateData.id;

    updateActions.push(
      prisma.inventoryItem.update({
        where: { id: itemIdInt },
        data: itemUpdateData,
      }),
    );

    // ===========================================
    // PASO C: AÑADIR NUEVAS IMÁGENES
    // ===========================================
    if (filesToUpload && filesToUpload.length > 0) {
      const lastImage = await prisma.inventoryItemImage.findFirst({
        where: { inventoryItemId: itemIdInt },
        orderBy: { order: "desc" },
      });
      const startOrder = lastImage ? lastImage.order + 1 : 1;

      const newImagesData = filesToUpload.map((file, index) => ({
        url: getPublicUrl(file.path), // ✅ URL correcta
        inventoryItemId: itemIdInt,
        order: startOrder + index,
      }));

      updateActions.push(
        prisma.inventoryItemImage.createMany({ data: newImagesData }),
      );
    }

    // ===========================================
    // PASO D: TRANSACCIÓN and DTO FINAL 🏆
    // ===========================================
    await prisma.$transaction(updateActions);

    const finalItem = await prisma.inventoryItem.findUnique({
      where: { id: itemIdInt },
      include: { images: { orderBy: { order: "asc" } } },
    });

    if (!finalItem) throw new Error("Item not found after update.");

    // E. Low Stock Alert

    await alertService.checkAndNotifyLowStock(userId, finalItem);

    // Return the DTO instance
    return new InventoryItemDTO(finalItem).toJSON();
  }

  async getAllItemsForUser(userId) {
    try {
      // 🔑 Query all items that belong to the user's containers
      const items = await prisma.inventoryItem.findMany({
        where: {
          container: {
            userId: userId, // Filter by the owner of the container
          },
        },
        include: {
          images: true, // Incluimos imágenes por si las necesitas en el dashboard
          location: true,
          assetType: true,
        },
        orderBy: {
          name: "asc",
        },
      });

      // the frontend (Flutter) espera a objeto with the lista and definiciones
      // for the Dashboard, the definiciones de agregación pueden ir vacías
      return {
        items: items,
        aggregationDefinitions: [],
        aggregationResults: {},
      };
    } catch (error) {
      console.error("Error en getAllItemsForUser:", error);
      throw new Error("Error al obtener los ítems globales del usuario.");
    }
  }

  async createBatchItems({
    containerId,
    assetTypeId,
    itemsData,
    // userId // Lo dejamos como comentario ya que the route ya verificó the acceso
  }) {
    const cId = parseInt(containerId);
    const aTId = parseInt(assetTypeId);

    if (isNaN(cId) || isNaN(aTId)) {
      throw new Error("Invalid Container ID or Asset Type ID.");
    }

    // 1. get the TIPO DE ACTIVO for Verify if es seriado
    const assetType = await prisma.assetType.findUnique({
      where: { id: aTId },
    });

    if (!assetType) {
      throw new Error("Asset Type not found.");
    }

    // 2. get the definiciones de campos personalizados a VEZ for validación.
    const fieldDefinitions = await prisma.customFieldDefinition.findMany({
      where: { assetTypeId: aTId },
    });

    // List to store successful insertions.
    const itemsToCreate = [];
    const validationErrors = [];
    let successCount = 0;

    // 3. PRE-PROCESAMIENTO and VALIDACIÓN DE CADA ÍTEM
    for (let i = 0; i < itemsData.length; i++) {
      const item = itemsData[i];

      if (
        item.assetTypeId !== undefined &&
        parseInt(item.assetTypeId, 10) !== aTId
      ) {
        validationErrors.push({
          row: i + 2,
          message: "Row assetTypeId does not match batch assetTypeId.",
        });
        continue;
      }

      if (
        item.containerId !== undefined &&
        parseInt(item.containerId, 10) !== cId
      ) {
        validationErrors.push({
          row: i + 2,
          message: "Row containerId does not match batch containerId.",
        });
        continue;
      }

      // The frontend already sent 'name' and 'description', plus the custom fields.
      const name = item.name;
      const description = item.description || null;

      // LÓGICA DE LOCATION (requerido)
      const lId = parseInt(item.locationId);
      if (isNaN(lId)) {
        validationErrors.push({ row: i + 2, message: "Location is required." });
        continue;
      }

      // LÓGICA DE CANTIDAD (QUANTITY)
      let quantity;
      if (assetType.isSerialized) {
        // Los asset types serializados siempre tienen quantity 1
        quantity = 1;
      } else {
        if (item.quantity === undefined || item.quantity === null || item.quantity === "") {
          validationErrors.push({ row: i + 2, message: "Quantity is required." });
          continue;
        }

        const inputQuantity = parseInt(item.quantity, 10);
        if (isNaN(inputQuantity) || inputQuantity < 1) {
          validationErrors.push({
            row: i + 2,
            message: "Quantity must be a positive integer.",
          });
          continue;
        }

        quantity = inputQuantity;
      }

      // LÓGICA DE MIN_STOCK
      let minStock = 0;
      if (item.minStock) {
        const parsedMinStock = parseInt(item.minStock, 10);
        minStock =
          !isNaN(parsedMinStock) && parsedMinStock >= 0 ? parsedMinStock : 0;
      }

      // the campos personalizados vienen directos (no como JSON string escapado)
      const customFieldValues = item.customFieldValues || {};

      // Validar data básicos
      if (!name || name.trim() === "") {
        validationErrors.push({ row: i + 2, message: "Name is required." });
        continue;
      }

      try {
        // Validar the campos personalizados (using the función existente)
        await this.validateCustomFieldValues(
          aTId,
          customFieldValues,
          fieldDefinitions,
        );

        // if the validación pasa, preparar the objeto for Prisma
        itemsToCreate.push({
          containerId: cId,
          assetTypeId: aTId,
          locationId: lId,
          name: name,
          description: description,
          quantity: quantity,
          minStock: minStock,
          // Store customFieldValues as a JSON object in the DB
          customFieldValues: customFieldValues,
        });
        successCount++;
      } catch (error) {
        // Capturar errores de validación de campos personalizados (ej: tipo de dato incorrecto)
        validationErrors.push({ row: i + 2, message: error.message });
      }
    }

    // 5. INSERCIÓN MASIVA EN the BASE DE data
    // if no hay ítems válidos, lanzamos a error que the controlador captura.
    if (itemsToCreate.length === 0 && validationErrors.length > 0) {
      const errorSummary = validationErrors
        .map((e) => `Row ${e.row}: ${e.message}`)
        .join("; ");
      throw new Error(
        `Batch import failed. Validation errors: ${errorSummary}`,
      );
    }

    if (itemsToCreate.length > 0) {
      // Use CreateteMany for the inserción masiva.
      // Esta es the forma más rápida and eficiente en Prisma/SQL.
      await prisma.inventoryItem.createMany({
        data: itemsToCreate,
        // Omite registros duplicados if tienes a clave única. (No necesario aquí)
        // skipDuplicates: true,
      });
    }

    // 6. Devolver the resumen
    return {
      count: itemsToCreate.length,
      totalRows: itemsData.length,
      assetType: {
        id: assetType.id,
        isSerialized: !!assetType.isSerialized,
      },
      details: validationErrors, // Los errores que ocurrieron.
    };
  }

  // ----------------------------------------------------
  // 🔑 MÉTODO DE ELIMINACIÓN with BORRADO DE ARCHIVOS
  // ----------------------------------------------------
  async deleteItem(itemId, userId) {
    // 1. Encontrar the ítem for get the URLs de the imágenes
    const itemToDelete = await prisma.inventoryItem.findFirst({
      where: {
        id: itemId,
        container: {
          userId: userId, // Verify la propiedad
        },
      },
      // 💡 Incluir the imágenes es FUNDAMENTAL
      include: {
        images: true,
      },
    });

    if (!itemToDelete) {
      throw new Error("Item not found or access denied.");
    }

    // 2. DELETE FILES FROM disk
    // the URLs en DB tienen formato /images/items/item-xxx.jpg
    // UPLOAD_DIR_ABSOLUTE apunta a uploads/inventory
    // → hay que quitar the prefijo /images/ for get items/item-xxx.jpg
    //   and unirlo with UPLOAD_DIR_ABSOLUTE → uploads/inventory/items/item-xxx.jpg
    if (itemToDelete.images && itemToDelete.images.length > 0) {
      const staticPrefix = AppConstants.STATIC_URL_PREFIX.replace(/\/+$/, "");

      for (const image of itemToDelete.images) {
        let relativePath = image.url;

        // Quitamos the prefijo estático (/images) for quedarnos with items/archivo.jpg
        if (relativePath.startsWith(staticPrefix + "/")) {
          relativePath = relativePath.substring(staticPrefix.length + 1);
        } else if (relativePath.startsWith("/")) {
          relativePath = relativePath.substring(1);
        }

        const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, relativePath);

        try {
          if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath);
            console.log(`[deleteItem] ✅ Imagen borrada: ${absolutePath}`);
          } else {
            console.warn(
              `[deleteItem] ⚠️ Imagen no encontrada en disco: ${absolutePath}`,
            );
          }
        } catch (err) {
          console.error(
            `[deleteItem] ❌ Error borrando imagen ${absolutePath}:`,
            err,
          );
        }
      }
    }

    // 3. BORRAR REGISTRO DE the BASE DE data
    // Use `delete` on the specific record. if the schema has
    // `ON DELETE CASCADE` on the image relation, the DB deletion
    // también borrará automáticamente the registros de `InventoryItemImage`.
    try {
      await prisma.inventoryItem.delete({
        where: { id: itemId },
      });
    } catch (error) {
      console.error("Prisma error during item deletion:", error);
      throw new Error("Failed to delete inventory item from database.");
    }

    return { success: true };
  }

  async updateItemOptions(id, containerId, options) {
    return prisma.inventoryItem.update({
      where: {
        id,
        containerId,
      },
      data: {
        options,
      },
    });
  }

  async syncItemMarketValue(itemId, userId) {
    // 1. get the ítem (Use Number() en lugar de parseInt for mayor security)
    const item = await prisma.inventoryItem.findUnique({
      where: { id: Number(itemId) },
      include: { container: true },
    });

    if (!item || item.container.userId !== userId) {
      throw new Error("Ítem no encontrado o acceso denegado");
    }

    if (!item.barcode) {
      throw new Error("El ítem no tiene un código de barras asociado");
    }

    // 2. Consultar the service de UPC
    const marketData = await upcService.getMarketDataByBarcode(
      userId,
      item.barcode,
    );

    if (!marketData || !marketData.suggestedPrice) {
      throw new Error("La API no devolvió un precio para este producto");
    }

    const newPrice = Number(marketData.suggestedPrice);

    // 3. Transacción for Ensurer the integridad
    const updatedItem = await prisma.$transaction(async (tx) => {
      // --- LÓGICA DE TIEMPO CORRECTA with TEMPORAL ---
      const now = Temporal.Now.zonedDateTimeISO();

      // Create the start and end of day immutably
      const startOfToday = now.with({
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      });
      const endOfToday = now.with({
        hour: 23,
        minute: 59,
        second: 59,
        millisecond: 999,
      });

      // Important: Convertimos a Date so that Prisma pueda filtrar en the DB
      const startDate = new Date(startOfToday.epochMilliseconds);
      const endDate = new Date(endOfToday.epochMilliseconds);

      // 🔍 Search registro de hoy
      const existingEntryToday = await tx.priceHistory.findFirst({
        where: {
          inventoryItemId: item.id,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      if (existingEntryToday) {
        if (Number(existingEntryToday.price) !== newPrice) {
          await tx.priceHistory.update({
            where: { id: existingEntryToday.id },
            data: { price: newPrice },
          });
        }
      } else {
        await tx.priceHistory.create({
          data: {
            price: newPrice,
            currency: marketData.currency || "USD",
            inventoryItem: { connect: { id: item.id } },
            // Enviamos a Date a Prisma
            createdAt: new Date(now.epochMilliseconds),
          },
        });
      }

      // B. update the ítem principal
      return await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          marketValue: newPrice,
          currency: marketData.currency || "USD",
          lastPriceUpdate: new Date(now.epochMilliseconds), // Date para Prisma
        },
        include: {
          images: { orderBy: { order: "asc" } },
          location: true,
          priceHistory: {
            orderBy: { createdAt: "asc" },
            take: 30,
          },
        },
      });
    });
    // 4. Devolver mediante DTO (que ahora Use tus campos .xxxTemporal)
    return new InventoryItemDTO(updatedItem).toJSON();
  }

  /**
   * updates the valor de mercado de todos the ítems with código de barras
   * de a assetType concreto. Procesa en serie for respetar the rate limits
   * de the API de UPC. returns a resumen with éxitos, skips and errores.
   */
  async syncAssetTypeMarketValues(assetTypeId, containerId, userId) {
    // 1. Verify that the container belongs to the user
    const container = await prisma.container.findFirst({
      where: { id: Number(containerId), userId },
    });
    if (!container)
      throw new Error("Contenedor no encontrado o acceso denegado");

    // 2. get all items of the assetType that have a barcode
    const items = await prisma.inventoryItem.findMany({
      where: {
        assetTypeId: Number(assetTypeId),
        containerId: Number(containerId),
        barcode: { not: null },
      },
      select: { id: true, name: true, barcode: true },
    });

    const results = {
      total: items.length,
      updated: 0,
      skipped: 0, // sin precio en la API
      errors: 0,
      details: [],
    };

    if (items.length === 0) return results;

    // 3. Procesar en serie — evita saturar the API de UPC with llamadas paralelas
    for (const item of items) {
      try {
        await this.syncItemMarketValue(item.id, userId);
        results.updated++;
        results.details.push({
          id: item.id,
          name: item.name,
          status: "updated",
        });
      } catch (err) {
        // "the API no returned a precio" → skip without error crítico
        if (err.message.includes("precio") || err.message.includes("price")) {
          results.skipped++;
          results.details.push({
            id: item.id,
            name: item.name,
            status: "skipped",
            reason: err.message,
          });
        } else {
          results.errors++;
          results.details.push({
            id: item.id,
            name: item.name,
            status: "error",
            reason: err.message,
          });
        }
      }

      // Small pause between calls to respect the UPC rate limit (trial: 100/day)
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return results;
  }

  async getTotalMarketValue(userId) {
    // Fetch items with their assetType to get possessionFieldId
    const items = await prisma.inventoryItem.findMany({
      where: {
        container: {
          userId: userId,
        },
        assetType: {
          possessionFieldId: {
            not: null,
          },
        },
      },
      select: {
        marketValue: true,
        customFieldValues: true,
        assetType: {
          select: {
            possessionFieldId: true,
          },
        },
      },
    });

    // Filter items where possessionField is true
    let totalValue = 0;
    for (const item of items) {
      const possessionFieldId = item.assetType.possessionFieldId;
      const customValues = item.customFieldValues || {};
      const possessionValue = customValues[possessionFieldId];

      // Only count items where possession field is true
      if (possessionValue === true) {
        totalValue += item.marketValue || 0;
      }
    }

    return totalValue;
  }

  async generatePrintLabelPDF(itemId, userId, res, queryOptions = {}, req = null) {
    // 1. Search for the item ensuring it belongs to the user
    const item = await prisma.inventoryItem.findFirst({
      where: {
        id: itemId,
        container: { userId: userId },
      },
      include: { container: true },
    });

    if (!item) throw new Error("Ítem no encontrado.");

    const containerId = item.containerId;
    const aTypeId = item.assetTypeId;
    const id = item.id;

    const baseUrl = req
      ? `${req.protocol}://${req.get("host")}`
      : "http://localhost:3000";
    const itemUrl = `${baseUrl}/#/container/${containerId}/asset-types/${aTypeId}/assets/${id}`;

    // 1. Configuración de dimensiones
    const mmWidth = parseFloat(queryOptions.width) || 50;
    const mmHeight = parseFloat(queryOptions.height) || 30;
    const isSmall = mmHeight < 20;

    const width = mmWidth * 2.83465;
    const height = mmHeight * 2.83465;

    const doc = new PDFDocument({
      size: [width, height],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // 2. Guía de corte
    doc
      .rect(0, 0, width, height)
      .lineWidth(0.5)
      .strokeColor("#CCCCCC")
      .stroke();

    // --- 📐 CÁLCULOS DE DISEÑO ---
    const padding = height * 0.08;
    const safeWidth = width - padding * 2;
    const safeHeight = height - padding * 2;

    const colQrWidth = safeWidth * (isSmall ? 0.3 : 0.35);
    const colTextWidth = safeWidth * (isSmall ? 0.65 : 0.6);
    const textX = padding + colQrWidth + safeWidth * 0.05;

    // 3. QR Proporcional
    const qrSize = Math.min(colQrWidth, safeHeight);
    const qrBuffer = await bwipjs.toBuffer({
      bcid: "qrcode",
      text: itemUrl,
      scale: 4,
    });

    const qrY = (height - qrSize) / 2;
    doc.image(qrBuffer, padding, qrY, { width: qrSize, height: qrSize });

    // --- 📝 BLOQUE DE TEXTO DINÁMICO ---

    // the vertical start depends on whether the label is small or not
    let currentY = isSmall ? padding : qrY + qrSize * 0.05;

    const titleFontSize = isSmall
      ? Math.max(mmHeight * 0.14, 6)
      : Math.max(mmHeight * 0.16, 7.5);

    // Define a height limit for the text (approx 65% of the safe area)
    const maxTitleHeight = safeHeight * 0.65;

    // 4. Item name (Flexible: 1, 2 or 3 lines)
    doc
      .fillColor("#000000")
      .fontSize(titleFontSize)
      .font("Helvetica-Bold")
      .lineGap(-1.2)
      .text(item.name.toUpperCase(), textX, currentY, {
        width: colTextWidth,
        height: maxTitleHeight,
        ellipsis: true,
        align: "left",
      });

    // --- POSICIONAMIENTO RELATIVO ---
    // doc.and updates automatically at the end of the previous text
    const infoFontSize = titleFontSize * 0.8;
    let dynamicY = doc.y + (isSmall ? 1 : 2);

    // Security guard: ensure the ID does not overflow the bottom edge
    const bottomLimit = height - (infoFontSize + padding);
    if (dynamicY > bottomLimit) {
      dynamicY = bottomLimit - 1;
    }

    if (isSmall) {
      // DISEÑO COMPACTO (S): ID and Medida en a sola línea
      doc
        .fillColor("#444444")
        .fontSize(infoFontSize)
        .font("Helvetica")
        .text(
          `#${itemId} | ${Math.round(mmWidth)}x${Math.round(mmHeight)}mm`,
          textX,
          dynamicY,
          {
            width: colTextWidth,
            align: "left",
          },
        );
    } else {
      // DISEÑO ESTÁNDAR (M/L): Cascada de ID and Badge
      doc
        .fillColor("#444444")
        .fontSize(infoFontSize)
        .font("Helvetica")
        .text(`ID: #${itemId}`, textX, dynamicY);

      const badgeY = doc.y + 2;
      const badgeWidth = colTextWidth * 0.9;
      const badgeHeight = infoFontSize * 1.5;

      // only dibujamos the badge if queda espacio suficiente en the etiqueta
      if (badgeY + badgeHeight < height - padding) {
        doc
          .roundedRect(textX, badgeY, badgeWidth, badgeHeight, 2)
          .fill("#F0F0F0");

        doc
          .fillColor("#666666")
          .fontSize(infoFontSize * 0.7)
          .font("Helvetica-Bold")
          .text(
            `${Math.round(mmWidth)}x${Math.round(mmHeight)}mm Standard`,
            textX,
            badgeY + badgeHeight * 0.25,
            { width: badgeWidth, align: "center" },
          );
      }
    }

    doc.end();
  }

  async updateWishlist(itemId, status) {
    return await prisma.inventoryItem.update({
      where: { id: parseInt(itemId) },
      data: { wishlisted: !!status },
    });
  }
}

module.exports = new InventoryItemService();
