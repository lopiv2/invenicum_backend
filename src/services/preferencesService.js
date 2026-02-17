const prisma = require("../middleware/prisma");
const UserPreferencesDTO = require("../models/userPreferencesModel");

class PreferencesService {
  /**
   * Obtiene las preferencias del usuario y las devuelve formateadas por el DTO
   */
  async getPreferences(userId) {
    try {
      const preferences = await prisma.userPreferences.findUnique({
        where: { userId: parseInt(userId) },
      });

      // Retornamos siempre una instancia del DTO (manejando el caso null internamente)
      return new UserPreferencesDTO(preferences).toJSON();
    } catch (error) {
      console.error("[PREFERENCES SERVICE - GET]:", error.message);
      throw new Error("Error al obtener las preferencias");
    }
  }

  /**
   * Método unificado para actualizar cualquier preferencia (idioma, IA, etc.)
   */
  async updatePreferences(userId, data) {
    try {
      const userIdInt = parseInt(userId);

      // El DTO nos filtra solo lo que es válido para Prisma
      const dataToUpdate = UserPreferencesDTO.toPrismaData(data);

      const updated = await prisma.userPreferences.upsert({
        where: { userId: userIdInt },
        update: dataToUpdate,
        create: {
          userId: userIdInt,
          ...dataToUpdate, // Prisma usará los valores enviados o los defaults del schema
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
        message: "No se pudieron actualizar las preferencias",
      };
    }
  }

  /**
   * Métodos específicos si prefieres mantener llamadas atómicas desde el controlador
   */
  async updateLanguage(userId, languageCode) {
    return this.updatePreferences(userId, { language: languageCode });
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
        id: "desc", // Los más nuevos primero
      },
    });
  }

  async updateThemePreference(userId, themeData) {
    const { themeColor, themeBrightness } = themeData;
    // Usa upsert para crear el registro si no existe o actualizarlo si ya existe
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
      // Buscamos el tema asegurándonos de que pertenezca al usuario
      const theme = await prisma.customTheme.findFirst({
        where: {
          id: themeId,
          userId: userId,
        },
      });

      if (!theme) {
        return {
          success: false,
          message: "Tema no encontrado o no autorizado",
        };
      }

      await prisma.customTheme.delete({
        where: { id: themeId },
      });

      return { success: true, message: "Tema eliminado correctamente" };
    } catch (error) {
      throw new Error("Error al eliminar tema: " + error.message);
    }
  }
}

module.exports = new PreferencesService();
