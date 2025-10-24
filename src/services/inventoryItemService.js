const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// 💡 Ruta Absoluta donde se guardan los archivos
// Asumimos que la carpeta 'uploads/inventory' está un nivel por encima del archivo de servicio
const UPLOAD_DIR_ABSOLUTE = path.join(
  __dirname,
  "..",
  process.env.UPLOAD_FOLDER
);

class InventoryItemService {
  async createItem(data) {
    // Extraemos los archivos y el resto de los datos del ítem
    const files = data.files || [];
    const itemData = { ...data };
    delete itemData.files; // Limpiamos files

    const containerId = parseInt(itemData.containerId);
    const assetTypeId = parseInt(itemData.assetTypeId);

    // 🛑 Limpiamos las IDs del objeto de datos para que Prisma no las rechace en el 'spread'.
    delete itemData.containerId;
    delete itemData.assetTypeId;

    if (isNaN(containerId) || isNaN(assetTypeId)) {
      // Usamos file.path aquí, ya que Multer lo proporciona en el contexto de la ruta.
      files.forEach((file) => fs.unlinkSync(file.path));
      throw new Error("Invalid Container ID or Asset Type ID.");
    }

    let customFieldValues = {};

    if (
      itemData.customFieldValues &&
      typeof itemData.customFieldValues === "string"
    ) {
      try {
        customFieldValues = JSON.parse(itemData.customFieldValues);
      } catch (e) {
        files.forEach((file) => fs.unlinkSync(file.path));
        throw new Error("Invalid JSON format for custom fields.");
      }
      // Reemplazamos el string con el objeto parseado
      itemData.customFieldValues = customFieldValues;
    }

    // =================================================================
    // 🔑 NUEVA LÓGICA DE VALIDACIÓN (Opcional pero muy Recomendada)
    // Se valida que los campos que deberían ser numéricos sean válidos.
    // Esto previene errores de totales más adelante.
    // =================================================================
    try {
      await this.validateCustomFieldValues(assetTypeId, customFieldValues);
    } catch (error) {
      files.forEach((file) => fs.unlinkSync(file.path));
      throw error; // Relanzar el error de validación
    }
    // =================================================================

    // 1. Mapear archivos a URLs públicas
    const baseImageUrl = process.env.STATIC_URL_PREFIX;
    const imageRelations = files.map((file, index) => {
      const publicUrl = path
        .join(baseImageUrl, file.filename)
        .replace(/\\/g, "/");
      return {
        url: publicUrl,
        // Si el modelo InventoryItemImage NO tiene 'filename', esto está correcto.
        order: index,
      };
    });

    try {
      // 2. Crear el ítem y las imágenes dentro de una sola transacción de Prisma
      const newItem = await prisma.inventoryItem.create({
        data: {
          // 🔑 Usamos el spread solo para los campos directos que quedan (name, description, customFieldValues)
          ...itemData,

          // Corregido: Usar 'connect' para las relaciones de Muchos a Uno (Container, AssetType)
          container: {
            connect: { id: containerId },
          },
          assetType: {
            connect: { id: assetTypeId },
          },

          // Conexión anidada para crear las imágenes
          images: {
            create: imageRelations,
          },
        },
        include: {
          images: {
            orderBy: { order: "asc" },
          },
        },
      });

      return { success: true, data: newItem };
    } catch (error) {
      console.error("Prisma error during item creation:", error);

      // Limpieza de archivos si falla la creación en DB
      files.forEach((file) => {
        const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, file.filename);
        try {
          fs.unlinkSync(absolutePath);
        } catch (err) {
          console.error("Error cleaning up file:", err);
        }
      });

      throw new Error("Failed to create inventory item and associate images.");
    }
  }

  // =================================================================
  // 2. MÉTODO PARA COPIAR UN ÍTEM EXISTENTE (cloneItem)
  // =================================================================
  async cloneItem(data) {
    // Validación: No debe haber archivos subidos
    if (data.files && data.files.length > 0) {
      throw new Error("Cloning operation cannot include new file uploads.");
    }

    const itemData = { ...data };
    delete itemData.id;

    const containerId = parseInt(itemData.containerId);
    const assetTypeId = parseInt(itemData.assetTypeId);

    delete itemData.containerId;
    delete itemData.assetTypeId;

    if (isNaN(containerId) || isNaN(assetTypeId)) {
      throw new Error("Invalid Container ID or Asset Type ID.");
    }

    // --- Lógica de Imágenes Copiadas del body ---
    let imagesToCopy = [];
    if (itemData.images && Array.isArray(itemData.images)) {
      imagesToCopy = itemData.images;
      delete itemData.images; // Limpiamos para el spread de Prisma
    }

    // --- 1. COPIA DE ARCHIVOS FÍSICOS EN DISCO ---
    const allImageRelations = [];
    const newlyCopiedFilenames = []; // Para limpieza si falla la DB
    const baseImageUrl = process.env.STATIC_URL_PREFIX;

    const cleanBaseImageUrl = baseImageUrl.endsWith("/")
      ? baseImageUrl
      : `${baseImageUrl}/`;

    for (const [index, img] of imagesToCopy.entries()) {
      // 🔑 CORRECCIÓN CLAVE: Extracción robusta del nombre del archivo original
      let originalFilename = img.url.replace(/\\/g, "/"); // Normalizar barras

      // 1. Intentar remover el prefijo público del inicio (e.g., '/images/')
      if (originalFilename.startsWith(cleanBaseImageUrl)) {
        originalFilename = originalFilename.substring(cleanBaseImageUrl.length);
      } else {
        // 2. Fallback: Si no tiene el prefijo (o si es solo el nombre), usamos path.basename
        originalFilename = path.basename(originalFilename);
      }

      // Reconstruir la ruta absoluta donde DEBE estar el archivo original
      const originalPath = path.join(UPLOAD_DIR_ABSOLUTE, originalFilename);

      // Verificar si el archivo original existe
      if (fs.existsSync(originalPath)) {
        // ... (Resto de la lógica de generación de nuevo nombre y copia de archivo) ...

        const ext = path.extname(originalFilename);
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const newFilename = "item-" + uniqueSuffix + ext;
        const newPath = path.join(UPLOAD_DIR_ABSOLUTE, newFilename);

        try {
          fs.copyFileSync(originalPath, newPath); // COPIA DEL ARCHIVO
          newlyCopiedFilenames.push(newFilename);
        } catch (copyError) {
          console.error(`Error copying file ${originalPath}:`, copyError);
          continue;
        }

        const newPublicUrl = path
          .join(baseImageUrl, newFilename)
          .replace(/\\/g, "/");

        allImageRelations.push({
          url: newPublicUrl,
          altText: img.altText || null,
          // 🔑 MEJORA: Preservar el 'order' original si existe, sino usar el índice
          order: img.order || index + 1,
        });
      } else {
        console.warn(
          `Original image file not found: ${originalPath}. Skipping copy. Original URL was: ${img.url}`
        );
      }
    }

    // --- 2. CREACIÓN EN LA BASE DE DATOS (DB) ---
    try {
      // Crear el ítem con las referencias de imágenes copiadas

      const newItem = await prisma.inventoryItem.create({
        data: {
          ...itemData,
          container: { connect: { id: containerId } },
          assetType: { connect: { id: assetTypeId } },
          images: { create: allImageRelations }, // Crea filas de DB que apuntan a archivos copiados
        },
        include: { images: { orderBy: { order: "asc" } } },
      });

      return newItem;
    } catch (error) {
      console.error("Prisma error during item cloning:", error);

      // 🚨 Limpieza: Si la transacción de DB falla, borrar los archivos que se copiaron
      newlyCopiedFilenames.forEach((filename) => {
        const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, filename);
        try {
          fs.unlinkSync(absolutePath);
          console.log(`Cleaned up copied file: ${filename}`);
        } catch (err) {
          console.error(`Error cleaning up copied file ${filename}:`, err);
        }
      });

      throw new Error("Failed to clone inventory item and associate images.");
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

  async getItems({
    containerId,
    assetTypeId,
    userId,
    aggregationFilters = {},
  }) {
    // 1. Validar IDs
    const cId = parseInt(containerId);
    const aTId = parseInt(assetTypeId);
    if (isNaN(cId) || isNaN(aTId)) {
      throw new Error(
        "Invalid ID format provided for container or asset type."
      );
    }

    // 2. Obtener todas las definiciones de campo
    const allFieldDefinitions = await prisma.customFieldDefinition.findMany({
      where: { assetTypeId: aTId },
      select: { id: true, name: true, type: true, isSummable: true },
    });
    const summableFieldDefinitions = allFieldDefinitions.filter(
      (def) => def.isSummable
    );

    // 3. Inicializar resultados
    const aggregationResults = {};

    // 🔑 CONSTRUCCIÓN DE LA CLÁUSULA WHERE BASE (Solo filtros de Prisma)
    const baseWhereClause = {
      containerId: cId,
      assetTypeId: aTId,
      container: { userId: userId },
    };

    // 4. Obtener TODOS los ítems que cumplen las condiciones base (SIN filtros JSON)
    const allItems = await prisma.inventoryItem.findMany({
      where: baseWhereClause,
      include: {
        images: {
          orderBy: { order: "asc" },
        },
      },
    });

    // 🎯 PASO CRÍTICO: FILTRADO EN JAVASCRIPT
    let items = allItems; // Inicialmente, todos los ítems cargados

    if (Object.keys(aggregationFilters).length > 0) {
      // 1. Obtener la ID del campo a filtrar y el valor de filtro.
      const fieldId = Object.keys(aggregationFilters)[0].toString();

      // 2. SANEAR EL VALOR DE FILTRO: Asegurar que sea una cadena y limpiar espacios en blanco.
      const filterValue = String(aggregationFilters[fieldId]).trim();

      // 🛑 Aplicar el filtro de customFieldValues en memoria
      items = allItems.filter((item) => {
        const customValues = item.customFieldValues || {};
        const itemValueRaw = customValues[fieldId];

        // 3. SANEAR EL VALOR DEL ÍTEM:
        let itemValueString = "";

        // Si el valor existe, lo convertimos a String y le quitamos espacios.
        if (
          itemValueRaw !== null &&
          itemValueRaw !== undefined &&
          itemValueRaw !== ""
        ) {
          itemValueString = String(itemValueRaw).trim();
        }

        // 4. Comparación estricta de cadenas saneadas.
        return itemValueString === filterValue;
      });
    }

    // 5. Lógica de CONTEO (Count)
    const totalCount = items.length; // Usamos la lista filtrada 'items'

    if (Object.keys(aggregationFilters).length > 0) {
      const fieldId = Object.keys(aggregationFilters)[0];
      aggregationResults[`count_${fieldId}`] = totalCount;
    }

    // 6. CÁLCULO DE SUMATORIOS en JavaScript
    // El sumatorio se hace sobre la lista ya filtrada ('items')
    for (const def of summableFieldDefinitions) {
      const fieldKey = def.id.toString();
      let totalSum = 0;

      items.forEach((item) => {
        const value = item.customFieldValues?.[fieldKey];
        const isPresentAndValid =
          value !== undefined && value !== null && value !== "";

        if (def.isSummable && isPresentAndValid) {
          // El valor se lee como string (ej: "45") y se parsea a float para sumar.
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) totalSum += numValue;
        }
      });

      if (def.isSummable) {
        aggregationResults[`sum_${fieldKey}`] = totalSum;
      }
    }

    // 7. Devolver los items junto con los totales
    return {
      success: true,
      data: items,
      totals: {
        definitions: summableFieldDefinitions,
        aggregations: aggregationResults,
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
    // 1. Desestructurar y preparar los datos.
    const {
      imageIdsToDelete,
      filesToUpload,
      containerId: containerIdStr,
      assetTypeId: assetTypeIdStr,
      customFieldValues, // <-- Aquí viene como String JSON escapado
      ...updateData
    } = data;

    // 2. Conversión de tipos y limpieza.
    const itemIdInt = parseInt(id);
    const containerIdInt = parseInt(containerIdStr);
    const assetTypeIdInt = parseInt(assetTypeIdStr);

    if (isNaN(itemIdInt) || isNaN(containerIdInt) || isNaN(assetTypeIdInt)) {
      throw new Error(
        "Invalid ID format provided for item, container, or asset type."
      );
    }

    // 🚀 SOLUCIÓN CLAVE: Parsear customFieldValues
    let parsedCustomFieldValues = {};
    if (customFieldValues && typeof customFieldValues === "string") {
      try {
        // Intentamos parsear el string JSON escapado que viene del frontend
        parsedCustomFieldValues = JSON.parse(customFieldValues);
      } catch (e) {
        console.error("Error parsing customFieldValues:", e);
        throw new Error("Invalid JSON format for custom field values.");
      }
    }

    const updateActions = [];

    // ===========================================
    // PASO A: ELIMINACIÓN DE IMÁGENES (DB y Disco)
    // ===========================================
    if (imageIdsToDelete && imageIdsToDelete.length > 0) {
      // Asegurar que imageIdsToDelete sea un array de Int (Multer lo convierte a String)
      const idsToDeleteInt = imageIdsToDelete
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));

      // 1. Encontrar las URLs de las imágenes que vamos a eliminar
      const imagesToDelete = await prisma.inventoryItemImage.findMany({
        where: {
          id: { in: idsToDeleteInt },
          inventoryItemId: itemIdInt,
        },
        select: { url: true },
      });

      // 2. Eliminar las imágenes del disco
      for (const img of imagesToDelete) {
        const filename = path.basename(img.url);
        const imagePath = path.join(UPLOAD_DIR_ABSOLUTE, filename);

        try {
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
        } catch (err) {
          console.error(`Error deleting file ${imagePath}:`, err);
        }
      }

      // 3. Eliminar las referencias de la base de datos
      updateActions.push(
        prisma.inventoryItemImage.deleteMany({
          where: {
            id: { in: idsToDeleteInt },
            inventoryItemId: itemIdInt,
          },
        })
      );
    }

    // ===========================================
    // PASO B: ACTUALIZAR EL ITEM PRINCIPAL
    // ===========================================
    updateActions.push(
      prisma.inventoryItem.update({
        where: {
          id: itemIdInt,
          containerId: containerIdInt,
        },
        data: {
          ...updateData,
          containerId: containerIdInt,
          assetTypeId: assetTypeIdInt,
          // 🚀 USAMOS EL OBJETO PARSEADO (Formato correcto para Prisma)
          customFieldValues: parsedCustomFieldValues,
        },
        include: {
          images: {
            orderBy: { order: "asc" },
          },
        },
      })
    );

    // ===========================================
    // PASO C: AÑADIR NUEVAS IMÁGENES
    // ===========================================
    if (filesToUpload && filesToUpload.length > 0) {
      const lastImage = await prisma.inventoryItemImage.findFirst({
        where: { inventoryItemId: itemIdInt },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      const startOrder = lastImage ? lastImage.order + 1 : 1;

      const baseImageUrl = process.env.STATIC_URL_PREFIX;
      const UPLOAD_WEB_PATH = "/"; // 🔑 Usamos la ruta relativa correcta

      const newImagesData = filesToUpload.map((file, index) => {
        // 🔑 CORRECCIÓN: Unimos STATIC_URL_PREFIX con la ruta web /images/ y el nombre del archivo.
        // path.join() maneja las barras de forma segura, pero lo forzamos a usar '/' al final.
        const publicUrl = path
          .join(baseImageUrl, UPLOAD_WEB_PATH, file.filename)
          .replace(/\\/g, "/");

        return {
          url: publicUrl,
          inventoryItemId: itemIdInt,
          order: startOrder + index,
        };
      });

      updateActions.push(
        prisma.inventoryItemImage.createMany({
          data: newImagesData,
        })
      );
    }

    // ===========================================
    // PASO D: EJECUTAR TRANSACCIÓN Y DEVOLVER EL RESULTADO FINAL
    // ===========================================

    const results = await prisma.$transaction(updateActions);

    // Encuentra el resultado de la actualización del ítem principal para devolverlo
    const updatedItemResult = results.find(
      (res) => typeof res === "object" && res.id === itemIdInt
    );

    if (updatedItemResult) {
      // Asegura que devolvemos el ítem con las relaciones actualizadas
      return prisma.inventoryItem.findUnique({
        where: { id: itemIdInt },
        include: { images: { orderBy: { order: "asc" } } },
      });
    }

    throw new Error(
      "Update failed or the item could not be retrieved after update."
    );
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

    // 1. Obtener las definiciones de campos personalizados UNA VEZ para validación.
    const fieldDefinitions = await prisma.customFieldDefinition.findMany({
      where: { assetTypeId: aTId },
    });

    // Lista para almacenar las inserciones exitosas.
    const itemsToCreate = [];
    const validationErrors = [];
    let successCount = 0;

    // 2. PRE-PROCESAMIENTO Y VALIDACIÓN DE CADA ÍTEM
    for (let i = 0; i < itemsData.length; i++) {
      const item = itemsData[i];

      // El frontend ya envió 'name' y 'description', más los campos personalizados.
      const name = item.name;
      const description = item.description || null;

      // Los campos personalizados vienen directos (no como JSON string escapado)
      const customFieldValues = item.customFieldValues || {};

      // Validar datos básicos
      if (!name || name.trim() === "") {
        validationErrors.push({ row: i + 2, message: "Name is required." });
        continue;
      }

      try {
        // 3. Validar los campos personalizados (usando la función existente)
        await this.validateCustomFieldValues(
          aTId,
          customFieldValues,
          fieldDefinitions
        );

        // 4. Si la validación pasa, preparar el objeto para Prisma
        itemsToCreate.push({
          containerId: cId,
          assetTypeId: aTId,
          name: name,
          description: description,
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
        `Batch import failed. Validation errors: ${errorSummary}`
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
}

module.exports = new InventoryItemService();
