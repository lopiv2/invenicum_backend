// services/alertService.js
const prisma = require("../middleware/prisma");
const AlertDTO = require("../models/alertModel");
const axios = require("axios");
const { Resend } = require("resend");
const integrationService = require("../services/integrationsService");
const { Temporal } = require('@js-temporal/polyfill');

class AlertService {
  /**
   * 🚀 Lógica de Envío por Prioridad (Telegram / Email)
   * Recorre los canales en el orden recibido desde Flutter.
   */
  async dispatchExternalNotification(userId, content, channels) {
    if (!channels || !Array.isArray(channels)) return { sentVia: "none" };

    for (const channel of channels) {
      try {
        if (channel === "telegram") {
          const config = await integrationService.getTelegramConfig(userId);
          if (config && config.botToken && config.chatId) {
            await this._sendTelegram(config, content);
            return { sentVia: "telegram" }; // Éxito: detenemos la cadena
          }
        }

        if (channel === "email") {
          const config = await integrationService.getResendConfig(userId);
          if (config && config.apiKey && config.fromEmail) {
            await this._sendEmail(config, content, userId);
            return { sentVia: "email" }; // Éxito: detenemos la cadena
          }
        }
      } catch (error) {
        console.error(`❌ Falló envío por ${channel}:`, error.message);
        // El bucle continúa al siguiente canal si este falla
      }
    }

    return {
      sentVia: "none",
      message: "No se pudo notificar por ningún canal configurado",
    };
  }

  /**
   * Envío interno a Telegram
   */
  async _sendTelegram(config, { title, message, type }) {
    const icons = {
      stock_low: "⚠️",
      loan_reminder: "📅",
      loan_overdue: "🚨",
      pre_sale: "💰",
      info: "ℹ️",
    };
    const icon = icons[type] || "🔔";
    const text = `${icon} *${title}*\n\n${message}`;
    await axios.post(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      {
        chat_id: config.chatId,
        text: text,
        parse_mode: "Markdown",
      },
    );
  }

  /**
   * Evalúa el stock de un item y genera una alerta si es necesario.
   * @param {number} userId - ID del dueño del item.
   * @param {Object} item - El objeto InventoryItem (debe tener name, quantity y minStock).
   */
  async checkAndNotifyLowStock(userId, item) {
    const minStock = item.minStock || 1;

    // Lógica de evaluación
    if (item.quantity < minStock) {
      console.log(`[STOCK CHECK] Generando alerta para ${item.name}. Stock: ${item.quantity}`);
      
      return await this.createAlert(userId, {
        title: "⚠️ Stock Bajo",
        message: `"${item.name}" bajó a ${item.quantity} unidades (Mínimo: ${minStock}).`,
        type: "warning", // Esto disparará la notificación externa automáticamente
        isEvent: false,
      });
    }
    
    return null; // No hubo necesidad de alerta
  }


  /**
   * Envío interno a Resend (Email)
   */
  async _sendEmail(config, { title, message }, userId) {
    const resend = new Resend(config.apiKey);

    // Obtenemos el email del usuario desde la DB para el 'To'
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
    });
    if (!user || !user.email) throw new Error("Email de destino no encontrado");

    const { error } = await resend.emails.send({
      from: config.fromEmail,
      to: user.email,
      subject: `Invenicum: ${title}`,
      html: `<h3>${title}</h3><p>${message}</p><p>---</p><p>Enviado automáticamente por Invenicum.</p>`,
    });

    if (error) throw new Error(error.message);
  }

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
    try {
      const userIdInt = parseInt(userId);

      // 1. Persistencia en la Base de Datos
      const newAlert = await prisma.alert.create({
        data: {
          userId: userIdInt,
          title: data.title,
          message: data.message,
          type: data.type || "info",
          isRead: !!data.isRead,
          isEvent: !!data.isEvent,
          // Manejo de fechas para el Calendario
          scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
          notifyAt: data.notifyAt ? new Date(data.notifyAt) : null,
        },
      });

      // 2. 🚀 Lógica de Notificación Externa Automática
      // Solo disparamos Telegram/Email si NO es un evento silencioso
      // o si es una alerta crítica (warning/error/stock_low)
      const tiposCriticos = ["warning", "error", "stock_low", "critical"];

      if (tiposCriticos.includes(newAlert.type) || !newAlert.isEvent) {
        // Buscamos las preferencias del usuario en tiempo real
        const prefs = await prisma.userPreferences.findUnique({
          where: { userId: userIdInt },
          select: { channelOrder: true },
        });

        // Convertimos el String "telegram,email" en Array
        const priorityChannels = prefs?.channelOrder
          ? prefs.channelOrder.split(",")
          : ["email"]; // Fallback de seguridad

        // Disparamos el dispatch (sin await para no bloquear la respuesta de la API)
        this.dispatchExternalNotification(
          userIdInt,
          { title: newAlert.title, message: newAlert.message },
          priorityChannels,
        ).catch((err) => console.error("[ALERT DISPATCH ERROR]:", err));
      }

      // 3. Retornamos el objeto para la App (Calendario/Lista)
      return new AlertDTO(newAlert).toJSON();
    } catch (error) {
      console.error("[ALERT SERVICE ERROR]:", error.message);
      throw error;
    }
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
