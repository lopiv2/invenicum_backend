const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Objeto de inclusión (Prisma Eager Loading)
// Define qué relaciones cargar automáticamente con el contenedor
const CONTAINER_INCLUDE = {
  assetTypes: {
    // Incluir las definiciones de campos para cada AssetType
    include: {
      fieldDefinitions: true,
      images: true,
    },
  },
  // Opcional: Si deseas que los items del inventario también se carguen
  // NOTA: Para GET /containers, cargar TODOS los ítems puede ser muy pesado.
  // Es mejor cargarlos solo en getContainerById si es estrictamente necesario, o excluirlos aquí.
  items: false,
};

class ContainerService {
  /**
   * Crea un nuevo contenedor para un usuario.
   * @param {number} userId - ID del usuario propietario.
   * @param {object} data - Datos del contenedor ({name, description, isCollection}).
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async createContainer(userId, data) {
    try {
      if (!userId || !data.name) {
        throw new Error(
          "Se requiere el ID de usuario y el nombre del contenedor",
        );
      }

      const container = await prisma.container.create({
        data: {
          name: data.name,
          description: data.description || "",
          isCollection: data.isCollection || false,
          userId: parseInt(userId),
        },
        // Incluir relaciones para devolver datos completos
        include: CONTAINER_INCLUDE,
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
  }

  /**
   * Obtiene todos los contenedores de un usuario, incluyendo AssetTypes y FieldDefinitions.
   * @param {number} userId - ID del usuario propietario.
   * @returns {Promise<{success: boolean, message?: string, data?: object[]}>}
   */
  async getContainers(userId) {
    try {
      console.log(
        "Buscando contenedores y tipos de activo para usuario:",
        userId,
      );

      const containers = await prisma.container.findMany({
        where: {
          userId: parseInt(userId),
        },
        // Carga Eager para AssetTypes y FieldDefinitions
        include: CONTAINER_INCLUDE,
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
  }

  /**
   * Obtiene un contenedor específico por ID, verificando la propiedad.
   * @param {number} id - ID del contenedor.
   * @param {number} userId - ID del usuario propietario.
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async getContainerById(id, userId) {
    try {
      const container = await prisma.container.findFirst({
        where: {
          id: parseInt(id),
          userId: parseInt(userId),
        },
        // Carga Eager para AssetTypes y FieldDefinitions
        include: CONTAINER_INCLUDE,
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
  }

  /**
   * Actualiza un contenedor específico por ID, verificando la propiedad.
   * @param {number} id - ID del contenedor a actualizar.
   * @param {number} userId - ID del usuario propietario.
   * @param {object} data - Datos para actualizar ({name, description}).
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async updateContainer(id, userId, data) {
    try {
      const updateData = {};

      if (data.name !== undefined) {
        updateData.name = data.name;
      }
      if (data.description !== undefined) {
        updateData.description = data.description;
      }

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
        include: CONTAINER_INCLUDE,
      });

      return {
        success: true,
        message: "Contenedor actualizado exitosamente",
        data: container,
      };
    } catch (error) {
      console.error("Error al actualizar contenedor:", error);

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
  }

  /**
   * Elimina un contenedor específico por ID, verificando la propiedad.
   * @param {number} id - ID del contenedor a eliminar.
   * @param {number} userId - ID del usuario propietario.
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async deleteContainer(id, userId) {
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
  }

  /**
   * Realiza una búsqueda global de activos para un usuario específico.
   * @param {number} userId - ID del usuario.
   * @param {string} query - Texto a buscar.
   */
  async searchAssets(userId, query) {
    try {
      const assets = await prisma.inventoryItem.findMany({
        where: {
          container: {
            userId: parseInt(userId),
          },
          OR: [
            { name: { contains: query } }, // MySQL ya es insensitive por defecto
          ],
        },
        include: {
          container: {
            select: { name: true, id: true },
          },
          assetType: {
            select: { id: true },
          },
        },
        take: 10,
      });

      const formattedAssets = assets.map((item) => ({
        id: item.id,
        name: item.name,
        container_id: item.containerId,
        container_name: item.container.name,
        asset_type_id: item.assetTypeId,
      }));

      return {
        success: true,
        data: formattedAssets,
      };
    } catch (error) {
      console.error("Error en searchAssets:", error);
      return { success: false, message: error.message };
    }
  }
}

module.exports = new ContainerService();
