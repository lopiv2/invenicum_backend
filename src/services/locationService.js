const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Inclusión base: Opcionalmente puedes cargar los hijos si el frontend lo requiere para la vista de árbol.
const LOCATION_INCLUDE = {
  // children: true, // Descomentar si necesitas cargar hijos en las listas principales
};

class LocationService {
  /**
   * Crea una nueva ubicación.
   * La propiedad (userId) se verifica a través del containerId.
   * @param {number} userId - ID del usuario propietario (para verificación de seguridad).
   * @param {object} data - Datos de la ubicación ({container_id, name, description, parent_id}).
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async createLocation(userId, data) {
    try {
      if (!userId || !data.container_id || !data.name) {
        throw new Error(
          "Se requiere el ID de usuario, container_id y name para crear la ubicación."
        );
      }

      // 1. Verificar si el contenedor existe y pertenece al usuario (Seguridad)
      const container = await prisma.container.findFirst({
        where: {
          id: parseInt(data.container_id),
          userId: parseInt(userId),
        },
      });

      if (!container) {
        return {
          success: false,
          message: "Contenedor no encontrado o acceso denegado.",
        };
      }

      // 2. Crear la ubicación
      const location = await prisma.location.create({
        data: {
          name: data.name,
          description: data.description || "",
          containerId: parseInt(data.container_id),
          // Usamos 'parentId' (mapeado a 'parent_id' en la DB)
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
      
      // Manejo específico si el parentId no existe (Foreign Key constraint)
      if (error.code === "P2003" && error.meta?.field_name.includes("parentId")) {
        return {
          success: false,
          message: "El ID de la ubicación padre no es válido.",
        };
      }
      
      return {
        success: false,
        message: error.message || "Error al crear la ubicación",
      };
    }
  }

  /**
   * Obtiene todas las ubicaciones de un contenedor específico.
   * @param {number} containerId - ID del contenedor.
   * @param {number} userId - ID del usuario propietario.
   * @returns {Promise<{success: boolean, message?: string, data?: object[]}>}
   */
  async getLocations(containerId, userId) {
    try {
      // 1. Verificar la propiedad del contenedor es suficiente para la seguridad
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

      // 2. Obtener las ubicaciones
      const locations = await prisma.location.findMany({
        where: {
          containerId: parseInt(containerId),
        },
        include: LOCATION_INCLUDE,
        // Opcional: Ordenar para facilitar la construcción del árbol en el frontend
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
   * Obtiene una ubicación específica por ID, verificando la propiedad a través del contenedor.
   * @param {number} id - ID de la ubicación.
   * @param {number} userId - ID del usuario propietario.
   * @returns {Promise<{success: boolean, message?: string, data?: object}>}
   */
  async getLocationById(id, userId) {
    try {
      const location = await prisma.location.findFirst({
        where: {
          id: parseInt(id),
          // Filtro de seguridad: el contenedor debe pertenecer al usuario
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
   * Actualiza una ubicación específica por ID.
   * @param {number} id - ID de la ubicación a actualizar.
   * @param {number} userId - ID del usuario propietario.
   * @param {object} data - Datos para actualizar ({name, description, parent_id}).
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
          // Filtro de seguridad: solo actualiza si el contenedor es del usuario
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
   * Elimina una ubicación específica por ID.
   * @param {number} id - ID de la ubicación a eliminar.
   * @param {number} userId - ID del usuario propietario.
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async deleteLocation(id, userId) {
    try {
      // 1. Usar deleteMany para verificar la propiedad en el WHERE
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
      
      // P2003 puede ocurrir si la ubicación tiene ítems o hijos (si no hay onDelete:Cascade en la jerarquía)
      if (error.code === "P2003") {
         return {
          success: false,
          message: "No se puede eliminar la ubicación porque aún contiene activos del inventario o ubicaciones hijas.",
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