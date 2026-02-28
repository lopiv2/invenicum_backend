class UserPreferencesDTO {
  constructor(prismaPreferences) {
    const prefs = prismaPreferences || {};
    
    this.language = prefs.language || "es";
    this.currency = prefs.currency || "USD";
    this.aiEnabled = prefs.aiEnabled ?? true;

    // 🔔 Construimos el objeto "notifications" para Flutter
    this.notifications = {
      // 🔄 CONVERSIÓN: De "telegram,email" (DB) a ["telegram", "email"] (Flutter)
      channelOrder: typeof prefs.channelOrder === 'string' 
        ? prefs.channelOrder.split(',') 
        : ["telegram", "email"],
      
      alertStockLow: prefs.alertStockLow ?? true,
      alertPreSales: prefs.alertPreSales ?? true,
      alertLoanReminders: prefs.alertLoanReminders ?? true,
      alertOverdueLoans: prefs.alertOverdueLoans ?? true,
      alertMaintenance: prefs.alertMaintenance ?? false,
      alertPriceChange: prefs.alertPriceChange ?? false,
    };
  }

  /**
   * 🚀 Prepara los datos para Prisma (Mapeo Flutter -> Database)
   */
  static toPrismaData(body) {
    const prismaData = {};
    
    // Campos de primer nivel
    if (body.language) prismaData.language = body.language;
    if (body.currency) prismaData.currency = body.currency;
    if (body.aiEnabled !== undefined) prismaData.aiEnabled = body.aiEnabled;

    // Campos anidados de notificaciones
    if (body.notifications) {
      const n = body.notifications;
      
      // Alertas booleanas
      if (n.alertStockLow !== undefined) prismaData.alertStockLow = n.alertStockLow;
      if (n.alertPreSales !== undefined) prismaData.alertPreSales = n.alertPreSales;
      if (n.alertLoanReminders !== undefined) prismaData.alertLoanReminders = n.alertLoanReminders;
      if (n.alertOverdueLoans !== undefined) prismaData.alertOverdueLoans = n.alertOverdueLoans;
      if (n.alertMaintenance !== undefined) prismaData.alertMaintenance = n.alertMaintenance;
      if (n.alertPriceChange !== undefined) prismaData.alertPriceChange = n.alertPriceChange;

      // 🔄 CONVERSIÓN: De ["telegram", "email"] (Flutter) a "telegram,email" (DB)
      if (n.channelOrder) {
        prismaData.channelOrder = Array.isArray(n.channelOrder) 
          ? n.channelOrder.join(',') 
          : n.channelOrder;
      }
    }

    return prismaData;
  }

  toJSON() {
    return {
      language: this.language,
      currency: this.currency,
      aiEnabled: this.aiEnabled,
      notifications: this.notifications,
    };
  }
}

module.exports = UserPreferencesDTO;