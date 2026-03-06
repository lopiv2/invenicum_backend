const prisma = require("../middleware/prisma");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const UserDTO = require("../models/UserModel");
const {
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
} = require("../middleware/cryptoUtils");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

class UserService {
  async register(userData) {
    const { email, password, name } = userData;

    try {
      // 1. Verificar si el usuario ya existe
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return {
          success: false,
          message: "El usuario ya existe",
        };
      }

      // 2. Encriptar con Scrypt nativo
      // Esto guardará el formato "salt:hash" compatible con tu nuevo Login
      const hashedPassword = await hashPassword(password);

      // 3. Crear el nuevo usuario
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
      console.error("[REGISTER ERROR]:", error.message);
      return {
        success: false,
        message: error.message || "Error al registrar usuario",
      };
    }
  }

  async updateProfile(userId, data) {
    try {
      const updatedUser = await prisma.user.update({
        where: { id: parseInt(userId) },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.username && {
            username: data.username.toLowerCase().trim(),
          }),
          ...(data.githubHandle && { githubHandle: data.githubHandle.trim() }),
          ...(data.avatarUrl && { avatarUrl: data.avatarUrl }),
          ...(data.githubId && { githubId: data.githubId }),
        },
        include: {
          themeConfig: true, // Para que el frontend no pierda la configuración de tema
        },
      });

      return { success: true, user: updatedUser };
    } catch (error) {
      // Error P2002 es "Unique constraint failed" en Prisma
      if (error.code === "P2002") {
        return {
          success: false,
          message: "El username ya está en uso por otro usuario",
        };
      }
      throw error;
    }
  }

  async verifyGitHubAccount(handle) {
    try {
      // 1. Limpieza extrema: quitamos @, espacios y pasamos a minúsculas
      const cleanHandle = handle.trim().replace(/^@/, "").toLowerCase();

      if (!cleanHandle) {
        return { success: false, message: "Username inválido" };
      }

      // 2. Petición con Headers obligatorios
      const response = await axios.get(
        `https://api.github.com/users/${cleanHandle}`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Invenicum-App-Server", // GitHub exige esto
          },
        },
      );

      // Si llega aquí, es un 200 OK
      return {
        success: true,
        data: {
          githubHandle: response.data.login,
          avatarUrl: response.data.avatar_url, // Esta es la URL de tipo 'https://avatars.githubusercontent.com/u/...'
          name: response.data.name || response.data.login,
        },
      };
    } catch (error) {
      // Si la API de GitHub devuelve 404, el usuario no existe
      if (error.response && error.response.status === 404) {
        return { success: false, message: "El usuario de GitHub no existe" };
      }
      // Otros errores (Rate limit, conexión, etc)
      console.error("Error en GitHub Service:", error.message);
      return { success: false, message: "Error al conectar con GitHub" };
    }
  }

  async disconnectGitHub(userId) {
    try {
      const updatedUser = await prisma.user.update({
        where: { id: parseInt(userId) },
        data: {
          username: null,
          githubHandle: null,
          githubId: null,
          githubToken: null,
          githubLinkedAt: null,
          avatarUrl: null, // Si quieres que el avatar vuelva a ser el generado por defecto, puedes decidir si poner avatarUrl a null o dejarlo.
          // Si quieres que el avatar vuelva a ser el generado por defecto
          // puedes decidir si poner avatarUrl a null o dejarlo.
        },
      });

      return {
        success: true,
        message: "GitHub identity disconnected",
        user: updatedUser,
      };
    } catch (error) {
      console.error("Error in service disconnectGitHub:", error.message);
      return {
        success: false,
        message: "Error in database during disconnection",
      };
    }
  }

  async login(credentials) {
    const { username, password } = credentials;

    try {
      // 1. Buscamos el usuario incluyendo sus relaciones
      const user = await prisma.user.findUnique({
        where: { email: username },
        include: {
          themeConfig: true,
          preferences: true, // Añadido para que el DTO tenga toda la info
        },
      });

      // --- NUEVA LÓGICA DE COMPRACIÓN SCRYPT ---
      let isPasswordValid = false;

      if (user) {
        // Separamos el salt y el hash que guardamos en el seed (salt:hash)
        const [salt, storedHash] = user.password.split(":");

        if (salt && storedHash) {
          // Generamos el hash de la contraseña recibida usando el mismo salt
          const derivedKey = await scrypt(password, salt, 64);
          const hashBuffer = Buffer.from(storedHash, "hex");

          // Comparación segura contra ataques de tiempo
          if (crypto.timingSafeEqual(hashBuffer, derivedKey)) {
            isPasswordValid = true;
          }
        }
      }
      // ----------------------------------------

      // 2. Validación única de seguridad
      if (!user || !isPasswordValid) {
        return {
          success: false,
          message: "Credenciales incorrectas",
        };
      }

      // 3. Generar token JWT
      const token = jwt.sign(
        { userId: parseInt(user.id), email: user.email },
        process.env.JWT_SECRET || "tu-secret-key",
        { expiresIn: "24h" },
      );

      // 4. Retornamos usando el UserDTO para garantizar la estructura
      // No necesitamos mapear campos a mano aquí, el DTO se encarga
      return {
        success: true,
        message: "Login exitoso",
        token: token,
        user: new UserDTO(user).toJSON(),
      };
    } catch (error) {
      console.error("[LOGIN ERROR]:", error.message);
      return {
        success: false,
        message: error.message || "Error en el servidor",
      };
    }
  }

  // Método centralizado para buscar y transformar
  async getUserById(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          themeConfig: true,
          preferences: true,
        },
      });

      if (!user) return { success: false, message: "Usuario no encontrado" };

      // 🚩 Retornamos la instancia del modelo
      return {
        success: true,
        user: new UserDTO(user).toJSON(),
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // userService.js

  async updateGitHubIdentity(userId, githubData) {
    const linkedAt = new Date();

    try {
      const githubIdStr = githubData.githubId.toString();

      // 1. Verificar si ese GitHub ID ya está en uso
      const existingLink = await prisma.user.findUnique({
        where: { githubId: githubIdStr },
      });

      if (existingLink && existingLink.id !== userId) {
        return {
          success: false,
          message: "Esta cuenta de GitHub ya está vinculada a otro perfil.",
        };
      }

      // 🚩 2. CIFRADO MANUAL DEL TOKEN
      // Ciframos el token antes de guardarlo en la DB
      const encryptedToken = githubData.githubToken
        ? encrypt(githubData.githubToken)
        : null;

      // 3. Actualizar el usuario
      const updatedUser = await prisma.user.update({
        where: { id: parseInt(userId) },
        data: {
          githubHandle: githubData.githubHandle,
          githubId: githubIdStr,
          avatarUrl: githubData.avatarUrl,
          githubToken: encryptedToken, // 🚩 Usamos el token cifrado
          githubLinkedAt: linkedAt,
          username: githubData.githubHandle,
        },
        include: {
          themeConfig: true,
          preferences: true,
        },
      });

      return {
        success: true,
        message: "Identidad de GitHub vinculada correctamente",
        data: new UserDTO(updatedUser).toJSON(),
      };
    } catch (error) {
      console.error("[SERVICE ERROR - GitHub Identity]:", error.message);
      if (error.code === "P2002") {
        return {
          success: false,
          message: "El ID de GitHub ya existe en el sistema.",
        };
      }
      return {
        success: false,
        message: "Error interno al procesar la vinculación con GitHub",
      };
    }
  }

  async changePassword(userId, { currentPassword, newPassword }) {
    try {
      // 1. Buscar al usuario
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return { success: false, message: "Usuario no encontrado" };
      }

      // 2. Verificar la contraseña actual con Scrypt
      const isMatch = await verifyPassword(currentPassword, user.password);

      if (!isMatch) {
        return {
          success: false,
          message: "La contraseña actual es incorrecta",
        };
      }

      // 3. Encriptar la nueva contraseña (genera un Salt nuevo automáticamente)
      const hashedPassword = await hashPassword(newPassword);

      // 4. Actualizar en la base de datos
      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });

      return { success: true, message: "Contraseña actualizada correctamente" };
    } catch (error) {
      console.error("Error en userService.changePassword:", error);
      return {
        success: false,
        message: "Error al cambiar la contraseña",
      };
    }
  }
}

module.exports = new UserService();
