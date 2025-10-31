// services/assetTypeService.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// 💡 CONFIGURACIÓN DE RUTAS FÍSICAS BASADAS EN .env
const UPLOAD_BASE_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
const ASSET_TYPES_SUBDIR =
  process.env.UPLOAD_FOLDER_ASSET_TYPES_SUBDIR || "asset-types";

// 🔑 RUTA ABSOLUTA para las imágenes de Asset Types (e.g., ../uploads/inventory/asset-types)
const UPLOAD_DIR_ASSET_TYPES_ABSOLUTE = path.join(
  __dirname,
  "..",
  UPLOAD_BASE_FOLDER,
  ASSET_TYPES_SUBDIR
);

// 🔑 RUTA ABSOLUTA para las imágenes de Inventory Items (e.g., ../uploads/inventory)
const UPLOAD_DIR_INVENTORY_ABSOLUTE = path.join(
  __dirname,
  "..",
  UPLOAD_BASE_FOLDER
);

/**
 * Crea un nuevo Tipo de Activo y sus definiciones de campo con múltiples imágenes.
 * @param {number} containerId ID del contenedor padre.
 * @param {number} userId ID del usuario (para la capa de seguridad).
 * @param {object} data Datos del AssetType (name, fieldDefinitions, files).
 */
async function createAssetType(containerId, userId, data) {
  const { name, fieldDefinitions } = data;
  const files = data.files || [];

  if (!name || !fieldDefinitions) {
    // Si falla, limpia todos los archivos subidos
    files.forEach((file) => fs.unlinkSync(file.path));
    return {
      success: false,
      message: "Se requiere nombre y definiciones de campo.",
    };
  }

  // 1. Preparar las relaciones de imágenes
  const baseImageUrl = process.env.STATIC_URL_PREFIX || ""; // /images
  const UPLOAD_WEB_PATH =
    process.env.UPLOAD_WEB_PATH_ASSET_TYPES || ASSET_TYPES_SUBDIR; // asset-types

  const imageRelations = files.map((file, index) => {
    // La URL resultante será: /images/asset-types/filename.jpg
    const publicUrl = path
      .join(baseImageUrl, UPLOAD_WEB_PATH, file.filename)
      .replace(/\\/g, "/");
    return {
      url: publicUrl,
      filename: file.filename, // Guardar el nombre del archivo para el borrado físico
      order: index,
    };
  });

  // Convertir las definiciones de campo para el formato 'create' de Prisma.
  const fieldDefinitionsForPrisma = fieldDefinitions.map((def) => {
    // Aseguramos que los valores sean booleanos (o 'false' si no están presentes)
    const isSummableInput = !!def.isSummable;
    const isNumeric =
      def.type === "number" || def.type === "currency" || def.type === "número";

    return {
      name: def.name,
      type: def.type,
      isRequired: !!def.isRequired,
      dataListId: def.dataListId || null,

      // 🚀 ¡NUEVOS CAMPOS INCLUIDOS Y VALIDADOS!
      // isSummable solo se permite si el tipo de campo es numérico.
      isSummable: isNumeric ? isSummableInput : false,
    };
  });

  try {
    const newAssetType = await prisma.assetType.create({
      data: {
        name,
        containerId,
        fieldDefinitions: {
          create: fieldDefinitionsForPrisma,
        },
        images: {
          create: imageRelations,
        },
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
      data: newAssetType,
      message: "Tipo de Activo creado con éxito.",
    };
  } catch (error) {
    console.error("Prisma Error en createAssetType:", error);
    // Limpieza de archivos en caso de error de DB
    files.forEach((file) => fs.unlinkSync(file.path));
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
    ...assetTypeUpdates
  } = updateData;

  const assetTypeIdInt = parseInt(assetTypeId);
  if (isNaN(assetTypeIdInt)) {
    throw new Error("ID de tipo de activo inválido.");
  }

  // 1. Verificar propiedad y obtener la información actual
  const verification = await getAssetTypeById(assetTypeIdInt, userId, {
    include: { images: true, fieldDefinitions: true },
  });

  if (!verification.success) {
    if (filesToUpload && filesToUpload.length > 0) {
      filesToUpload.forEach((file) => fs.unlinkSync(file.path));
    }
    return verification;
  }

  const currentAssetType = verification.data;

  // ===========================================
  // PASO D: EJECUTAR TODA LA LÓGICA DENTRO DE UNA ÚNICA TRANSACCIÓN
  // ===========================================

  let updatedAssetType;
  try {
    // 🔑 USAMOS UNA ÚNICA FUNCIÓN ASÍNCRONA PARA MANEJAR LA SECUENCIA DE PASOS
    await prisma.$transaction(async (tx) => {
      let imageWasReplaced = false;

      // --- PASO A: ELIMINACIÓN DE IMAGEN EXISTENTE (Si se pidió explícitamente) ---
      if (removeExistingImage && currentAssetType.images.length > 0) {
        const imageToDelete = currentAssetType.images[0];

        // Eliminar la referencia de la base de datos
        await tx.assetTypeImage.delete({ where: { id: imageToDelete.id } });

        // Eliminación del disco (debe ser SÍNCRONA y fuera del alcance de tx)
        // NOTA: Es seguro hacer esto aquí porque si la transacción falla más tarde,
        // la eliminación de la DB se revierte, pero la eliminación de disco NO.
        // Se asume que la posibilidad de falla en la DB es mayor que el riesgo de error de disco.
        try {
          const imagePath = path.join(
            UPLOAD_DIR_ASSET_TYPES_ABSOLUTE,
            imageToDelete.filename
          );
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
        } catch (err) {
          console.error(
            `Error deleting file from disk ${imageToDelete.filename}:`,
            err
          );
        }
      }

      // --- PASO C-PRE: REEMPLAZO DE IMAGEN (Si se sube una nueva) ---
      if (filesToUpload && filesToUpload.length > 0) {
        imageWasReplaced = true;

        // 1. Borrar imagen antigua si existe y NO se borró ya en el PASO A
        if (!removeExistingImage && currentAssetType.images.length > 0) {
          const oldImage = currentAssetType.images[0];

          // Eliminar la referencia de la base de datos
          await tx.assetTypeImage.delete({ where: { id: oldImage.id } });

          // Eliminación del disco (Sincrónico)
          try {
            const imagePath = path.join(
              UPLOAD_DIR_ASSET_TYPES_ABSOLUTE,
              oldImage.filename
            );
            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath);
            }
          } catch (err) {
            console.error(
              `Error deleting old file from disk ${oldImage.filename}:`,
              err
            );
          }
        }

        // 2. Crear la nueva imagen
        const file = filesToUpload[0];
        const baseImageUrl = process.env.STATIC_URL_PREFIX || "";
        const UPLOAD_WEB_PATH =
          process.env.UPLOAD_WEB_PATH_ASSET_TYPES || ASSET_TYPES_SUBDIR;

        const publicUrl = path
          .join(baseImageUrl, UPLOAD_WEB_PATH, file.filename)
          .replace(/\\/g, "/");

        await tx.assetTypeImage.create({
          data: {
            url: publicUrl,
            filename: file.filename,
            assetTypeId: assetTypeIdInt,
            order: 0,
          },
        });
      }

      // --- PASO B: ACTUALIZAR EL TIPO DE ACTIVO PRINCIPAL Y SUS DEFINICIONES DE CAMPO ---
      if (fieldDefinitions) {
        // Borrar todas las definiciones de campo antiguas
        await tx.customFieldDefinition.deleteMany({
          where: { assetTypeId: assetTypeIdInt },
        });

        // Crear las nuevas definiciones
        const fieldDefinitionsForPrisma = fieldDefinitions.map((def) => ({
          name: def.name,
          type: def.type,
          isRequired: def.isRequired,
          isSummable: def.isSummable,
          isCountable: def.isCountable,
          dataListId: def.dataListId || null,
          assetTypeId: assetTypeIdInt,
        }));

        await tx.customFieldDefinition.createMany({
          data: fieldDefinitionsForPrisma,
        });
      }

      // Actualizar los campos principales de AssetType
      return tx.assetType.update({
        where: { id: assetTypeIdInt },
        data: assetTypeUpdates,
        select: { id: true }, // Solo necesitamos el ID para el findUnique final
      });
    }); // Fin de la transacción

    // Obtener el resultado final con todas las relaciones actualizadas
    updatedAssetType = await prisma.assetType.findUnique({
      where: { id: assetTypeIdInt },
      include: {
        fieldDefinitions: { orderBy: { id: "asc" } },
        images: { orderBy: { order: "asc" } },
      },
    });

    if (!updatedAssetType) {
      throw new Error("Asset Type not found after update transaction.");
    }
  } catch (error) {
    console.error("Prisma Error en updateAssetType:", error);

    // Limpiar archivos subidos si la DB falla
    if (filesToUpload && filesToUpload.length > 0) {
      filesToUpload.forEach((file) => fs.unlinkSync(file.path));
    }
    throw new Error(
      "Error al actualizar el Tipo de Activo en la base de datos."
    );
  }

  return {
    success: true,
    data: updatedAssetType,
    message: "Tipo de Activo actualizado con éxito.",
  };
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
        image.filename
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

module.exports = {
  createAssetType,
  getAssetTypeById,
  updateAssetType,
  deleteAssetType,
  deleteAssetTypeItems,
};
