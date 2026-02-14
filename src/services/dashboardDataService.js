const prisma = require("../middleware/prisma");

class DashboardDataService {
    /**
     * Obtiene los contadores clave para el dashboard, limitando los resultados
     * a los datos asociados al usuario autenticado.
     * @param {number} userId - El ID del usuario autenticado.
     * @returns {Promise<{totalContainers: number, totalItems: number}>}
     */
    async getGlobalStatsFromDb(userId) {
        try {
            // ----------------------------------------------------
            // 1. Contar Contenedores Totales (Asociados al Usuario)
            // ----------------------------------------------------
            const totalContainers = await prisma.container.count({
                where: {
                    userId: userId,
                },
            });

            // ----------------------------------------------------
            // 2. Contar Items Totales (en todos los contenedores del usuario)
            // ----------------------------------------------------
            // Primero, obtenemos los IDs de los contenedores del usuario
            const userContainerIds = await prisma.container.findMany({
                where: { userId: userId },
                select: { id: true },
            }).then(containers => containers.map(c => c.id));
            
            // Luego, contamos todos los InventoryItems asociados a esos contenedores
            const totalItems = await prisma.inventoryItem.count({
                where: {
                    containerId: {
                        in: userContainerIds,
                    },
                },
            });

            // Luego, contamos todos los InventoryItems asociados a esos contenedores
            const totalAssets = await prisma.assetType.count({
                where: {
                    containerId: {
                        in: userContainerIds,
                    },
                },
            });
            

            // ----------------------------------------------------
            // 5. Devolver los resultados
            // ----------------------------------------------------
            return {
                totalContainers: totalContainers,
                totalItems: totalItems,
                totalAssets: totalAssets
            };

        } catch (error) {
            console.error("Error obteniendo estadísticas del dashboard:", error);
            // Lanzar un error para que la capa de rutas lo capture y devuelva 500
            throw new Error("Error al consultar las estadísticas del inventario.");
        } finally {
            // No es necesario desconectar aquí, PrismaClient maneja sus conexiones
        }
    }

    // ------------------------------------------------------------------
    // --- Puedes añadir más métodos relacionados con el Dashboard aquí ---
    // ------------------------------------------------------------------
}

module.exports = new DashboardDataService();