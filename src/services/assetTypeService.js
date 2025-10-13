// services/assetTypeService.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Importamos el servicio de contenedores para la verificación de propiedad
const containerService = require("./containerService");

/**
 * Crea un nuevo Tipo de Activo y sus definiciones de campo.
 * @param {number} containerId ID del contenedor padre.
 * @param {number} userId ID del usuario (para la capa de seguridad, aunque el router ya validó la propiedad del contenedor).
 * @param {object} data Datos del AssetType (name, imageUrl, fieldDefinitions).
 */
async function createAssetType(containerId, userId, data) {
  const { name, imageUrl, fieldDefinitions } = data;

  if (!name || !fieldDefinitions) {
    return {
      success: false,
      message: "Se requiere nombre y definiciones de campo.",
    };
  }

  // Convertir las definiciones de campo para el formato 'createMany' o 'create' de Prisma.
  // Esto asegura que cada campo se asocie correctamente con el AssetType que se va a crear.
  const fieldDefinitionsForPrisma = fieldDefinitions.map((def) => ({
    name: def.name,
    type: def.type,
    isRequired: def.isRequired,
    dataListId: def.dataListId || null,
  }));

  try {
    const newAssetType = await prisma.assetType.create({
      data: {
        name,
        imageUrl,
        containerId,
        fieldDefinitions: {
          create: fieldDefinitionsForPrisma,
        },
      },
      include: {
        fieldDefinitions: true,
      },
    });

    return {
      success: true,
      data: newAssetType,
      message: "Tipo de Activo creado con éxito.",
    };
  } catch (error) {
    console.error("Prisma Error en createAssetType:", error);
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
      include: { container: true, fieldDefinitions: true },
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
 * Actualiza un Tipo de Activo y sus definiciones de campo.
 * @param {number} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del usuario para verificar la propiedad.
 * @param {object} updateData Datos a actualizar (name, imageUrl, fieldDefinitions, etc.).
 */
async function updateAssetType(assetTypeId, userId, updateData) {
  const { fieldDefinitions, ...assetTypeUpdates } = updateData;

  // 1. Verificar propiedad antes de actualizar
  const verification = await getAssetTypeById(assetTypeId, userId);
  if (!verification.success) {
    return verification; // Devuelve el error de 404 o acceso denegado
  }

  // Lógica compleja de actualización de campos anidados (transacción)
  try {
    const result = await prisma.$transaction(async (prisma) => {
      // Si hay nuevas definiciones de campo, necesitamos borrar las antiguas y crear las nuevas
      if (fieldDefinitions) {
        // 1. Borrar todas las definiciones de campo antiguas
        await prisma.customFieldDefinition.deleteMany({
          where: { assetTypeId: assetTypeId },
        });

        // 2. Crear las nuevas definiciones
        const fieldDefinitionsForPrisma = fieldDefinitions.map((def) => ({
          name: def.name,
          type: def.type,
          isRequired: def.isRequired,
          dataListId: def.dataListId || null,
          assetTypeId: assetTypeId, // Asegurar que el ID se asigna
        }));

        await prisma.customFieldDefinition.createMany({
          data: fieldDefinitionsForPrisma,
        });
      }

      // 3. Actualizar los campos principales de AssetType
      const updatedAssetType = await prisma.assetType.update({
        where: { id: assetTypeId },
        data: assetTypeUpdates,
        include: { fieldDefinitions: true },
      });

      return updatedAssetType;
    });

    return {
      success: true,
      data: result,
      message: "Tipo de Activo actualizado con éxito.",
    };
  } catch (error) {
    console.error("Prisma Error en updateAssetType:", error);
    throw new Error(
      "Error al actualizar el Tipo de Activo en la base de datos."
    );
  }
}

/**
 * Elimina todos los elementos asociados a un tipo de activo.
 * @param {number} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del usuario para verificar la propiedad.
 */
async function deleteAssetTypeItems(assetTypeId, userId) {
  // 1. Verificar propiedad antes de eliminar
  const verification = await getAssetTypeById(assetTypeId, userId);
  if (!verification.success) {
    return verification;
  }

  try {
    const id = parseInt(assetTypeId);
    if (isNaN(id)) {
      return { success: false, message: "ID de tipo de activo inválido" };
    }

    // Eliminar todos los InventoryItems asociados al AssetType
    await prisma.inventoryItem.deleteMany({
      where: { 
        assetTypeId: id,
        container: {
          userId: userId
        }
      }
    });

    return { success: true, message: "Elementos del tipo de activo eliminados con éxito." };
  } catch (error) {
    console.error("Error en deleteAssetTypeItems:", error);
    throw new Error("Error al eliminar los elementos del tipo de activo.");
  }
}

/**
 * Elimina un Tipo de Activo.
 * @param {number} assetTypeId ID del Tipo de Activo.
 * @param {number} userId ID del usuario para verificar la propiedad.
 */
async function deleteAssetType(assetTypeId, userId) {
  // 1. Verificar propiedad antes de eliminar
  const verification = await getAssetTypeById(assetTypeId, userId);
  if (!verification.success) {
    return verification;
  }

  try {
    const id = parseInt(assetTypeId);
    if (isNaN(id)) {
      return { success: false, message: "ID de tipo de activo inválido" };
    }

    // Realizamos todas las operaciones en una transacción
    await prisma.$transaction(async (tx) => {
      // 1. Primero eliminamos todos los InventoryItems asociados
      await tx.inventoryItem.deleteMany({
        where: { 
          assetTypeId: id,
          container: {
            userId: userId
          }
        }
      });

      // 2. Luego eliminamos el AssetType y sus CustomFieldDefinitions (cascade)
      await tx.assetType.delete({
        where: { id }
      });
    });

    return { success: true, message: "Tipo de Activo y sus elementos eliminados con éxito." };
  } catch (error) {
    console.error("Error en deleteAssetType:", error);
    throw new Error("Error al eliminar el tipo de activo y sus elementos.");
  }
}

module.exports = {
  createAssetType,
  getAssetTypeById,
  updateAssetType,
  deleteAssetType,
  deleteAssetTypeItems,
};
