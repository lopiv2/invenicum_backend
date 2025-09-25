const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

class ContainerService {
    async createContainer(userId, data) {
        return prisma.container.create({
            data: {
                ...data,
                userId
            },
            include: {
                items: true
            }
        });
    }

    async getContainers(userId) {
        return prisma.container.findMany({
            where: {
                userId
            },
            include: {
                items: true
            }
        });
    }

    async getContainerById(id, userId) {
        return prisma.container.findFirst({
            where: {
                id,
                userId
            },
            include: {
                items: true
            }
        });
    }

    async updateContainer(id, userId, data) {
        return prisma.container.update({
            where: {
                id,
                userId
            },
            data,
            include: {
                items: true
            }
        });
    }

    async deleteContainer(id, userId) {
        // Primero eliminamos todos los items del contenedor
        await prisma.inventoryItem.deleteMany({
            where: {
                containerId: id
            }
        });

        // Luego eliminamos el contenedor
        return prisma.container.delete({
            where: {
                id,
                userId
            }
        });
    }
}

module.exports = new ContainerService();