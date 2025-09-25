const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const createContainer = async (userId, data) => {
    try {
        console.log("Creando contenedor para usuario:", userId);
        console.log("Datos recibidos:", data);

        if (!userId || !data.name) {
            throw new Error('Se requiere el ID de usuario y el nombre del contenedor');
        }

        const containerData = {
            name: data.name,
            description: data.description || '',
            userId: parseInt(userId)
        };

        console.log("Datos a insertar:", containerData);

        const container = await prisma.container.create({
            data: containerData
        });

        console.log("Contenedor creado:", container);

        return {
            success: true,
            message: 'Contenedor creado exitosamente',
            data: container
        };
    } catch (error) {
        console.error("Error al crear contenedor:", error);
        return {
            success: false,
            message: `Error al crear el contenedor: ${error.message}`
        };
    }
};

const getContainers = async (userId) => {
    try {
        console.log("Buscando contenedores para usuario:", userId);
        
        const containers = await prisma.container.findMany({
            where: {
                userId: parseInt(userId)
            },
            include: {
                items: true
            }
        });

        return {
            success: true,
            data: containers
        };
    } catch (error) {
        console.error("Error al obtener contenedores:", error);
        return {
            success: false,
            message: error.message || 'Error al obtener los contenedores'
        };
    }
};

const getContainerById = async (id, userId) => {
    try {
        const container = await prisma.container.findFirst({
            where: {
                id: parseInt(id),
                userId: parseInt(userId)
            },
            include: {
                items: true
            }
        });

        if (!container) {
            return {
                success: false,
                message: 'Contenedor no encontrado'
            };
        }

        return {
            success: true,
            data: container
        };
    } catch (error) {
        console.error("Error al obtener contenedor:", error);
        return {
            success: false,
            message: error.message || 'Error al obtener el contenedor'
        };
    }
};

const updateContainer = async (id, userId, data) => {
    try {
        const container = await prisma.container.update({
            where: {
                id: parseInt(id),
                userId: parseInt(userId)
            },
            data: {
                name: data.name,
                description: data.description
            },
            include: {
                items: true
            }
        });

        return {
            success: true,
            message: 'Contenedor actualizado exitosamente',
            data: container
        };
    } catch (error) {
        console.error("Error al actualizar contenedor:", error);
        return {
            success: false,
            message: error.message || 'Error al actualizar el contenedor'
        };
    }
};

const deleteContainer = async (id, userId) => {
    try {
        const container = await prisma.container.delete({
            where: {
                id: parseInt(id),
                userId: parseInt(userId)
            }
        });

        return {
            success: true,
            message: 'Contenedor eliminado exitosamente',
            data: container
        };
    } catch (error) {
        console.error("Error al eliminar contenedor:", error);
        return {
            success: false,
            message: error.message || 'Error al eliminar el contenedor'
        };
    }
};

module.exports = {
    createContainer,
    getContainers,
    getContainerById,
    updateContainer,
    deleteContainer
};