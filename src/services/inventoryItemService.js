const prisma = require("../middleware/prisma");
const InventoryItemDTO = require("../models/inventoryItemModel");
const upcService = require("../services/upcService");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// 💡 Ruta Absoluta donde se guardan los archivos
// Asumimos que la carpeta 'uploads/inventory' está un nivel por encima del archivo de servicio
const UPLOAD_DIR_ABSOLUTE = path.join(
  __dirname,
  "..",
  process.env.UPLOAD_FOLDER,
);

class InventoryItemService {
  async createItem(data) {
    const files = data.files || [];

    // 1. DESESTRUCTURACIÓN DINÁMICA
    // Extraemos lo que requiere lógica especial y dejamos el resto en 'restOfData'
    const {
      containerId,
      assetTypeId,
      locationId,
      customFieldValues,
      files: _, // ignoramos el array original de files
      barcode,
      ...restOfData // 🚀 Aquí caen automáticamente: name, barcode, marketValue, currency, description, etc.
    } = data;

    // 2. PARSEO DE IDs Y VALIDACIÓN DE ASSET TYPE
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

    // 3. LÓGICA DE NEGOCIO (Quantity, MinStock y CustomFields)
    const quantityInput = parseInt(restOfData.quantity) || 1;
    const quantity = assetType.isSerialized
      ? 1
      : quantityInput > 0
        ? quantityInput
        : 1;

    const minStock = parseInt(restOfData.minStock) || 0;
    const finalBarcode =
      barcode && barcode.toString().trim() !== "" && barcode !== "null"
        ? barcode.toString().trim()
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

    // 4. MAPEO DE IMÁGENES
    const baseImageUrl = process.env.STATIC_URL_PREFIX;
    const imageRelations = files.map((file, index) => ({
      url: path.join(baseImageUrl, file.filename).replace(/\\/g, "/"),
      order: index,
    }));

    try {
      // 5. CREACIÓN EN PRISMA
      const newItem = await prisma.inventoryItem.create({
        data: {
          ...restOfData, // 👈 Mapeo automático de campos simples del DTO (barcode, marketValue, etc.)
          quantity,
          minStock,
          barcode: finalBarcode,
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

      // 6. RETORNO AUTOMATIZADO CON EL DTO 🏆
      // Esto asegura que la respuesta sea idéntica a lo que Flutter espera.
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
  // 2. MÉTODO PARA COPIAR UN ÍTEM EXISTENTE (cloneItem)
  // =================================================================
  async cloneItem(data) {
    // 1. Validación inicial
    if (data.files && data.files.length > 0) {
      throw new Error("Cloning operation cannot include new file uploads.");
    }

    // 2. DESESTRUCTURACIÓN DINÁMICA (Igual que en createItem)
    const {
      id: _oldId, // Ignoramos el ID del ítem original
      containerId,
      assetTypeId,
      locationId,
      images: imagesFromRequest, // Extraemos imágenes para lógica de copia física
      customFieldValues,
      barcode,
      ...restOfData // 🚀 Captura automática de: name, description, barcode, marketValue, currency...
    } = data;

    const cId = parseInt(containerId);
    const aTId = parseInt(assetTypeId);
    const lId = parseInt(locationId);

    if (isNaN(cId) || isNaN(aTId) || isNaN(lId)) {
      throw new Error("Invalid Container, Asset Type or Location ID.");
    }

    // 3. LÓGICA DE ASSET TYPE Y CANTIDAD
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
    const finalBarcode =
      barcode && barcode.toString().trim() !== "" && barcode !== "null"
        ? barcode.toString().trim()
        : null;

    // 4. COPIA FÍSICA DE IMÁGENES EN DISCO
    const allImageRelations = [];
    const newlyCopiedFilenames = [];
    const baseImageUrl = process.env.STATIC_URL_PREFIX;
    const cleanBaseImageUrl = baseImageUrl.endsWith("/")
      ? baseImageUrl
      : `${baseImageUrl}/`;

    if (Array.isArray(imagesFromRequest)) {
      for (const [index, img] of imagesFromRequest.entries()) {
        let originalFilename = img.url.replace(/\\/g, "/");

        if (originalFilename.startsWith(cleanBaseImageUrl)) {
          originalFilename = originalFilename.substring(
            cleanBaseImageUrl.length,
          );
        } else {
          originalFilename = path.basename(originalFilename);
        }

        const originalPath = path.join(UPLOAD_DIR_ABSOLUTE, originalFilename);

        if (fs.existsSync(originalPath)) {
          const ext = path.extname(originalFilename);
          const uniqueSuffix =
            Date.now() + "-" + Math.round(Math.random() * 1e9);
          const newFilename = `item-clone-${uniqueSuffix}${ext}`;
          const newPath = path.join(UPLOAD_DIR_ABSOLUTE, newFilename);

          try {
            fs.copyFileSync(originalPath, newPath);
            newlyCopiedFilenames.push(newFilename);

            allImageRelations.push({
              url: path.join(baseImageUrl, newFilename).replace(/\\/g, "/"),
              altText: img.altText || null,
              order: img.order || index + 1,
            });
          } catch (copyError) {
            console.error(`Error copying file ${originalPath}:`, copyError);
          }
        }
      }
    }

    // 5. CREACIÓN EN LA BASE DE DATOS
    try {
      const newItem = await prisma.inventoryItem.create({
        data: {
          barcode: finalBarcode,
          ...restOfData, // 👈 Se clonan automáticamente barcode, marketValue, etc.
          quantity,
          minStock,
          customFieldValues:
            typeof customFieldValues === "string"
              ? JSON.parse(customFieldValues)
              : customFieldValues || {},
          container: { connect: { id: cId } },
          assetType: { connect: { id: aTId } },
          location: { connect: { id: lId } },
          images: { create: allImageRelations },
        },
        include: { images: { orderBy: { order: "asc" } } },
      });

      // 6. RETORNO CON EL DTO 🏆
      return new InventoryItemDTO(newItem).toJSON();
    } catch (error) {
      // Limpieza de archivos si la DB falla
      newlyCopiedFilenames.forEach((filename) => {
        const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, filename);
        if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
      });
      throw new Error("Failed to clone item.");
    }
  }

  // inventoryItemService.js

  async getGlobalTotalValue(userId) {
    try {
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
      WHERE c.userId = ${parseInt(userId)}
      AND (cfd.type = 'price' OR cfd.is_monetary = 1)
    `;

      if (!result || result.length === 0) return 0;

      // Acceso seguro al valor 'total'
      const totalValue = result[0].total;
      return totalValue ? parseFloat(totalValue) : 0;
    } catch (error) {
      console.error("Error SQL Detallado:", error);
      throw new Error("Error al calcular el valor global.");
    }
  }

  // ----------------------------------------------------
  // 🔑 NUEVO MÉTODO DE VALIDACIÓN DE VALORES PERSONALIZADOS
  // ----------------------------------------------------
  async validateCustomFieldValues(assetTypeId, values) {
    if (!values || Object.keys(values).length === 0) {
      return; // No hay valores que validar
    }

    // 1. Obtener todas las definiciones de campo para este AssetType
    const definitions = await prisma.customFieldDefinition.findMany({
      where: { assetTypeId },
    });

    for (const def of definitions) {
      const fieldKey = def.id.toString();
      const value = values[fieldKey];

      // 2. Validar campos requeridos (si es necesario)
      if (
        def.isRequired &&
        (value === null || value === undefined || value === "")
      ) {
        throw new Error(`Field '${def.name}' is required but was empty.`);
      }

      // 3. Validar tipo de datos (IMPORTANTE para 'isSummable')
      if (value !== null && value !== undefined && value !== "") {
        // Si es tipo 'number' o 'currency', aseguramos que sea convertible a número
        if (def.type === "number" || def.type === "currency") {
          const numValue = parseFloat(value);
          if (isNaN(numValue)) {
            throw new Error(`Field '${def.name}' must be a valid number.`);
          }
          // Opcional: Si quieres guardar el valor como número en el JSON (no string),
          // puedes convertirlo aquí, pero el parseo de Multer/JSON.parse
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
   * Obtiene el historial de precios del producto
   * @param {*} itemId 
   * @param {*} userId 
   * @returns 
   */
  async getItemPriceHistory(itemId, userId) {
    // Verificamos que el ítem pertenezca al usuario por seguridad
    const item = await prisma.inventoryItem.findUnique({
      where: { id: parseInt(itemId) },
      select: { container: { select: { userId: true } } },
    });

    if (!item || item.container.userId !== userId) {
      throw new Error("Ítem no encontrado o acceso denegado");
    }

    // Obtenemos el historial
    const history = await prisma.priceHistory.findMany({
      where: { itemId: parseInt(itemId) },
      orderBy: { createdAt: "asc" }, // De más antiguo a más reciente para la gráfica
      select: {
        price: true,
        createdAt: true,
      },
    });

    return history;
  }

  /**
   * Obtiene los ítems de un contenedor y tipo de activo específicos,
   * aplicando filtros sobre campos personalizados y calculando totales.
   */
  async getItems({
    containerId,
    assetTypeId,
    userId,
    aggregationFilters = {},
  }) {
    // 1. Validar y convertir IDs
    const cId = parseInt(containerId);
    const aTId = parseInt(assetTypeId);

    if (isNaN(cId) || isNaN(aTId)) {
      throw new Error(
        "Formato de ID inválido para contenedor o tipo de activo.",
      );
    }

    // 2. Obtener definiciones de campos personalizados (para saber cuáles son sumables)
    const allFieldDefinitions = await prisma.customFieldDefinition.findMany({
      where: { assetTypeId: aTId },
      select: { id: true, name: true, type: true, isSummable: true },
    });

    const summableFieldDefinitions = allFieldDefinitions.filter(
      (def) => def.isSummable,
    );

    // 3. Consulta Base a Prisma (Seguridad: filtramos por userId del contenedor)
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

    // 4. Filtrado en Memoria (JS) para campos dinámicos (Custom Fields)
    let filteredItems = allItems;

    if (Object.keys(aggregationFilters).length > 0) {
      // Tomamos el primer filtro (puedes extenderlo a múltiples si lo necesitas)
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

    // 5. Cálculo de Agregaciones (Sumas y Conteos)
    const aggregationResults = {};

    // Conteo de la selección actual
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

    // 6. MAPEO AL DTO (Transformación para Flutter)
    // Aquí es donde convertimos los datos crudos de Prisma en objetos limpios
    const dtoItems = filteredItems.map((item) =>
      new InventoryItemDTO(item).toJSON(),
    );

    // 7. Cálculo del Valor Total de Mercado de la selección
    const totalMarketSelection = dtoItems.reduce(
      (acc, item) => acc + (item.totalMarketValue || 0),
      0,
    );

    // 8. ESTRUCTURA DE RETORNO (Clave para evitar el error de 'definitions')
    // Retornamos 'items' y 'totals' al primer nivel para que el router los encuentre fácil
    return {
      success: true,
      items: dtoItems, // Lista de ítems procesados
      totals: {
        // Objeto de totales que el router busca
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

  async updateItem(id, data) {
    // 1. DESESTRUCTURACIÓN DINÁMICA
    const {
      imageIdsToDelete,
      filesToUpload,
      containerId: containerIdStr,
      assetTypeId: assetTypeIdStr,
      locationId: locationIdStr,
      customFieldValues,
      barcode,
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

    // 3. LÓGICA DE ASSET TYPE Y CANTIDAD
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

    // 4. PARSEO DE CUSTOM FIELDS Y CAMPOS NUMÉRICOS (Importante para Prisma)
    let parsedCustomFields = undefined;
    if (customFieldValues) {
      parsedCustomFields =
        typeof customFieldValues === "string"
          ? JSON.parse(customFieldValues)
          : customFieldValues;
    }

    // 🔑 TRUCO: Convertimos marketValue a número si existe en restOfData
    if (restOfData.marketValue !== undefined) {
      restOfData.marketValue = parseFloat(restOfData.marketValue) || 0;
    }

    const updateActions = [];

    // ===========================================
    // PASO A: ELIMINACIÓN DE IMÁGENES
    // ===========================================
    if (imageIdsToDelete && imageIdsToDelete.length > 0) {
      // Aseguramos que sea array (a veces llega como string desde el cliente)
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
        // Asegúrate de que UPLOAD_DIR_ABSOLUTE esté definido al inicio del archivo
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
    // PASO B: ACTUALIZAR EL ITEM PRINCIPAL
    // ===========================================
    const itemUpdateData = {
      barcode,
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
        url: path
          .join(process.env.STATIC_URL_PREFIX, file.filename)
          .replace(/\\/g, "/"),
        inventoryItemId: itemIdInt,
        order: startOrder + index,
      }));

      updateActions.push(
        prisma.inventoryItemImage.createMany({ data: newImagesData }),
      );
    }

    // ===========================================
    // PASO D: TRANSACCIÓN Y DTO FINAL 🏆
    // ===========================================
    await prisma.$transaction(updateActions);

    const finalItem = await prisma.inventoryItem.findUnique({
      where: { id: itemIdInt },
      include: { images: { orderBy: { order: "asc" } } },
    });

    if (!finalItem) throw new Error("Item not found after update.");

    // Retornamos la instancia del DTO
    return new InventoryItemDTO(finalItem).toJSON();
  }

  async getAllItemsForUser(userId) {
    try {
      // 🔑 Consultamos todos los ítems que pertenecen a contenedores del usuario
      const items = await prisma.inventoryItem.findMany({
        where: {
          container: {
            userId: userId, // Filtramos por el dueño del contenedor
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

      // El frontend (Flutter) espera un objeto con la lista y definiciones
      // Para el Dashboard, las definiciones de agregación pueden ir vacías
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
    // userId // Lo dejamos como comentario ya que la ruta ya verificó el acceso
  }) {
    const cId = parseInt(containerId);
    const aTId = parseInt(assetTypeId);

    if (isNaN(cId) || isNaN(aTId)) {
      throw new Error("Invalid Container ID or Asset Type ID.");
    }

    // 1. OBTENER EL TIPO DE ACTIVO para verificar si es seriado
    const assetType = await prisma.assetType.findUnique({
      where: { id: aTId },
    });

    if (!assetType) {
      throw new Error("Asset Type not found.");
    }

    // 2. Obtener las definiciones de campos personalizados UNA VEZ para validación.
    const fieldDefinitions = await prisma.customFieldDefinition.findMany({
      where: { assetTypeId: aTId },
    });

    // Lista para almacenar las inserciones exitosas.
    const itemsToCreate = [];
    const validationErrors = [];
    let successCount = 0;

    // 3. PRE-PROCESAMIENTO Y VALIDACIÓN DE CADA ÍTEM
    for (let i = 0; i < itemsData.length; i++) {
      const item = itemsData[i];

      // El frontend ya envió 'name' y 'description', más los campos personalizados.
      const name = item.name;
      const description = item.description || null;

      // LÓGICA DE CANTIDAD (QUANTITY)
      let quantity;
      if (assetType.isSerialized) {
        quantity = 1;
      } else {
        const inputQuantity = parseInt(item.quantity, 10);
        quantity =
          isNaN(inputQuantity) || inputQuantity < 1 ? 1 : inputQuantity;
      }

      // LÓGICA DE MIN_STOCK
      let minStock = 0;
      if (item.minStock) {
        const parsedMinStock = parseInt(item.minStock, 10);
        minStock =
          !isNaN(parsedMinStock) && parsedMinStock >= 0 ? parsedMinStock : 0;
      }

      // Los campos personalizados vienen directos (no como JSON string escapado)
      const customFieldValues = item.customFieldValues || {};

      // Validar datos básicos
      if (!name || name.trim() === "") {
        validationErrors.push({ row: i + 2, message: "Name is required." });
        continue;
      }

      try {
        // Validar los campos personalizados (usando la función existente)
        await this.validateCustomFieldValues(
          aTId,
          customFieldValues,
          fieldDefinitions,
        );

        // Si la validación pasa, preparar el objeto para Prisma
        itemsToCreate.push({
          containerId: cId,
          assetTypeId: aTId,
          name: name,
          description: description,
          quantity: quantity,
          minStock: minStock,
          // Almacena los customFieldValues como objeto JSON en la DB
          customFieldValues: customFieldValues,
        });
        successCount++;
      } catch (error) {
        // Capturar errores de validación de campos personalizados (ej: tipo de dato incorrecto)
        validationErrors.push({ row: i + 2, message: error.message });
      }
    }

    // 5. INSERCIÓN MASIVA EN LA BASE DE DATOS
    // Si no hay ítems válidos, lanzamos un error que el controlador captura.
    if (itemsToCreate.length === 0 && validationErrors.length > 0) {
      const errorSummary = validationErrors
        .map((e) => `Row ${e.row}: ${e.message}`)
        .join("; ");
      throw new Error(
        `Batch import failed. Validation errors: ${errorSummary}`,
      );
    }

    if (itemsToCreate.length > 0) {
      // Usamos createMany para la inserción masiva.
      // Esta es la forma más rápida y eficiente en Prisma/SQL.
      await prisma.inventoryItem.createMany({
        data: itemsToCreate,
        // Omite registros duplicados si tienes una clave única. (No necesario aquí)
        // skipDuplicates: true,
      });
    }

    // 6. Devolver el resumen
    return {
      count: itemsToCreate.length,
      totalRows: itemsData.length,
      details: validationErrors, // Los errores que ocurrieron.
    };
  }

  // ----------------------------------------------------
  // 🔑 MÉTODO DE ELIMINACIÓN CON BORRADO DE ARCHIVOS
  // ----------------------------------------------------
  async deleteItem(itemId, userId) {
    // 1. Encontrar el ítem para obtener las URLs de las imágenes
    const itemToDelete = await prisma.inventoryItem.findFirst({
      where: {
        id: itemId,
        container: {
          userId: userId, // Verificar la propiedad
        },
      },
      // 💡 Incluir las imágenes es FUNDAMENTAL
      include: {
        images: true,
      },
    });

    if (!itemToDelete) {
      throw new Error("Item not found or access denied.");
    }

    // 2. BORRAR ARCHIVOS DEL DISCO
    if (itemToDelete.images && itemToDelete.images.length > 0) {
      for (const image of itemToDelete.images) {
        // Asumimos que el campo `filename` o el nombre del archivo está en la DB
        // Si no está, lo extraemos de la URL:
        const filename = path.basename(image.url);
        const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, filename);

        try {
          if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath); // 🔑 ¡Borra el archivo físico!
            console.log(`Successfully deleted file: ${absolutePath}`);
          }
        } catch (err) {
          console.error(`Error deleting file ${absolutePath}:`, err);
          // Si falla el borrado del archivo, no impedimos la eliminación de la DB.
        }
      }
    }

    // 3. BORRAR REGISTRO DE LA BASE DE DATOS
    // Usamos `delete` en el registro específico. Si el esquema tiene
    // `ON DELETE CASCADE` en la relación de imágenes, la eliminación de la DB
    // también borrará automáticamente los registros de `InventoryItemImage`.
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
    // 1. Obtener el ítem actual para sacar el barcode
    const item = await prisma.inventoryItem.findUnique({
      where: { id: parseInt(itemId) },
      include: { container: true },
    });

    if (!item || item.container.userId !== userId) {
      throw new Error("Ítem no encontrado o acceso denegado");
    }

    if (!item.barcode) {
      throw new Error("El ítem no tiene un código de barras asociado");
    }
    // 2. Consultar el servicio de UPC
    const marketData = await upcService.getMarketDataByBarcode(
      userId,
      item.barcode,
    );

    if (!marketData || !marketData.suggestedPrice) {
      throw new Error("La API no devolvió un precio para este producto");
    }

    // 3. Actualizar el ítem en la DB
    const updatedItem = await prisma.$transaction(async (tx) => {
      // A. Crear registro en el historial
      await tx.priceHistory.create({
        data: {
          price: marketData.suggestedPrice,
          // En lugar de itemId: item.id, usamos la relación:
          inventoryItem: {
            connect: { id: item.id },
          },
        },
      });

      // B. Actualizar el valor actual en el Item
      return await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          marketValue: marketData.suggestedPrice,
          currency: marketData.currency || "EUR",
          lastPriceUpdate: new Date(),
        },
        include: {
          images: { orderBy: { order: "asc" } },
          location: true,
          priceHistory: {
            // 📉 Opcional: devolver los últimos puntos para la gráfica
            orderBy: { createdAt: "asc" },
            take: 20,
          },
        },
      });
    });

    // 4. Devolver mediante DTO para que Flutter calcule el totalMarketValue al instante
    return new InventoryItemDTO(updatedItem).toJSON();
  }
}

module.exports = new InventoryItemService();
