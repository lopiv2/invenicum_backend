const prisma = require("../middleware/prisma");

class AchievementService {
  async getUserAchievements(userId) {
    const [achievements, progresses] = await Promise.all([
      prisma.achievement.findMany({
        orderBy: [{ category: "asc" }, { requiredValue: "asc" }],
      }),
      prisma.userAchievementProgress.findMany({ where: { userId } }),
    ]);

    const map = new Map(progresses.map((p) => [p.achievementId, p]));
    console.log(`Fetched ${achievements.length} achievements and ${progresses.length} progress records for user ${userId}`);
    return achievements.map((a) => ({
      ...a,
      progress: map.get(a.id)?.progress ?? 0,
      unlocked: map.get(a.id)?.unlocked ?? false,
      unlockedAt: map.get(a.id)?.unlockedAt ?? null,
    }));
  }

  async processEvent(userId, { type, value = 1, metadata = {} }) {
    await prisma.userEvent.create({ data: { userId, type, value, metadata } });

    const achievements = await prisma.achievement.findMany({
      where: { eventType: type },
    });

    const newUnlocks = [];

    for (const achievement of achievements) {
      const progress = await this._getOrCreateProgress(userId, achievement.id);

      if (progress.unlocked) {
        continue;
      }

      const newProgress = await this._calculateProgress(
        userId,
        achievement,
        progress,
        value,
        metadata,
      );
      const shouldUnlock = newProgress >= (achievement.requiredValue ?? 1);

      await prisma.userAchievementProgress.upsert({
        where: {
          userId_achievementId: { userId, achievementId: achievement.id },
        },
        create: {
          userId,
          achievementId: achievement.id,
          progress: newProgress,
          ...(shouldUnlock && { unlocked: true, unlockedAt: new Date() }),
        },
        update: {
          progress: newProgress,
          ...(shouldUnlock && { unlocked: true, unlockedAt: new Date() }),
        },
      });

      if (shouldUnlock) newUnlocks.push(achievement);
    }

    return { newUnlocks };
  }

  async _getOrCreateProgress(userId, achievementId) {
    return prisma.userAchievementProgress.upsert({
      where: { userId_achievementId: { userId, achievementId } },
      create: { userId, achievementId, progress: 0 },
      update: {},
    });
  }

  async _calculateProgress(userId, achievement, current, eventValue, metadata) {
    const mode = achievement.extraConfig?.mode;

    switch (mode) {
      case "marketValue": {
        const containers = await prisma.container.findMany({
          where: { userId },
          select: { id: true },
        });
        const agg = await prisma.inventoryItem.aggregate({
          where: { containerId: { in: containers.map((c) => c.id) } },
          _sum: { marketValue: true },
        });
        return Math.floor(agg._sum.marketValue ?? 0);
      }

      case "threshold": {
        const itemValue = metadata?.itemValue ?? eventValue;
        return itemValue >= achievement.requiredValue
          ? achievement.requiredValue
          : current.progress;
      }

      case "snapshot": {
        if (achievement.eventType === "ACTIVE_LOANS_COUNT") {
          return await prisma.loan.count({
            where: { userId, status: "active" },
          });
        }
        return current.progress + eventValue;
      }

      default:
        return current.progress + eventValue;
    }
  }
}

module.exports = new AchievementService();
