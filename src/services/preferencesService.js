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
        exchangeRates: rates, // Flutter will use this to multiply the marketValue
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

      // The DTO filters only what is valid for Prisma
      const dataToUpdate = UserPreferencesDTO.toPrismaData(data);

      const updated = await prisma.userPreferences.upsert({
        where: { userId: userIdInt },
        update: dataToUpdate,
        create: {
          userId: userIdInt,
          ...dataToUpdate, // Prisma will use the sent values or the schema defaults
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

  /**
   * Specific methods if you prefer to keep atomic calls from the controller
   */
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
      where: { userId: userId },
    });
  }

  async getCustomThemes(userId) {
    return await prisma.customTheme.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        id: "desc",
      },
    });
  }

  /**
   * 🔔 new: updates the notifications (the 6 switches or the reorder of channels)
   */
  async updateNotificationSettings(userId, notificationData) {
    return this.updatePreferences(userId, notificationData);
  }

  async updateThemePreference(userId, themeData) {
    const { themeColor, themeBrightness } = themeData;
    // Use upsert to create the record if it doesn't exist or update it if it does
    return await prisma.userThemeConfig.upsert({
      where: { userId: userId },
      update: { themeColor, themeBrightness },
      create: { userId, themeColor, themeBrightness },
    });
  }

  async saveCustomTheme(userId, themeData) {
    return await prisma.customTheme.create({
      data: {
        name: themeData.name,
        primaryColor: themeData.primaryColor,
        brightness: themeData.brightness || "light",
        userId: userId,
      },
    });
  }

  async deleteCustomTheme(userId, themeId) {
    try {
      // we search the theme ensuring it belongs to the user
      const theme = await prisma.customTheme.findFirst({
        where: {
          id: themeId,
          userId: userId,
        },
      });

      if (!theme) {
        return {
          success: false,
          message: "Theme not found or not authorized to delete",
        };
      }

      await prisma.customTheme.delete({
        where: { id: themeId },
      });

      return { success: true, message: "Theme deleted successfully" };
    } catch (error) {
      throw new Error("Error deleting theme: " + error.message);
    }
  }
}

module.exports = new PreferencesService();
