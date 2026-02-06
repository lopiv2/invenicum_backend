const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const prisma = new PrismaClient();

class UserService {
  async register(userData) {
    const { email, password, name } = userData;

    try {
      // Verificar si el usuario ya existe
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return {
          success: false,
          message: "El usuario ya existe",
        };
      }

      // Encriptar la contraseña
      const hashedPassword = await bcrypt.hash(password, 10);

      // Crear el nuevo usuario
      const newUser = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
        },
      });

      return {
        success: true,
        message: "Usuario registrado exitosamente",
        user: {
          id: parseInt(newUser.id),
          email: newUser.email,
          name: newUser.name,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || "Error al registrar usuario",
      };
    }
  }

  async login(credentials) {
    const { username, password } = credentials;

    try {
      // Buscar el usuario por email (username en el frontend)
      const user = await prisma.user.findUnique({
        where: { email: username },
        include: { themeConfig: true },
      });

      if (!user) {
        return {
          success: false,
          message: "Usuario no encontrado",
        };
      }

      // Verificar la contraseña
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return {
          success: false,
          message: "Contraseña incorrecta",
        };
      }

      // Generar token JWT
      // Generar token solo con lo esencial
      const token = jwt.sign(
        { userId: parseInt(user.id), email: user.email },
        process.env.JWT_SECRET || "tu-secret-key",
        { expiresIn: "24h" },
      );

      return {
        success: true,
        message: "Login exitoso",
        token: token,
        user: {
          id: parseInt(user.id),
          email: user.email,
          name: user.name,
          themeConfig: user.themeConfig,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || "Error en el servidor",
      };
    }
  }

  async getUserById(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { 
          themeConfig: true,
          preferences: true,
        },
      });

      if (!user) {
        return {
          success: false,
          message: "Usuario no encontrado",
        };
      }

      return {
        success: true,
        user: {
          id: parseInt(user.id),
          email: user.email,
          name: user.name,
          themeConfig: user.themeConfig,
          preferences: user.preferences,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || "Error al obtener usuario",
      };
    }
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

  async getThemePreference(userId) {
    return await prisma.userThemeConfig.findUnique({
      where: { userId: userId },
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
  // userService.js

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

  // ====== MÉTODOS DE PREFERENCIAS ======

  async getPreferences(userId) {
    try {
      const preferences = await prisma.userPreferences.findUnique({
        where: { userId: userId },
      });

      return preferences || { userId: userId, language: "es" };
    } catch (error) {
      throw new Error("Error al obtener preferencias: " + error.message);
    }
  }

  async updateLanguage(userId, languageCode) {
    try {
      // Usa upsert para crear el registro si no existe o actualizarlo si ya existe
      const preferences = await prisma.userPreferences.upsert({
        where: { userId: userId },
        update: { language: languageCode },
        create: { userId, language: languageCode },
      });

      return {
        success: true,
        data: preferences,
      };
    } catch (error) {
      throw new Error("Error al actualizar idioma: " + error.message);
    }
  }
}

module.exports = new UserService();
