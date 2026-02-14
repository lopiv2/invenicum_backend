const prisma = require("../middleware/prisma");

class AlertService {
  async getAlerts(userId) {
    return await prisma.alert.findMany({
      where: { userId: parseInt(userId) },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createAlert(userId, data) {
    return await prisma.alert.create({
      data: {
        userId: parseInt(userId),
        title: data.title,
        message: data.message,
        type: data.type || "info"
      }
    });
  }

  async markAsRead(id, userId) {
    return await prisma.alert.updateMany({
      where: { 
        id: parseInt(id),
        userId: parseInt(userId) 
      },
      data: { isRead: true }
    });
  }

  async deleteAlert(id, userId) {
    return await prisma.alert.delete({
      where: { 
        id: parseInt(id),
        userId: parseInt(userId) 
      }
    });
  }
}

module.exports = new AlertService();