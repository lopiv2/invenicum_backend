const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Objeto de inclusión (Prisma Eager Loading)
// Define qué relaciones cargar automáticamente con el contenedor
const containerInclude = {
  assetTypes: {
    // Incluir las definiciones de campos para cada AssetType
    include: {
      fieldDefinitions: true,
    },
  },
  // Opcional: Si deseas que los items del inventario también se carguen
  items: true,
};

/**
 * Crea un nuevo contenedor para un usuario.
 * @param {number} userId - ID del usuario propietario.
 * @param {object} data - Datos del contenedor ({name, description}).
 * @returns {Promise<{success: boolean, message?: string, data?: object}>}
 */
const createContainer = async (userId, data) => {
  try {
    if (!userId || !data.name) {
      // Este error ya debería ser manejado en la capa de rutas, pero es una buena defensa.
      throw new Error(
        "Se requiere el ID de usuario y el nombre del contenedor"
      );
    }

    const container = await prisma.container.create({
      data: {
        name: data.name,
        description: data.description || "",
        userId: parseInt(userId),
      },
    });

    return {
      success: true,
      message: "Contenedor creado exitosamente",
      data: container,
    };
  } catch (error) {
    console.error("Error al crear contenedor:", error);
    return {
      success: false,
      message: error.message || "Error al crear el contenedor",
    };
  }
};

/**
 * Obtiene todos los contenedores de un usuario, incluyendo AssetTypes y FieldDefinitions.
 * @param {number} userId - ID del usuario propietario.
 * @returns {Promise<{success: boolean, message?: string, data?: object[]}>}
 */
const getContainers = async (userId) => {
  try {
    console.log(
      "Buscando contenedores y tipos de activo para usuario:",
      userId
    );

    const containers = await prisma.container.findMany({
      where: {
        userId: parseInt(userId),
      },
      // Carga Eager para AssetTypes y FieldDefinitions
      include: containerInclude,
    });

    return {
      success: true,
      data: containers,
    };
  } catch (error) {
    console.error("Error al obtener contenedores:", error);
    return {
      success: false,
      message: error.message || "Error al obtener los contenedores",
    };
  }
};

/**
 * Obtiene un contenedor específico por ID, verificando la propiedad.
 * @param {number} id - ID del contenedor.
 * @param {number} userId - ID del usuario propietario.
 * @returns {Promise<{success: boolean, message?: string, data?: object}>}
 */
const getContainerById = async (id, userId) => {
  try {
    const container = await prisma.container.findFirst({
      where: {
        id: parseInt(id),
        userId: parseInt(userId),
      },
      // Carga Eager para AssetTypes y FieldDefinitions
      include: containerInclude,
    });

    if (!container) {
      return {
        success: false,
        message: "Contenedor no encontrado o acceso denegado.",
      };
    }

    return {
      success: true,
      data: container,
    };
  } catch (error) {
    console.error("Error al obtener contenedor:", error);
    return {
      success: false,
      message: error.message || "Error al obtener el contenedor",
    };
  }
};

/**
 * Actualiza un contenedor específico por ID, verificando la propiedad.
 * @param {number} id - ID del contenedor a actualizar.
 * @param {number} userId - ID del usuario propietario.
 * @param {object} data - Datos para actualizar ({name, description}).
 * @returns {Promise<{success: boolean, message?: string, data?: object}>}
 */
const updateContainer = async (id, userId, data) => {
  try {
    const updateData = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }

    // Validación para asegurar que se está enviando algo
    if (Object.keys(updateData).length === 0) {
      return {
        success: false,
        message: "No se proporcionaron datos válidos para actualizar.",
      };
    }

    const container = await prisma.container.update({
      where: {
        id: parseInt(id),
        userId: parseInt(userId), // Mantiene la seguridad de propiedad
      },
      data: updateData,
      // Asumiendo que containerInclude está definido globalmente
      include: containerInclude,
    });

    return {
      success: true,
      message: "Contenedor actualizado exitosamente",
      data: container,
    };
  } catch (error) {
    console.error("Error al actualizar contenedor:", error);

    // Manejar el error de "registro no encontrado para actualización"
    if (error.code === "P2025") {
      return {
        success: false,
        message: "Contenedor no encontrado o acceso denegado.",
      };
    }

    return {
      success: false,
      message: error.message || "Error al actualizar el contenedor",
    };
  }
};

/**
 * Elimina un contenedor específico por ID, verificando la propiedad.
 * @param {number} id - ID del contenedor a eliminar.
 * @param {number} userId - ID del usuario propietario.
 * @returns {Promise<{success: boolean, message?: string, data?: object}>}
 */
const deleteContainer = async (id, userId) => {
  try {
    // Prisma maneja las eliminaciones en cascada si están configuradas en schema.prisma
    const container = await prisma.container.delete({
      where: {
        id: parseInt(id),
        userId: parseInt(userId),
      },
    });

    return {
      success: true,
      message: "Contenedor eliminado exitosamente",
      data: container,
    };
  } catch (error) {
    console.error("Error al eliminar contenedor:", error);
    // Manejar el error de "registro no encontrado para eliminación"
    if (error.code === "P2025") {
      return {
        success: false,
        message: "Contenedor no encontrado o acceso denegado.",
      };
    }
    return {
      success: false,
      message: error.message || "Error al eliminar el contenedor",
    };
  }
};

module.exports = {
  createContainer,
  getContainers,
  getContainerById,
  updateContainer,
  deleteContainer,
};
