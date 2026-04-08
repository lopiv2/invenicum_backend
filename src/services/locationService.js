const prisma = require("../middleware/prisma");

// Base inclusion: Optionally you can load children if the frontend requires it for the tree view.
const LOCATION_INCLUDE = {
  // children: true, // Descomentar if necesitas cargar hijos en the listas principales
};

class LocationService {
  /**
   * Create a new location.
   * The property (userId) is verified through the containerId.
   * @param {number} userId - Owner user ID (for security check).
   * @param {object} data - Location data ({container_id, name, description, parent_id}).
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async createLocation(userId, data) {
    try {
      if (!userId || !data.container_id || !data.name) {
        throw new Error(
          "Se requiere el ID de usuario, container_id y name para crear la ubicación."
        );
      }

      // 1. Verify if the container exists and belongs to the user (security)
      const container = await prisma.container.findFirst({
        where: {
          id: parseInt(data.container_id),
          userId: parseInt(userId),
        },
      });

      if (!container) {
        return {
          success: false,
          message: "Container not found or access denied.",
        };
      }

      // 2. Create the location
      const location = await prisma.location.create({
        data: {
          name: data.name,
          description: data.description || "",
          containerId: parseInt(data.container_id),
          // Use 'parentId' (mapped to 'parent_id' in the DB)
          parentId: data.parent_id ? parseInt(data.parent_id) : null,
        },
        include: LOCATION_INCLUDE,
      });

      return {
        success: true,
        message: "Ubicación creada exitosamente",
        data: location,
      };
    } catch (error) {
      console.error("Error al crear ubicación:", error);
      
      // Specific handling if parentId does not exist (Foreign Key constraint)
      if (error.code === "P2003" && error.meta?.field_name.includes("parentId")) {
        return {
          success: false,
          message: "The parent location ID is not valid.",
        };
      }
      
      return {
        success: false,
        message: error.message || "Error creating location",
      };
    }
  }

  /**
   * Gets all locations of a specific container.
   * @param {number} containerId - Container ID.
   * @param {number} userId - Owner user ID.
   * @returns {Promise<{success: boolean, message?: string, data?: object[]}>}
   */
  async getLocations(containerId, userId) {
    try {
      // 1. Verify the propiedad del container es suficiente for the security
      const container = await prisma.container.findFirst({
        where: {
          id: parseInt(containerId),
          userId: parseInt(userId),
        },
      });

      if (!container) {
        return {
          success: false,
          message: "Contenedor no encontrado o acceso denegado.",
        };
      }

      // 2. get the locations
      const locations = await prisma.location.findMany({
        where: {
          containerId: parseInt(containerId),
        },
        include: LOCATION_INCLUDE,
        // Optional: Sort to ease building the tree in the frontend
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      });

      return {
        success: true,
        data: locations,
      };
    } catch (error) {
      console.error(`Error al obtener ubicaciones para el contenedor ${containerId}:`, error);
      return {
        success: false,
        message: error.message || "Error al obtener las ubicaciones",
      };
    }
  }

  /**
   * gets a location específica por ID, verificando the propiedad a través del container.
   * @param {number} id - ID de the location.
   * @param {number} userId - ID del Use propietario.
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async getLocationById(id, userId) {
    try {
      const location = await prisma.location.findFirst({
        where: {
          id: parseInt(id),
          // Security filter: the container must belong to the user
          container: {
            userId: parseInt(userId),
          },
        },
        include: LOCATION_INCLUDE,
      });

      if (!location) {
        return {
          success: false,
          message: "Ubicación no encontrada o acceso denegado.",
        };
      }

      return {
        success: true,
        data: location,
      };
    } catch (error) {
      console.error("Error al obtener ubicación:", error);
      return {
        success: false,
        message: error.message || "Error al obtener la ubicación",
      };
    }
  }

  /**
   * updates a location específica por ID.
   * @param {number} id - ID de the location a update.
   * @param {number} userId - ID del Use propietario.
   * @param {object} data - data for update ({name, description, parent_id}).
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async updateLocation(id, userId, data) {
    try {
      const updateData = {};

      if (data.name !== undefined) {
        updateData.name = data.name;
      }
      if (data.description !== undefined) {
        updateData.description = data.description;
      }
      if (data.parent_id !== undefined) {
        updateData.parentId = data.parent_id ? parseInt(data.parent_id) : null;
      }

      if (Object.keys(updateData).length === 0) {
        return {
          success: false,
          message: "No se proporcionaron datos válidos para actualizar.",
        };
      }
      
      const location = await prisma.location.update({
        where: {
          id: parseInt(id),
          // Security filter: only update if the container belongs to the user
          container: {
            userId: parseInt(userId), 
          },
        },
        data: updateData,
        include: LOCATION_INCLUDE,
      });

      return {
        success: true,
        message: "Ubicación actualizada exitosamente",
        data: location,
      };
    } catch (error) {
      console.error("Error al actualizar ubicación:", error);

      if (error.code === "P2025") {
        return {
          success: false,
          message: "Ubicación no encontrada o acceso denegado.",
        };
      }
      if (error.code === "P2003") {
        return {
          success: false,
          message: "El ID de la ubicación padre proporcionado no es válido.",
        };
      }

      return {
        success: false,
        message: error.message || "Error al actualizar la ubicación",
      };
    }
  }

  /**
   * deletes a location específica por ID.
   * @param {number} id - ID de the location a delete.
   * @param {number} userId - ID del Use propietario.
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async deleteLocation(id, userId) {
    try {
      // 1. use deleteMany to verify ownership in the WHERE clause
      const result = await prisma.location.deleteMany({
        where: {
          id: parseInt(id),
          container: {
            userId: parseInt(userId),
          },
        },
      });

      if (result.count === 0) {
        return {
          success: false,
          message: "Ubicación no encontrada o acceso denegado.",
        };
      }

      return {
        success: true,
        message: "Ubicación eliminada exitosamente",
      };
    } catch (error) {
      console.error("Error al eliminar ubicación:", error);
      
      // P2003 puede ocurrir if the location tiene ítems o hijos (if no hay onDelete:Cascade en the jerarquía)
      if (error.code === "P2003") {
         return {
          success: false,
          message: "Location cannot be deleted because it still contains inventory items or child locations.",
        };
      }

      return {
        success: false,
        message: error.message || "Error al eliminar la ubicación",
      };
    }
  }
}

module.exports = new LocationService();
