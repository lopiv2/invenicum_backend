class UserPreferencesDTO {
  constructor(prismaPreferences) {
    const prefs = prismaPreferences || {};

    this.language = prefs.language || "en";
    this.currency = prefs.currency || "USD";
    this.aiEnabled = prefs.aiEnabled ?? true;
    this.aiModel = prefs.aiModel;
    this.aiProvider = prefs.aiProvider;

    // --- NUEVOS CAMPOS DE TEMA ---
    this.useSystemTheme = prefs.useSystemTheme ?? true;
    this.isDarkMode = prefs.isDarkMode ?? false;

    this.notifications = {
      channelOrder:
        typeof prefs.channelOrder === "string"
          ? prefs.channelOrder.split(",")
          : ["telegram", "email"],

      alertStockLow: prefs.alertStockLow ?? true,
      alertPreSales: prefs.alertPreSales ?? true,
      alertLoanReminders: prefs.alertLoanReminders ?? true,
      alertOverdueLoans: prefs.alertOverdueLoans ?? true,
      alertMaintenance: prefs.alertMaintenance ?? false,
      alertPriceChange: prefs.alertPriceChange ?? false,
    };
  }

  static toPrismaData(body) {
    const prismaData = {};

    if (body.language) prismaData.language = body.language;
    if (body.currency) prismaData.currency = body.currency;
    if (body.aiEnabled !== undefined) prismaData.aiEnabled = body.aiEnabled;
    if (body.aiModel) prismaData.aiModel = body.aiModel;
    if (body.aiProvider) prismaData.aiProvider = body.aiProvider;

    // --- Mapping DE TEMA A PRISMA ---
    if (body.useSystemTheme !== undefined) {
      prismaData.useSystemTheme = body.useSystemTheme;

      // 🛡️ REGLA DE NEGOCIO: if activamos the modo automático,
      // forzamos the modo oscuro manual a false.
      if (body.useSystemTheme === true) {
        prismaData.isDarkMode = false;
      }
    }
    if (body.isDarkMode !== undefined) prismaData.isDarkMode = body.isDarkMode;

    if (body.notifications) {
      const n = body.notifications;
      if (n.alertStockLow !== undefined)
        prismaData.alertStockLow = n.alertStockLow;
      if (n.alertPreSales !== undefined)
        prismaData.alertPreSales = n.alertPreSales;
      if (n.alertLoanReminders !== undefined)
        prismaData.alertLoanReminders = n.alertLoanReminders;
      if (n.alertOverdueLoans !== undefined)
        prismaData.alertOverdueLoans = n.alertOverdueLoans;
      if (n.alertMaintenance !== undefined)
        prismaData.alertMaintenance = n.alertMaintenance;
      if (n.alertPriceChange !== undefined)
        prismaData.alertPriceChange = n.alertPriceChange;

      if (n.channelOrder) {
        prismaData.channelOrder = Array.isArray(n.channelOrder)
          ? n.channelOrder.join(",")
          : n.channelOrder;
      }
    }

    return prismaData;
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = UserPreferencesDTO;
