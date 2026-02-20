const prisma = require("../middleware/prisma");
const inventoryItemService = require("../services/inventoryItemService");

class DashboardDataService {
  async getGlobalStatsFromDb(userId) {
    try {
      const userId_int = parseInt(userId);

      // Ejecutamos todo en paralelo. Ahora las queries son mucho más directas.
      const [
        totalContainers,
        totalItems,
        totalAssets,
        totalValue,
        topItems,
        expiringToday,
      ] = await Promise.all([
        // 1. Conteo de Contenedores del usuario
        prisma.container.count({ where: { userId: userId_int } }),

        // 2. Conteo de Items (Suma de stock de items que pertenecen al usuario)
        // Usamos la relación directa a través de container
        prisma.inventoryItem.count({
          where: { container: { userId: userId_int } },
        }),

        // 3. Conteo de Tipos de Activos del usuario
        prisma.assetType.count({
          where: { container: { userId: userId_int } },
        }),

        // 4. Valor económico (SQL Raw optimizado)
        inventoryItemService.getGlobalTotalValue(userId_int),

        // 5. Top Préstamos (Query simplificada)
        this.getTopLoanedItems(userId_int, 5),

        // 6. Préstamos que vencen hoy (Query simplificada)
        this.getLoansExpiringToday(userId_int),
      ]);

      return {
        totalContainers,
        totalItems,
        totalAssets,
        totalValue: totalValue || 0.0,
        topLoanedItems: topItems,
        loansExpiringToday: expiringToday,
      };
    } catch (error) {
      console.error("Error in DashboardDataService:", error);
      throw new Error("Error al consultar los datos del dashboard.");
    }
  }

  async getLoansExpiringToday(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    return await prisma.loan.findMany({
      where: {
        userId: userId, // 👈 Filtramos por tu usuario
        status: "active",
        expectedReturnDate: {
          // 👈 Usamos el nombre del schema
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        inventoryItem: true, // Para tener el nombre del objeto
      },
    });
  }

  async getTopLoanedItems(userId, limit = 5) {
  try {
    const result = await prisma.$queryRaw`
      SELECT 
        i.id as id, 
        i.name as name, 
        i.asset_type_id as assetTypeId, -- 👈 Alias para que coincida con el map
        i.containerId as containerId,   -- 👈 Verifica si en la DB es containerId o container_id
        COUNT(l.id) as loanCount
      FROM loan l
      JOIN inventory_item i ON l.inventory_item_id = i.id
      WHERE l.user_id = ${userId}
      GROUP BY i.id, i.name, i.asset_type_id, i.containerId
      ORDER BY loanCount DESC
      LIMIT ${parseInt(limit)}
    `;

    return result.map((row) => ({
      id: Number(row.id),
      name: row.name,
      count: Number(row.loanCount),
      // Ahora row.assetTypeId existirá porque usamos el alias en el SELECT
      assetTypeId: Number(row.assetTypeId), 
      containerId: Number(row.containerId),
    }));
  } catch (error) {
    console.error("Error obteniendo top préstamos:", error);
    return [];
  }
}
}

module.exports = new DashboardDataService();
