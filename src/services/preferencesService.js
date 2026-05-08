const prisma = require("../middleware/prisma");
const UserPreferencesDTO = require("../models/userPreferencesModel");
const currencyService = require("../services/currencyService");

class PreferencesService {
  /**
   * Gets the user's preferences and returns them formatted by the DTO
   */
  async getPreferences(userId) {
    try {
      const preferences = await prisma.userPreferences.findUnique({
        where: { userId: parseInt(userId) },
      });

      // 1. Get the clean preferences from the DTO
      const prefsData = new UserPreferencesDTO(preferences).toJSON();

      // 2. Get the current exchange rates
      const rates = await currencyService.getLatestRates();

      // 3. Return everything together
      return {
        ...prefsData,
        exchangeRates: rates,
      };
    } catch (error) {
      console.error("[PREFERENCES SERVICE - GET]:", error.message);
      throw new Error("Error getting preferences");
    }
  }

  /**
   * Unified method to update any preference (language, AI, etc.)
   */
  async updatePreferences(userId, data) {
    try {
      const userIdInt = parseInt(userId);

      const dataToUpdate = UserPreferencesDTO.toPrismaData(data);

      const updated = await prisma.userPreferences.upsert({
        where: { userId: userIdInt },
        update: dataToUpdate,
        create: {
          userId: userIdInt,
          ...dataToUpdate,
        },
      });

      return {
        success: true,
        data: new UserPreferencesDTO(updated).toJSON(),
      };
    } catch (error) {
      console.error("[PREFERENCES SERVICE - UPDATE]:", error.message);
      return {
        success: false,
        message: "Preferences could not be updated",
      };
    }
  }

  async updateLanguage(userId, languageCode) {
    return this.updatePreferences(userId, { language: languageCode });
  }

  async updateCurrency(userId, currencyCode) {
    return this.updatePreferences(userId, { currency: currencyCode });
  }

  async updateAiEnabled(userId, enabled) {
    return this.updatePreferences(userId, { aiEnabled: enabled });
  }

  async getThemePreference(userId) {
    return await prisma.userThemeConfig.findUnique({
      where: { userId },
    });
  }

  async getCustomThemes(userId) {
    return await prisma.customTheme.findMany({
      where: { userId },
      orderBy: { id: "desc" },
    });
  }

  async updateNotificationSettings(userId, notificationData) {
    return this.updatePreferences(userId, notificationData);
  }

  /**
   * Persists the user's active theme.
   * Only color + brightness are stored — palette/retro logic is client-only.
   */
  async updateThemePreference(userId, themeData) {
    const { themeColor, themeBrightness } = themeData;

    return await prisma.userThemeConfig.upsert({
      where: { userId },
      update: { themeColor, themeBrightness },
      create: { userId, themeColor, themeBrightness },
    });
  }

  /**
   * Saves a new theme to the user's library.
   * User-created themes are always plain Material themes — no palette field.
   */
  async saveCustomTheme(userId, themeData) {
    return await prisma.customTheme.create({
      data: {
        name: themeData.name,
        primaryColor: themeData.primaryColor,
        brightness: themeData.brightness || "light",
        userId,
      },
    });
  }

  async deleteCustomTheme(userId, themeId) {
    try {
      const theme = await prisma.customTheme.findFirst({
        where: { id: themeId, userId },
      });

      if (!theme) {
        return {
          success: false,
          message: "Theme not found or not authorized to delete",
        };
      }

      await prisma.customTheme.delete({ where: { id: themeId } });

      return { success: true, message: "Theme deleted successfully" };
    } catch (error) {
      throw new Error("Error deleting theme: " + error.message);
    }
  }
}

module.exports = new PreferencesService();