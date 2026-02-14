const prisma = require("../middleware/prisma");

class DataListService {
  async getDataListsByContainer(containerId, userId) {
    try {
      // Verificar que el usuario tenga acceso al contenedor
      const container = await prisma.container.findFirst({
        where: {
          id: containerId,
          userId: userId
        }
      });

      if (!container) {
        return {
          success: false,
          message: "Contenedor no encontrado o acceso denegado"
        };
      }

      // Obtener todas las listas del contenedor
      const dataLists = await prisma.dataList.findMany({
        where: {
          containerId: containerId
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return {
        success: true,
        data: dataLists.map(list => ({
          id: list.id,
          name: list.name,
          description: list.description,
          items: list.items,
          created_at: list.createdAt,
          updated_at: list.updatedAt
        }))
      };
    } catch (error) {
      console.error("Error obteniendo listas de datos:", error);
      throw new Error("Error al obtener las listas de datos");
    }
  }
  async createDataList(containerId, userId, data) {
    try {
      // Verificar que el usuario tenga acceso al contenedor
      const container = await prisma.container.findFirst({
        where: {
          id: containerId,
          userId: userId
        }
      });

      if (!container) {
        return {
          success: false,
          message: "Contenedor no encontrado o acceso denegado"
        };
      }

      // Crear la lista de datos
      const dataList = await prisma.dataList.create({
        data: {
          name: data.name,
          description: data.description,
          items: data.items, // Prisma automáticamente convierte el array a JSON
          container: {
            connect: {
              id: containerId
            }
          }
        }
      });

      return {
        success: true,
        data: {
          id: dataList.id,
          name: dataList.name,
          description: dataList.description,
          items: dataList.items,
          created_at: dataList.createdAt,
          updated_at: dataList.updatedAt
        }
      };
    } catch (error) {
      console.error("Error creando lista de datos:", error);
      throw new Error("Error al crear la lista de datos");
    }
  }

  async getDataList(id, userId) {
    try {
      const dataList = await prisma.dataList.findFirst({
        where: {
          id: id,
          container: {
            userId: userId
          }
        }
      });

      if (!dataList) {
        return {
          success: false,
          message: "Lista de datos no encontrada o acceso denegado"
        };
      }

      return {
        success: true,
        data: {
          id: dataList.id,
          name: dataList.name,
          description: dataList.description,
          items: dataList.items,
          created_at: dataList.createdAt,
          updated_at: dataList.updatedAt
        }
      };
    } catch (error) {
      console.error("Error obteniendo lista de datos:", error);
      throw new Error("Error al obtener la lista de datos");
    }
  }

  async updateDataList(id, userId, data) {
    try {
      // Verificar que el usuario tenga acceso a la lista
      const existingList = await prisma.dataList.findFirst({
        where: {
          id: id,
          container: {
            userId: userId
          }
        }
      });

      if (!existingList) {
        return {
          success: false,
          message: "Lista de datos no encontrada o acceso denegado"
        };
      }

      const updatedList = await prisma.dataList.update({
        where: { id: id },
        data: {
          name: data.name,
          description: data.description,
          items: data.items
        }
      });

      return {
        success: true,
        data: {
          id: updatedList.id,
          name: updatedList.name,
          description: updatedList.description,
          items: updatedList.items,
          created_at: updatedList.createdAt,
          updated_at: updatedList.updatedAt
        }
      };
    } catch (error) {
      console.error("Error actualizando lista de datos:", error);
      throw new Error("Error al actualizar la lista de datos");
    }
  }

  async deleteDataList(id, userId) {
    try {
      // Verificar que el usuario tenga acceso a la lista
      const existingList = await prisma.dataList.findFirst({
        where: {
          id: id,
          container: {
            userId: userId
          }
        }
      });

      if (!existingList) {
        return {
          success: false,
          message: "Lista de datos no encontrada o acceso denegado"
        };
      }

      await prisma.dataList.delete({
        where: { id: id }
      });

      return {
        success: true,
        message: "Lista de datos eliminada correctamente"
      };
    } catch (error) {
      console.error("Error eliminando lista de datos:", error);
      throw new Error("Error al eliminar la lista de datos");
    }
  }
}

module.exports = new DataListService();