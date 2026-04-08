// services/assetTypeService.js

const prisma = require("../middleware/prisma");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
const AssetTypeDTO = require("../models/assetTypeModel");
const BOOLEAN_TYPE_DB = "boolean";

// 🔑 getPublicUrl is the ONLY source of truth for building image URLs.
// Converts the disk path returned by Multer into the public URL served by Express.
// E.g.: "/app/uploads/inventory/asset-types/asset-type-123.jpg" → "/images/asset-types/asset-type-123.jpg"
const { getPublicUrl } = require("../middleware/upload");

// Absolute path to delete physical files of asset-types
const UPLOAD_BASE_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
const UPLOAD_DIR_ASSET_TYPES_ABSOLUTE = path.resolve(
  process.cwd(),
  UPLOAD_BASE_FOLDER,
  "asset-types",
);

// Absolute path to delete physical files of inventory items
const UPLOAD_DIR_INVENTORY_ABSOLUTE = path.resolve(
  process.cwd(),
  UPLOAD_BASE_FOLDER,
);

/**
 * Create a new Asset Type and its field definitions with multiple images.
 * @param {number} containerId Parent container ID.
 * @param {number} userId User ID (for the security layer).
 * @param {object} data AssetType data (name, fieldDefinitions, files, possessionFieldId, desiredFieldId).
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

  // Basic validation
  if (!name || !fieldDefinitions) {
    files.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });
    return {
      success: false,
      message: "Se requiere nombre y definiciones de campo.",
    };
  }

  // 1. Prepare images — getPublicUrl builds the correct URL from
  // the disk path assigned by Multer, without relying on additional environment variables.
  const imageRelations = files.map((file, index) => ({
    url: getPublicUrl(file.path), // ✅ "/images/asset-types/asset-type-xxx.jpg"
    filename: file.filename,
    order: index,
  }));

  // 2. Prepare definitions for Prisma with numeric type validation
  const fieldDefinitionsForPrisma = fieldDefinitions.map((def) => {
    const type = def.type.toLowerCase();
    // We consider as numeric the types that can be used for calculations
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
      // Only allow these flags if the type is numeric
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

    // 🚀 Return the DTO (toJSON is called automatically by Express when sending the Response)
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
 * gets a Tipo de Activo por ID.
 * @param {number|string} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del use for Verify the propiedad.
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

    // security: Verify that the container the AssetType belongs to is owned by the user
    if (assetType.container.userId !== userId) {
      return {
        success: false,
        message: "Acceso denegado: El Tipo de Activo no es de su propiedad.",
        data: null,
      };
    }

    // Remove sensitive data from the container before sending it
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
 * updates a Tipo de Activo and sus definiciones de campo and gestiona imágenes.
 * @param {number} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del use for Verify the propiedad.
 * @param {object} updateData data a update (name, fieldDefinitions, filesToUpload, imageIdsToDelete).
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

  // 1. Verify propiedad and existencia
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
      // if se pide borrar o se sube a new, eliminamos the anterior
      if (
        (removeExistingImage || filesToUpload?.length > 0) &&
        currentAssetType.images.length > 0
      ) {
        const imageToDelete = currentAssetType.images[0];
        await tx.assetTypeImage.delete({ where: { id: imageToDelete.id } });

        const imagePath = path.join(
          UPLOAD_DIR_ASSET_TYPES_ABSOLUTE,
          imageToDelete.filename,
        );
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      }

      // if hay archivos nuevos, Create the relación
      if (filesToUpload?.length > 0) {
        const file = filesToUpload[0];
        const publicUrl = getPublicUrl(file.path); // ✅ URL correcta sin variables de entorno adicionales

        await tx.assetTypeImage.create({
          data: {
            url: publicUrl,
            filename: file.filename,
            assetTypeId: assetTypeIdInt,
            order: 0,
          },
        });
      }

      // --- PASO B: update DEFINICIONES DE CAMPO ---
      if (fieldDefinitions) {
        const incomingIds = fieldDefinitions
          .filter((fd) => fd.id && parseInt(fd.id) > 0)
          .map((fd) => parseInt(fd.id));

        // 1. Borrar campos que ya no vienen en the lista
        await tx.customFieldDefinition.deleteMany({
          where: {
            assetTypeId: assetTypeIdInt,
            id: { notIn: incomingIds },
          },
        });

        // 2. Upsert (update o Create)
        for (const fd of fieldDefinitions) {
          const type = fd.type.toLowerCase();
          const isNumeric =
            type === "number" || type === "price" || type === "currency";

          const fieldData = {
            name: fd.name,
            type: fd.type,
            isRequired: !!fd.isRequired,
            dataListId: fd.dataListId ? parseInt(fd.dataListId) : null,
            // 🛡️ Validación de lógica de negocio: only numéricos tienen estos flags
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

      // --- PASO C: update CAMPOS PRINCIPALES ---
      // only incluimos possessionFieldId and desiredFieldId if vienen explícitamente
      // en the payload. if no vienen (undefined), Prisma the deja intactos en the DB.
      const mainUpdateData = {
        name: assetTypeUpdates.name,
        isSerialized: !!assetTypeUpdates.isSerialized,
      };
      if (assetTypeUpdates.possessionFieldId !== undefined) {
        mainUpdateData.possessionFieldId = assetTypeUpdates.possessionFieldId
          ? parseInt(assetTypeUpdates.possessionFieldId)
          : null;
      }
      if (assetTypeUpdates.desiredFieldId !== undefined) {
        mainUpdateData.desiredFieldId = assetTypeUpdates.desiredFieldId
          ? parseInt(assetTypeUpdates.desiredFieldId)
          : null;
      }

      return await tx.assetType.update({
        where: { id: assetTypeIdInt },
        data: mainUpdateData,
        include: {
          fieldDefinitions: { orderBy: { id: "asc" } },
          images: { orderBy: { order: "asc" } },
        },
      });
    });

    // 🚀 RETORNO with DTO
    return {
      success: true,
      message: "Tipo de Activo actualizado con éxito.",
      data: new AssetTypeDTO(result).toJSON(),
    };
  } catch (error) {
    console.error("Error en updateAssetType:", error);
    if (filesToUpload?.length > 0) {
      filesToUpload.forEach((file) => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
    }
    throw new Error(
      "No se pudo completar la actualización del Tipo de Activo.",
    );
  }
}

/**
 * deletes an Asset Type, its inventory items and associated images.
 * @param {number} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del use for Verify the propiedad.
 */
async function deleteAssetType(assetTypeId, userId) {
  const assetTypeIdInt = parseInt(assetTypeId);
  if (isNaN(assetTypeIdInt)) {
    return { success: false, message: "ID de tipo de activo inválido" };
  }

  // 1. Verify propiedad and get imágenes asociadas
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

  // 2. DELETE FILES FROM disk (AssetType Images)
  if (assetTypeToDelete.images && assetTypeToDelete.images.length > 0) {
    for (const image of assetTypeToDelete.images) {
      // 🔑 using the route absoluta corregida for Asset Types
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
        // if file deletion fails, do not block DB deletion.
      }
    }
  }

  // 3. BORRAR REGISTROS DE the BASE DE data (Transacción)
  try {
    await prisma.$transaction(async (tx) => {
      // Borrar todos the InventoryItems asociados (Esto activará the CASCADE en InventoryItemImage)
      await tx.inventoryItem.deleteMany({
        where: {
          assetTypeId: assetTypeIdInt,
          container: {
            userId: userId,
          },
        },
      });

      // delete the AssetType (this will trigger CASCADE on AssetTypeImage and CustomFieldDefinition)
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
 * deletes all inventory items associated with an asset type (without deleting the AssetType).
 * @param {number} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del use for Verify the propiedad.
 */
async function deleteAssetTypeItems(assetTypeId, userId) {
  // 1. Convertir a Int and Verify the ID
  const id = parseInt(assetTypeId);
  if (isNaN(id)) {
    return { success: false, message: "ID de tipo de activo inválido" };
  }

  // 2. Verify ownership before delete
  const verification = await getAssetTypeById(id, userId);
  if (!verification.success) {
    return verification;
  }

  // 3. Borrado de Items
  try {
    // 3a. get the ítems and sus imágenes ANTES de borrarlos de the DB
    const itemsToDelete = await prisma.inventoryItem.findMany({
      where: {
        assetTypeId: id,
        container: { userId: userId },
      },
      include: { images: true },
    });

    // 3b. Delete files from disk for each item and its images
    for (const item of itemsToDelete) {
      for (const image of item.images) {
        // Use the filename (asumimos que existe and fue guardado)
        const filename = path.basename(image.url);
        // 🔑 using the route absoluta corregida for Inventory Items
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

    // 3c. delete the database records (Inventory and its images via CASCADE)
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
 * updates only the campos de colección (possessionFieldId, desiredFieldId) de a AssetType.
 * @param {number} assetTypeId ID del AssetType.
 * @param {number} userId ID del use for Verify the propiedad.
 * @param {object} updateData data a update ({possessionFieldId, desiredFieldId}).
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

  // Función auxiliar for parsear and validar a ID de campo
  function validateAndParseField(fieldIdInput, assetType, fieldName) {
    // Convertir a string, Use .trim() and Ensurer que null/undefined se maneje
    const idString = fieldIdInput?.toString().trim();

    // 1. if es null o cadena vacía, retorna null (for desvincular en DB)
    if (!idString || idString.length === 0) {
      return { success: true, parsedId: null };
    }

    // 2. Intentar parsear a entero
    const parsedId = parseInt(idString);

    // 3. Validar que sea a número
    if (isNaN(parsedId)) {
      return {
        success: false,
        message: `ID de campo de ${fieldName} inválido.`,
      };
    }

    // 4. Validar que the campo exista en este AssetType
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
    if (fieldDefinition.type.toLowerCase() !== BOOLEAN_TYPE_DB.toLowerCase()) {
      return {
        success: false,
        message: `El campo de ${fieldName} debe ser de tipo booleano (actualmente es ${fieldDefinition.type}).`,
      };
    }

    return { success: true, parsedId: parsedId };
  }

  try {
    // 1. Verify propiedad del AssetType and get data relacionados
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

    // 💡 VALIDACIÓN: the campos de colección only aplican a tipos de activo NO seriados.
    if (assetType.isSerialized) {
      return {
        success: false,
        message:
          "Los campos de colección solo pueden asignarse a tipos de activo no seriados.",
      };
    }

    // 2. Validar and Parsear IDs de Campos

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

    // 3. update the campos de colección
    const updatedAssetType = await prisma.assetType.update({
      where: { id },
      data: {
        // 🔑 PRISMA: Use 'null' for desvincular.
        // possessionFieldIdParsed será null o a entero.
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
    // Lanza a error genérico for evitar exponer detalles internos
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
