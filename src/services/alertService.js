// services/alertService.js
const prisma = require("../middleware/prisma");
const AlertDTO = require("../models/alertModel");
const axios = require("axios");
const { Resend } = require("resend");
const integrationService = require("../services/integrationsService");
const { Temporal } = require('@js-temporal/polyfill');

class AlertService {
  /**
   * 🚀 Priority Sending Logic (Telegram / Email)
   * Goes through the channels in the order received from Flutter.
   */
  async dispatchExternalNotification(userId, content, channels) {
    if (!channels || !Array.isArray(channels)) return { sentVia: "none" };

    for (const channel of channels) {
      try {
        if (channel === "telegram") {
          const config = await integrationService.getTelegramConfig(userId);
          if (config && config.botToken && config.chatId) {
            await this._sendTelegram(config, content);
            return { sentVia: "telegram" }; // Success: stop the chain
          }
        }

        if (channel === "email") {
          const config = await integrationService.getResendConfig(userId);
          if (config && config.apiKey && config.fromEmail) {
            await this._sendEmail(config, content, userId);
            return { sentVia: "email" }; // Success: stop the chain
          }
        }
      } catch (error) {
        console.error(`❌ Failed to send via ${channel}:`, error.message);
        // the loop continues to the next channel if this one fails
      }
    }

    return {
      sentVia: "none",
      message: "Could not notify through any configured channel",
    };
  }

  /**
   * Internal sending to Telegram
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
   * Evaluates the stock of an item and generates an alert if necessary.
   * @param {number} userId - Item owner's ID.
   * @param {Object} item - InventoryItem object (must have name, quantity and minStock).
   */
  async checkAndNotifyLowStock(userId, item) {
    const minStock = item.minStock || 1;

    // Evaluation logic
    if (item.quantity < minStock) {
      console.log(`[STOCK CHECK] Generating alert for ${item.name}. Stock: ${item.quantity}`);

      // Load i18n translations
      const alertsI18n = require("../i18n/alerts.json");
      // You may want to get the user's language from preferences or context; fallback to 'en'
      const prefs = await prisma.userPreferences.findUnique({
        where: { userId: parseInt(userId) },
        select: { language: true },
      });
      const lang = prefs?.language || "en";
      const stockLow = alertsI18n.stock_low[lang] || alertsI18n.stock_low["en"];

      return await this.createAlert(userId, {
        title: stockLow.title,
        message: stockLow.message
          .replace("{name}", item.name)
          .replace("{quantity}", item.quantity)
          .replace("{minStock}", minStock),
        type: "warning", // This will automatically trigger the external notification
        isEvent: false,
      });
    }
    
    return null; // No alert needed
  }


  /**
   * Internal sending via Resend (Email)
   */
  async _sendEmail(config, { title, message }, userId) {
    const resend = new Resend(config.apiKey);

    // we get the user's email from the DB for the 'to' field
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
    });
    // Load i18n translations
    const alertsI18n = require("../i18n/alerts.json");
    const prefs = await prisma.userPreferences.findUnique({
      where: { id: parseInt(userId) },
      select: { language: true },
    });
    const lang = prefs?.language || "en";
    if (!user || !user.email) throw new Error(alertsI18n.email_not_found[lang] || alertsI18n.email_not_found["en"]);

    const { error } = await resend.emails.send({
      from: config.fromEmail,
      to: user.email,
      subject: `Invenicum: ${title}`,
      html: `<h3>${title}</h3><p>${message}</p><p>---</p><p>Sent automatically by Invenicum.</p>`,
    });

    if (error) throw new Error(error.message);
  }

  /**
   * Gets the alerts and returns them formatted via the DTO
   */
  async getAlerts(userId) {
    const alerts = await prisma.alert.findMany({
      where: { userId: parseInt(userId) },
      orderBy: { createdAt: "desc" },
    });

    // Load i18n translations
    const alertsI18n = require("../i18n/alerts.json");
    if (!alerts || alerts.length === 0) {
      // Get user language
      const prefs = await prisma.userPreferences.findUnique({
        where: { userId: parseInt(userId) },
        select: { language: true },
      });
      const lang = prefs?.language || "en";
      return { message: alertsI18n.alert_list_empty[lang] || alertsI18n.alert_list_empty["en"] };
    }
    // Return the list processed by the DTO
    return AlertDTO.fromList(alerts);
  }

  /**
   * Edit an alert or event validating data types
   */
  async updateAlert(id, userId, data) {
    const updated = await prisma.alert.update({
      where: {
        id: parseInt(id),
        userId: parseInt(userId), // Security: only the owner can edit
      },
      data: {
        title: data.title,
        message: data.message,
        type: data.type,
        isEvent: data.isEvent,
        // Convert the string coming from Flutter to a Date object for MySQL
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        notifyAt: data.notifyAt ? new Date(data.notifyAt) : null,
      },
    });

    // Load i18n translations
    const alertsI18n = require("../i18n/alerts.json");
    const prefs = await prisma.userPreferences.findUnique({
      where: { userId: parseInt(userId) },
      select: { language: true },
    });
    const lang = prefs?.language || "en";
    const dto = new AlertDTO(updated).toJSON();
    dto.message = alertsI18n.alert_updated[lang] || alertsI18n.alert_updated["en"];
    return dto;
  }

  /**
   * Create a alerta o evento validando the tipos de data
   */
  async createAlert(userId, data) {
    try {
      const userIdInt = parseInt(userId);

      // 1. Persistence in the database
      const newAlert = await prisma.alert.create({
        data: {
          userId: userIdInt,
          title: data.title,
          message: data.message,
          type: data.type || "info",
          isRead: !!data.isRead,
          isEvent: !!data.isEvent,
          // Date handling for the calendar
          scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
          notifyAt: data.notifyAt ? new Date(data.notifyAt) : null,
        },
      });

      // 2. Automatic External Notification Logic
      // We only trigger Telegram/Email if it's not a silent event
      // or if it's a critical alert (warning/error/stock_low)
      const tiposCriticos = ["warning", "error", "stock_low", "critical"];

      if (tiposCriticos.includes(newAlert.type) || !newAlert.isEvent) {
        // we fetch the user's preferences in real time
        const prefs = await prisma.userPreferences.findUnique({
          where: { userId: userIdInt },
          select: { channelOrder: true },
        });

        // Convert the string "telegram,email" into an array
        const priorityChannels = prefs?.channelOrder
          ? prefs.channelOrder.split(",")
          : ["email"]; // Fallback

        // Trigger the dispatch (without await to avoid blocking the API response)
        this.dispatchExternalNotification(
          userIdInt,
          { title: newAlert.title, message: newAlert.message },
          priorityChannels,
        ).catch((err) => console.error("[ALERT DISPATCH ERROR]:", err));
      }

      // 3. Return the object for the App (Calendar/List)
      const alertsI18n = require("../i18n/alerts.json");
      const prefs = await prisma.userPreferences.findUnique({
        where: { userId: userIdInt },
        select: { language: true },
      });
      const lang = prefs?.language || "en";
      const dto = new AlertDTO(newAlert).toJSON();
      dto.message = alertsI18n.alert_created[lang] || alertsI18n.alert_created["en"];
      return dto;
    } catch (error) {
      console.error("[ALERT SERVICE ERROR]:", error.message);
      throw error;
    }
  }

  async markAsRead(id, userId) {
    // Use updateMany to ensure the alert belongs to the user
    const result = await prisma.alert.updateMany({
      where: {
        id: parseInt(id),
        userId: parseInt(userId),
      },
      data: { isRead: true },
    });
    // Load i18n translations
    const alertsI18n = require("../i18n/alerts.json");
    const prefs = await prisma.userPreferences.findUnique({
      where: { userId: parseInt(userId) },
      select: { language: true },
    });
    const lang = prefs?.language || "en";
    return { ...result, message: alertsI18n.alert_updated[lang] || alertsI18n.alert_updated["en"] };
  }

  async deleteAlert(id, userId) {
    // First verify existence to avoid a Prisma 404 if it doesn't exist
    const deleted = await prisma.alert.delete({
      where: {
        id: parseInt(id),
        userId: parseInt(userId),
      },
    });
    // Load i18n translations
    const alertsI18n = require("../i18n/alerts.json");
    const prefs = await prisma.userPreferences.findUnique({
      where: { userId: parseInt(userId) },
      select: { language: true },
    });
    const lang = prefs?.language || "en";
    return { ...deleted, message: alertsI18n.alert_deleted[lang] || alertsI18n.alert_deleted["en"] };
  }
}

module.exports = new AlertService();
