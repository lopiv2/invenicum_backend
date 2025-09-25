const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class InventoryItemService {
    async createItem(containerId, data) {
        // Verificar que el contenedor existe
        const container = await prisma.container.findUnique({
            where: { id: containerId }
        });

        if (!container) {
            throw new Error('Container not found');
        }

        return prisma.inventoryItem.create({
            data: {
                ...data,
                containerId
            }
        });
    }

    async getItems(containerId) {
        return prisma.inventoryItem.findMany({
            where: {
                containerId
            }
        });
    }

    async getItemById(id, containerId) {
        return prisma.inventoryItem.findFirst({
            where: {
                id,
                containerId
            }
        });
    }

    async updateItem(id, containerId, data) {
        return prisma.inventoryItem.update({
            where: {
                id,
                containerId
            },
            data
        });
    }

    async deleteItem(id, containerId) {
        return prisma.inventoryItem.delete({
            where: {
                id,
                containerId
            }
        });
    }

    async updateItemOptions(id, containerId, options) {
        return prisma.inventoryItem.update({
            where: {
                id,
                containerId
            },
            data: {
                options
            }
        });
    }
}

module.exports = new InventoryItemService();