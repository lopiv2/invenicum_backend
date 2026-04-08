const prisma = require("../middleware/prisma");

// Inclusion object (Prisma Eager Loading)
// Defines which relations to automatically load with the container
const CONTAINER_INCLUDE = {
  assetTypes: {
    // Include field definitions for each AssetType
    include: {
      fieldDefinitions: true,
      images: true,
    },
  },
  // Optional: if you want inventory items to also be loaded
  // NOTE: for GET /containers, loading ALL items can be very heavy.
  // It is better to load them only in getContainerById if strictly necessary, or exclude them here.
  items: false,
};

class ContainerService {
  /**
   * Create a new container for a user.
   * @param {number} userId - Owner user ID.
   * @param {object} data - Container data ({name, description, isCollection}).
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
        // Include relations to return complete data
        include: CONTAINER_INCLUDE,
      });

      return {
        success: true,
        message: "Container created successfully",
        data: container,
      };
    } catch (error) {
      console.error("Error al crear contenedor:", error);
      return {
        success: false,
        message: error.message || "Error creating container",
      };
    }
  }

  /**
   * Gets all containers of a user, including AssetTypes and FieldDefinitions.
   * @param {number} userId - Owner user ID.
   * @returns {Promise<{success: boolean, message?: string, data?: object[]}>}
   */
  async getContainers(userId) {
    try {
      console.log(
        "Searching containers and asset types for user:",
        userId,
      );

      const containers = await prisma.container.findMany({
        where: {
          userId: parseInt(userId),
        },
        // Carga Eager for AssetTypes and FieldDefinitions
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
   * gets a container específico por ID, verificando the propiedad.
   * @param {number} id - ID del container.
   * @param {number} userId - ID del Use propietario.
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async getContainerById(id, userId) {
    try {
      const container = await prisma.container.findFirst({
        where: {
          id: parseInt(id),
          userId: parseInt(userId),
        },
        // Carga Eager for AssetTypes and FieldDefinitions
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
   * updates a container específico por ID, verificando the propiedad.
   * @param {number} id - ID del container a update.
   * @param {number} userId - ID del Use propietario.
   * @param {object} data - data for update ({name, description}).
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
   * deletes a container específico por ID, verificando the propiedad.
   * @param {number} id - ID del container a delete.
   * @param {number} userId - ID del Use propietario.
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async deleteContainer(id, userId) {
    try {
      // Prisma maneja the eliminaciones en cascada if están configuradas en schema.prisma
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
   * Realiza a búsqueda global de activos for a Use específico.
   * @param {number} userId - ID del Use.
   * @param {string} query - Texto a Search.
   */
  async searchAssets(userId, query) {
    try {
      const assets = await prisma.inventoryItem.findMany({
        where: {
          container: {
            userId: parseInt(userId),
          },
          OR: [
            { name: { contains: query } }, // MySQL ya es insensitive by default
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
