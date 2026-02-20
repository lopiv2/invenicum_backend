// services/assetTypeService.js

const prisma = require("../middleware/prisma");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
const AssetTypeDTO = require('../models/assetTypeModel');
const BOOLEAN_TYPE_DB = "sí/no (booleano)";

// 💡 CONFIGURACIÓN DE RUTAS FÍSICAS BASADAS EN .env
const UPLOAD_BASE_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
const ASSET_TYPES_SUBDIR =
  process.env.UPLOAD_FOLDER_ASSET_TYPES_SUBDIR || "asset-types";

// 🔑 RUTA ABSOLUTA para las imágenes de Asset Types (e.g., ../uploads/inventory/asset-types)
const UPLOAD_DIR_ASSET_TYPES_ABSOLUTE = path.join(
  __dirname,
  "..",
  UPLOAD_BASE_FOLDER,
  ASSET_TYPES_SUBDIR,
);

// 🔑 RUTA ABSOLUTA para las imágenes de Inventory Items (e.g., ../uploads/inventory)
const UPLOAD_DIR_INVENTORY_ABSOLUTE = path.join(
  __dirname,
  "..",
  UPLOAD_BASE_FOLDER,
);

/**
 * Crea un nuevo Tipo de Activo y sus definiciones de campo con múltiples imágenes.
 * @param {number} containerId ID del contenedor padre.
 * @param {number} userId ID del usuario (para la capa de seguridad).
 * @param {object} data Datos del AssetType (name, fieldDefinitions, files, possessionFieldId, desiredFieldId).
 */
async function createAssetType(containerId, userId, data) {
  const {
    name,
    fieldDefinitions,
    possessionFieldId,
    desiredFieldId,
    isSerialized,
  } = data;
  const files = data.files || [];

  // Validación básica
  if (!name || !fieldDefinitions) {
    files.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });
    return {
      success: false,
      message: "Se requiere nombre y definiciones de campo.",
    };
  }

  // 1. Preparar imágenes
  const baseImageUrl = process.env.STATIC_URL_PREFIX || "";
  const UPLOAD_WEB_PATH =
    process.env.UPLOAD_WEB_PATH_ASSET_TYPES || "asset-types";

  const imageRelations = files.map((file, index) => ({
    url: path
      .join(baseImageUrl, UPLOAD_WEB_PATH, file.filename)
      .replace(/\\/g, "/"),
    filename: file.filename,
    order: index,
  }));

  // 2. Preparar definiciones para Prisma con validación de tipo numérico
  const fieldDefinitionsForPrisma = fieldDefinitions.map((def) => {
    const type = def.type.toLowerCase();
    // Consideramos numéricos los tipos que pueden llevar cálculos
    const isNumeric =
      type === "number" ||
      type === "price" ||
      type === "currency" ||
      type === "número";

    return {
      name: def.name,
      type: def.type,
      isRequired: !!def.isRequired,
      dataListId: def.dataListId ? parseInt(def.dataListId) : null,
      // Solo permitimos estos flags si el tipo es numérico
      isSummable: isNumeric ? !!def.isSummable : false,
      isMonetary: isNumeric ? !!def.isMonetary : false,
      isCountable: isNumeric ? !!def.isCountable : false,
    };
  });

  try {
    const newAssetType = await prisma.assetType.create({
      data: {
        name,
        containerId: parseInt(containerId),
        isSerialized: !!isSerialized,
        possessionFieldId: possessionFieldId
          ? parseInt(possessionFieldId)
          : null,
        desiredFieldId: desiredFieldId ? parseInt(desiredFieldId) : null,
        fieldDefinitions: {
          create: fieldDefinitionsForPrisma,
        },
        images: {
          create: imageRelations,
        },
      },
      include: {
        fieldDefinitions: true,
        images: { orderBy: { order: "asc" } },
      },
    });

    // 🚀 Retornamos el DTO (toJSON es llamado automáticamente por Express al enviar la respuesta)
    return {
      success: true,
      message: "Tipo de Activo creado con éxito.",
      data: new AssetTypeDTO(newAssetType).toJSON(),
    };
  } catch (error) {
    console.error("Prisma Error en createAssetType:", error);
    files.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });
    throw new Error("Error al crear el Tipo de Activo en la base de datos.");
  }
}

/**
 * Obtiene un Tipo de Activo por ID.
 * @param {number|string} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del usuario para verificar la propiedad.
 */
async function getAssetTypeById(assetTypeId, userId) {
  try {
    const id = parseInt(assetTypeId);
    if (isNaN(id)) {
      return { success: false, message: "ID de tipo de activo inválido" };
    }

    const assetType = await prisma.assetType.findUnique({
      where: { id },
      include: {
        container: true,
        fieldDefinitions: true,
        images: {
          orderBy: { order: "asc" },
        },
      },
    });

    if (!assetType) {
      return { success: false, message: "Tipo de Activo no encontrado." };
    }

    // Seguridad: Verificar que el contenedor al que pertenece el AssetType sea propiedad del usuario
    if (assetType.container.userId !== userId) {
      return {
        success: false,
        message: "Acceso denegado: El Tipo de Activo no es de su propiedad.",
        data: null,
      };
    }

    // Quitar datos sensibles del contenedor antes de enviarlo
    const { container, ...assetTypeData } = assetType;

    return {
      success: true,
      data: assetTypeData,
      message: "Tipo de Activo obtenido con éxito.",
    };
  } catch (error) {
    console.error("Prisma Error en getAssetTypeById:", error);
    throw new Error("Error al obtener el Tipo de Activo.");
  }
}

/**
 * Actualiza un Tipo de Activo y sus definiciones de campo y gestiona imágenes.
 * @param {number} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del usuario para verificar la propiedad.
 * @param {object} updateData Datos a actualizar (name, fieldDefinitions, filesToUpload, imageIdsToDelete).
 */
async function updateAssetType(assetTypeId, userId, updateData) {
  const {
    fieldDefinitions,
    filesToUpload,
    removeExistingImage,
    ...assetTypeUpdates // name, isSerialized, possessionFieldId, desiredFieldId
  } = updateData;

  const assetTypeIdInt = parseInt(assetTypeId);
  if (isNaN(assetTypeIdInt)) {
    throw new Error("ID de tipo de activo inválido.");
  }

  // 1. Verificar propiedad y existencia
  const verification = await getAssetTypeById(assetTypeIdInt, userId, {
    include: { images: true, fieldDefinitions: true },
  });

  if (!verification.success) {
    if (filesToUpload?.length > 0) {
      filesToUpload.forEach((file) => fs.unlinkSync(file.path));
    }
    return verification;
  }

  const currentAssetType = verification.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      
      // --- PASO A: GESTIÓN DE IMÁGENES ---
      // Si se pide borrar o se sube una nueva, eliminamos la anterior
      if ((removeExistingImage || filesToUpload?.length > 0) && currentAssetType.images.length > 0) {
        const imageToDelete = currentAssetType.images[0];
        await tx.assetTypeImage.delete({ where: { id: imageToDelete.id } });

        const imagePath = path.join(UPLOAD_DIR_ASSET_TYPES_ABSOLUTE, imageToDelete.filename);
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      }

      // Si hay archivos nuevos, creamos la relación
      if (filesToUpload?.length > 0) {
        const file = filesToUpload[0];
        const baseImageUrl = process.env.STATIC_URL_PREFIX || "";
        const UPLOAD_WEB_PATH = process.env.UPLOAD_WEB_PATH_ASSET_TYPES || "asset-types";
        const publicUrl = path.join(baseImageUrl, UPLOAD_WEB_PATH, file.filename).replace(/\\/g, "/");

        await tx.assetTypeImage.create({
          data: {
            url: publicUrl,
            filename: file.filename,
            assetTypeId: assetTypeIdInt,
            order: 0,
          },
        });
      }

      // --- PASO B: ACTUALIZAR DEFINICIONES DE CAMPO ---
      if (fieldDefinitions) {
        const incomingIds = fieldDefinitions
          .filter((fd) => fd.id && parseInt(fd.id) > 0)
          .map((fd) => parseInt(fd.id));

        // 1. Borrar campos que ya no vienen en la lista
        await tx.customFieldDefinition.deleteMany({
          where: {
            assetTypeId: assetTypeIdInt,
            id: { notIn: incomingIds },
          },
        });

        // 2. Upsert (Actualizar o Crear)
        for (const fd of fieldDefinitions) {
          const type = fd.type.toLowerCase();
          const isNumeric = type === "number" || type === "price" || type === "currency";
          
          const fieldData = {
            name: fd.name,
            type: fd.type,
            isRequired: !!fd.isRequired,
            dataListId: fd.dataListId ? parseInt(fd.dataListId) : null,
            // 🛡️ Validación de lógica de negocio: solo numéricos tienen estos flags
            isSummable: isNumeric ? !!fd.isSummable : false,
            isMonetary: isNumeric ? !!fd.isMonetary : false,
            isCountable: isNumeric ? !!fd.isCountable : false,
          };

          if (fd.id && parseInt(fd.id) > 0) {
            await tx.customFieldDefinition.update({
              where: { id: parseInt(fd.id) },
              data: fieldData,
            });
          } else {
            await tx.customFieldDefinition.create({
              data: { ...fieldData, assetTypeId: assetTypeIdInt },
            });
          }
        }
      }

      // --- PASO C: ACTUALIZAR CAMPOS PRINCIPALES ---
      return await tx.assetType.update({
        where: { id: assetTypeIdInt },
        data: {
          name: assetTypeUpdates.name,
          isSerialized: !!assetTypeUpdates.isSerialized,
          possessionFieldId: assetTypeUpdates.possessionFieldId ? parseInt(assetTypeUpdates.possessionFieldId) : null,
          desiredFieldId: assetTypeUpdates.desiredFieldId ? parseInt(assetTypeUpdates.desiredFieldId) : null,
        },
        include: {
          fieldDefinitions: { orderBy: { id: "asc" } },
          images: { orderBy: { order: "asc" } },
        },
      });
    });

    // 🚀 RETORNO CON DTO
    return {
      success: true,
      message: "Tipo de Activo actualizado con éxito.",
      data: new AssetTypeDTO(result).toJSON(),
    };

  } catch (error) {
    console.error("Error en updateAssetType:", error);
    if (filesToUpload?.length > 0) {
      filesToUpload.forEach((file) => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    }
    throw new Error("No se pudo completar la actualización del Tipo de Activo.");
  }
}

/**
 * Elimina un Tipo de Activo, sus elementos de inventario y sus imágenes asociadas.
 * @param {number} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del usuario para verificar la propiedad.
 */
async function deleteAssetType(assetTypeId, userId) {
  const assetTypeIdInt = parseInt(assetTypeId);
  if (isNaN(assetTypeIdInt)) {
    return { success: false, message: "ID de tipo de activo inválido" };
  }

  // 1. Verificar propiedad y obtener imágenes asociadas
  const assetTypeToDelete = await prisma.assetType.findUnique({
    where: { id: assetTypeIdInt },
    include: {
      container: true,
      images: true, // Incluir imágenes para el borrado físico
    },
  });

  if (!assetTypeToDelete || assetTypeToDelete.container.userId !== userId) {
    return {
      success: false,
      message: "Tipo de Activo no encontrado o acceso denegado.",
    };
  }

  // 2. BORRAR ARCHIVOS DEL DISCO (AssetType Images)
  if (assetTypeToDelete.images && assetTypeToDelete.images.length > 0) {
    for (const image of assetTypeToDelete.images) {
      // 🔑 USANDO la ruta absoluta corregida para Asset Types
      const absolutePath = path.join(
        UPLOAD_DIR_ASSET_TYPES_ABSOLUTE,
        image.filename,
      );

      try {
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath); // ¡Borra el archivo físico!
          console.log(`Successfully deleted file: ${absolutePath}`);
        }
      } catch (err) {
        console.error(`Error deleting file ${absolutePath}:`, err);
        // Si falla el borrado del archivo, no impedimos la eliminación de la DB.
      }
    }
  }

  // 3. BORRAR REGISTROS DE LA BASE DE DATOS (Transacción)
  try {
    await prisma.$transaction(async (tx) => {
      // Borrar todos los InventoryItems asociados (Esto activará el CASCADE en InventoryItemImage)
      await tx.inventoryItem.deleteMany({
        where: {
          assetTypeId: assetTypeIdInt,
          container: {
            userId: userId,
          },
        },
      });

      // Eliminar el AssetType (Esto activará el CASCADE en AssetTypeImage y CustomFieldDefinition)
      await tx.assetType.delete({
        where: { id: assetTypeIdInt },
      });
    });

    return {
      success: true,
      message: "Tipo de Activo, sus elementos y archivos eliminados con éxito.",
    };
  } catch (error) {
    console.error("Error en deleteAssetType:", error);
    throw new Error("Error al eliminar el tipo de activo y sus elementos.");
  }
}

/**
 * Elimina todos los elementos de inventario asociados a un tipo de activo (sin eliminar el AssetType).
 * @param {number} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del usuario para verificar la propiedad.
 */
async function deleteAssetTypeItems(assetTypeId, userId) {
  // 1. Convertir a Int y verificar la ID
  const id = parseInt(assetTypeId);
  if (isNaN(id)) {
    return { success: false, message: "ID de tipo de activo inválido" };
  }

  // 2. Verificar propiedad antes de eliminar
  const verification = await getAssetTypeById(id, userId);
  if (!verification.success) {
    return verification;
  }

  // 3. Borrado de Items
  try {
    // 3a. Obtener los ítems y sus imágenes ANTES de borrarlos de la DB
    const itemsToDelete = await prisma.inventoryItem.findMany({
      where: {
        assetTypeId: id,
        container: { userId: userId },
      },
      include: { images: true },
    });

    // 3b. Borrar archivos del disco para cada ítem y sus imágenes
    for (const item of itemsToDelete) {
      for (const image of item.images) {
        // Usamos el filename (asumimos que existe y fue guardado)
        const filename = path.basename(image.url);
        // 🔑 USANDO la ruta absoluta corregida para Inventory Items
        const absolutePath = path.join(UPLOAD_DIR_INVENTORY_ABSOLUTE, filename);

        try {
          if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath);
            console.log(`Successfully deleted item file: ${absolutePath}`);
          }
        } catch (err) {
          console.error(`Error deleting item file ${absolutePath}:`, err);
        }
      }
    }

    // 3c. Eliminar los registros de la base de datos (Inventario y sus imágenes por CASCADE)
    await prisma.inventoryItem.deleteMany({
      where: {
        assetTypeId: id,
        container: {
          userId: userId,
        },
      },
    });

    return {
      success: true,
      message: "Elementos del tipo de activo eliminados con éxito.",
    };
  } catch (error) {
    console.error("Error en deleteAssetTypeItems:", error);
    throw new Error("Error al eliminar los elementos del tipo de activo.");
  }
}

/**
 * Actualiza solo los campos de colección (possessionFieldId, desiredFieldId) de un AssetType.
 * @param {number} assetTypeId ID del AssetType.
 * @param {number} userId ID del usuario para verificar la propiedad.
 * @param {object} updateData Datos a actualizar ({possessionFieldId, desiredFieldId}).
 */
async function updateAssetTypeCollectionFields(
  assetTypeId,
  userId,
  updateData,
) {
  const { possessionFieldId, desiredFieldId } = updateData;

  const id = parseInt(assetTypeId);
  if (isNaN(id)) {
    return {
      success: false,
      message: "ID de tipo de activo inválido.",
    };
  }

  // Función auxiliar para parsear y validar un ID de campo
  function validateAndParseField(fieldIdInput, assetType, fieldName) {
    // Convertir a string, usar .trim() y asegurar que null/undefined se maneje
    const idString = fieldIdInput?.toString().trim();

    // 1. Si es null o cadena vacía, retorna null (para desvincular en DB)
    if (!idString || idString.length === 0) {
      return { success: true, parsedId: null };
    }

    // 2. Intentar parsear a entero
    const parsedId = parseInt(idString);

    // 3. Validar que sea un número
    if (isNaN(parsedId)) {
      return {
        success: false,
        message: `ID de campo de ${fieldName} inválido.`,
      };
    }

    // 4. Validar que el campo exista en este AssetType
    const fieldDefinition = assetType.fieldDefinitions.find(
      (f) => f.id === parsedId,
    );
    if (!fieldDefinition) {
      return {
        success: false,
        message: `El campo de ${fieldName} (ID: ${parsedId}) no existe en este Tipo de Activo.`,
      };
    }

    // 5. Validar que sea booleano
    if (fieldDefinition.type !== BOOLEAN_TYPE_DB) {
      return {
        success: false,
        message: `El campo de ${fieldName} debe ser de tipo booleano (actualmente es ${fieldDefinition.type}).`,
      };
    }

    return { success: true, parsedId: parsedId };
  }

  try {
    // 1. Verificar propiedad del AssetType y obtener datos relacionados
    const assetType = await prisma.assetType.findUnique({
      where: { id },
      include: {
        container: true,
        fieldDefinitions: true, // Crucial para la validación
      },
    });

    if (!assetType) {
      return { success: false, message: "Tipo de Activo no encontrado." };
    }

    if (assetType.container.userId !== userId) {
      return {
        success: false,
        message: "Acceso denegado: El Tipo de Activo no es de su propiedad.",
      };
    }

    // 💡 VALIDACIÓN: Los campos de colección solo aplican a tipos de activo NO seriados.
    if (assetType.isSerialized) {
      return {
        success: false,
        message:
          "Los campos de colección solo pueden asignarse a tipos de activo no seriados.",
      };
    }

    // 2. Validar y Parsear IDs de Campos

    // Campo de Posesión
    const possessionValidation = validateAndParseField(
      possessionFieldId,
      assetType,
      "posesión",
    );
    if (!possessionValidation.success) {
      return { success: false, message: possessionValidation.message };
    }
    const possessionFieldIdParsed = possessionValidation.parsedId;

    // Campo de Deseados
    const desiredValidation = validateAndParseField(
      desiredFieldId,
      assetType,
      "deseado",
    );
    if (!desiredValidation.success) {
      return { success: false, message: desiredValidation.message };
    }
    const desiredFieldIdParsed = desiredValidation.parsedId;

    // 3. Actualizar los campos de colección
    const updatedAssetType = await prisma.assetType.update({
      where: { id },
      data: {
        // 🔑 PRISMA: Usa 'null' para desvincular.
        // possessionFieldIdParsed será null o un entero.
        possessionFieldId: possessionFieldIdParsed,
        desiredFieldId: desiredFieldIdParsed,
      },
      include: {
        fieldDefinitions: true,
        images: {
          orderBy: { order: "asc" },
        },
      },
    });

    return {
      success: true,
      message: "Campos de colección actualizados con éxito.",
      data: updatedAssetType,
    };
  } catch (error) {
    console.error("Error en updateAssetTypeCollectionFields:", error);
    // Lanza un error genérico para evitar exponer detalles internos
    throw new Error(
      "Error al actualizar los campos de colección del AssetType.",
    );
  }
}

module.exports = {
  createAssetType,
  getAssetTypeById,
  updateAssetType,
  deleteAssetType,
  deleteAssetTypeItems,
  updateAssetTypeCollectionFields,
};
