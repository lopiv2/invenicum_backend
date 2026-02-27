// services/alertService.js
const prisma = require("../middleware/prisma");
const AlertDTO = require("../models/alertModel");

class AlertService {
  /**
   * Obtiene las alertas y las devuelve formateadas mediante el DTO
   */
  async getAlerts(userId) {
    const alerts = await prisma.alert.findMany({
      where: { userId: parseInt(userId) },
      orderBy: { createdAt: "desc" },
    });

    // Devolvemos la lista procesada por el DTO
    return AlertDTO.fromList(alerts);
  }

  /**
   * Edita una alerta o evento validando los tipos de datos
   */
  async updateAlert(id, userId, data) {
    const updated = await prisma.alert.update({
      where: {
        id: parseInt(id),
        userId: parseInt(userId), // Seguridad: solo el dueño puede editar
      },
      data: {
        title: data.title,
        message: data.message,
        type: data.type,
        isEvent: data.isEvent,
        // Convertimos el string que viene de Flutter a objeto Date para MySQL
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        notifyAt: data.notifyAt ? new Date(data.notifyAt) : null,
      },
    });

    // Retornamos los datos limpios a través del DTO
    return new AlertDTO(updated).toJSON();
  }

  /**
   * Crea una alerta o evento validando los tipos de datos
   */
  async createAlert(userId, data) {
    const newAlert = await prisma.alert.create({
      data: {
        userId: parseInt(userId),
        title: data.title,
        message: data.message,
        type: data.type || "info",
        isRead: !!data.isRead, // Aseguramos booleano
        // Lógica de Calendario
        isEvent: !!data.isEvent, // Aseguramos booleano
        // Convertimos Strings ISO a objetos Date de JavaScript para Prisma
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        notifyAt: data.notifyAt ? new Date(data.notifyAt) : null,
        // Si añadiste endDate en el schema, aquí se procesa
        // endDate: data.endDate ? new Date(data.endDate) : null,
      },
    });

    // Retornamos el objeto creado también pasando por el DTO
    return new AlertDTO(newAlert).toJSON();
  }

  async markAsRead(id, userId) {
    // Usamos updateMany para asegurar que la alerta pertenece al usuario
    const result = await prisma.alert.updateMany({
      where: {
        id: parseInt(id),
        userId: parseInt(userId),
      },
      data: { isRead: true },
    });
    return result;
  }

  async deleteAlert(id, userId) {
    // Primero verificamos existencia para evitar error 404 de Prisma si no existe
    return await prisma.alert.delete({
      where: {
        id: parseInt(id),
        userId: parseInt(userId),
      },
    });
  }
}

module.exports = new AlertService();
