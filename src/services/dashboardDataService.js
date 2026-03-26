const prisma = require("../middleware/prisma");
const inventoryItemService = require("../services/inventoryItemService");
const { Temporal } = require('@js-temporal/polyfill');

class DashboardDataService {
  async getGlobalStatsFromDb(userId) {
    try {
      const userId_int = Number(userId);

      const [
        totalContainers,
        totalItems,
        totalAssets,
        totalValue,
        topItems,
        expiringToday,
      ] = await Promise.all([
        prisma.container.count({ where: { userId: userId_int } }),
        prisma.inventoryItem.count({
          where: { container: { userId: userId_int } },
        }),
        prisma.assetType.count({
          where: { container: { userId: userId_int } },
        }),
        inventoryItemService.getGlobalTotalValue(userId_int),
        this.getTopLoanedItems(userId_int, 5),
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
    // 1. Obtenemos el inicio del día de hoy en la zona horaria del sistema
    const today = Temporal.Now.zonedDateTimeISO();
    
    // 2. Creamos el inicio del día (00:00:00)
    const startOfToday = today.with({ hour: 0, minute: 0, second: 0, millisecond: 0 });
    
    // 3. Sumamos un día para tener el inicio de mañana
    const startOfTomorrow = startOfToday.add({ days: 1 });

    // IMPORTANTE: Prisma necesita objetos Date de JS, así que convertimos 
    // los instantes de Temporal a Date usando epochMilliseconds.
    return await prisma.loan.findMany({
      where: {
        userId: Number(userId),
        status: "active",
        expectedReturnDate: {
          gte: new Date(startOfToday.epochMilliseconds),
          lt: new Date(startOfTomorrow.epochMilliseconds),
        },
      },
      include: {
        inventoryItem: true,
      },
    });
  }

  async getTopLoanedItems(userId, limit = 5) {
    try {
      const result = await prisma.$queryRaw`
        SELECT 
          i.id as id, 
          i.name as name, 
          i.asset_type_id as assetTypeId,
          i.containerId as containerId,
          COUNT(l.id) as loanCount
        FROM loan l
        JOIN inventory_item i ON l.inventory_item_id = i.id
        WHERE l.user_id = ${Number(userId)}
        GROUP BY i.id, i.name, i.asset_type_id, i.containerId
        ORDER BY loanCount DESC
        LIMIT ${Number(limit)}
      `;

      return result.map((row) => ({
        id: Number(row.id),
        name: row.name,
        count: Number(row.loanCount),
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