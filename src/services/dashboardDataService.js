const prisma = require("../middleware/prisma");
const inventoryItemService = require("../services/inventoryItemService");
const { Temporal } = require('@js-temporal/polyfill');

class DashboardDataService {
  async getGlobalStatsFromDb(userId) {
    const userId_int = Number(userId);

    if (!Number.isFinite(userId_int)) {
      return {
        totalContainers: 0,
        totalItems: 0,
        totalAssets: 0,
        totalValue: 0.0,
        topLoanedItems: [],
        loansExpiringToday: [],
      };
    }

    const results = await Promise.allSettled([
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

    const pick = (index, fallback) => {
      const result = results[index];
      if (result.status === "fulfilled") return result.value;
      console.error("Dashboard metric failed:", result.reason);
      return fallback;
    };

    return {
      totalContainers: pick(0, 0),
      totalItems: pick(1, 0),
      totalAssets: pick(2, 0),
      totalValue: pick(3, 0.0) || 0.0,
      topLoanedItems: pick(4, []),
      loansExpiringToday: pick(5, []),
    };
  }

  async getLoansExpiringToday(userId) {
    // 1. get today's start of day in the system timezone
    const today = Temporal.Now.zonedDateTimeISO();

    // 2. Create the start of day (00:00:00)
    const startOfToday = today.with({ hour: 0, minute: 0, second: 0, millisecond: 0 });

    // 3. Add a day to get the start of tomorrow
    const startOfTomorrow = startOfToday.add({ days: 1 });

    // Important: Prisma needs JS Date objects, so convert
    // Temporal instants to Date using epochMilliseconds.
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
      console.error("Error fetching top loans:", error);
      return [];
    }
  }
}

module.exports = new DashboardDataService();
