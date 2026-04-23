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
  scrapers: {
    include: {
      fields: true,
    },
  },
  // Optional: if you want inventory items to also be loaded
  // NOTE: for GET /containers, loading ALL items can be very heavy.
  // It is better to load them only in getContainerById if strictly necessary, or exclude them here.
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
        throw new Error("User ID and container name are required");
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
      console.error("Error creating container:", error);
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
      console.log("Searching containers and asset types for user:", userId);

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
      console.error("Error fetching containers:", error);
      return {
        success: false,
        message: error.message || "Error fetching containers",
      };
    }
  }

  /**
   * gets a specific container by ID, verifying ownership.
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
          message: "Container not found or access denied.",
        };
      }

      return {
        success: true,
        data: container,
      };
    } catch (error) {
      console.error("Error fetching container:", error);
      return {
        success: false,
        message: error.message || "Error fetching container",
      };
    }
  }

  /**
   * updates a specific container by ID, verifying ownership.
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
          message: "No valid data provided for update.",
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
        message: "Container updated successfully",
        data: container,
      };
    } catch (error) {
      console.error("Error updating container:", error);

      if (error.code === "P2025") {
        return {
          success: false,
          message: "Container not found or access denied.",
        };
      }

      return {
        success: false,
        message: error.message || "Error updating container",
      };
    }
  }

  /**
   * deletes a specific container by ID, verifying ownership.
   * @param {number} id - ID del container a delete.
   * @param {number} userId - ID del Use propietario.
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async deleteContainer(id, userId) {
    try {
      // Prisma handles cascade deletions if configured in schema.prisma
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
      console.error("Error deleting container:", error);

      if (error.code === "P2025") {
        return {
          success: false,
          message: "Container not found or access denied.",
        };
      }
      return {
        success: false,
        message: error.message || "Error deleting container",
      };
    }
  }

  /**
   * Performs a global asset search for a specific user.
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
      console.error("Error in searchAssets:", error);
      return { success: false, message: error.message };
    }
  }
}

module.exports = new ContainerService();
