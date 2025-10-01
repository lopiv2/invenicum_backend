const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

class InventoryItemService {
  async createItem(data) {
    const containerId = data.containerId;

    if (!containerId) {
      throw new Error("Container ID is missing in data.");
    }

    // El controlador ya debería haber verificado la existencia del contenedor por el userId,
    // pero esta doble verificación es segura.
    const container = await prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new Error("Container not found");
    }

    // Creamos el nuevo ítem, quantity ya no está en 'data'
    return prisma.inventoryItem.create({
      data: data,
    });
  }

  async getItems({ containerId, assetTypeId }) {
    return prisma.inventoryItem.findMany({
      where: {
        containerId,
        assetTypeId,
      },
    });
  }

  async getItemById(id, containerId) {
    return prisma.inventoryItem.findFirst({
      where: {
        id,
        containerId,
      },
    });
  }

  async updateItem(id, containerId, data) {
    return prisma.inventoryItem.update({
      where: {
        id,
        containerId,
      },
      data,
    });
  }

  async deleteItem(itemId, userId) {
    try {
      // Usamos una consulta anidada para asegurar que el ítem
      // pertenezca a un Container que es propiedad del userId
      const result = await prisma.inventoryItem.deleteMany({
        where: {
          id: itemId,
          container: {
            // <-- Consulta de relación anidada
            userId: userId,
          },
        },
      });

      if (result.count === 0) {
        // Si no se eliminó nada, es porque no existe o el usuario no es dueño.
        throw new Error("Item not found or access denied.");
      }

      return result;
    } catch (error) {
      // Manejar errores de DB o relanzar el error de "not found"
      if (error.message.includes("not found")) {
        throw error;
      }
      console.error("Service Error [deleteItem]:", error);
      throw new Error("Failed to delete inventory item.");
    }
  }

  async updateItemOptions(id, containerId, options) {
    return prisma.inventoryItem.update({
      where: {
        id,
        containerId,
      },
      data: {
        options,
      },
    });
  }
}

module.exports = new InventoryItemService();
