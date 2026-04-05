const prisma = require("../middleware/prisma");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { Temporal } = require("@js-temporal/polyfill");
const UserDTO = require("../models/userModel");
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

  // ───────────────────────────────────────────────────────────────────────────
  // PRIMER USO
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Comprueba si la tabla de usuarios está vacía.
   * @returns {Promise<boolean>} true si no hay ningún usuario, false si ya hay alguno.
   */
  async isFirstRun() {
    const count = await prisma.user.count();
    return count === 0;
  }

  /**
   * Crea el primer usuario administrador de la plataforma.
   * Está protegido: si ya existe algún usuario devuelve forbidden en lugar
   * de crear uno nuevo, evitando que el endpoint /setup sea explotable.
   *
   * @param {{ name: string, email: string, password: string }} userData
   */
  async createFirstAdmin({ name, email, password }) {
    try {
      // 1. Comprobación de seguridad: solo permitimos esto si no hay usuarios
      const existingCount = await prisma.user.count();
      if (existingCount > 0) {
        return {
          success: false,
          forbidden: true,
          message:
            "Ya existe al menos un usuario. El endpoint de setup está deshabilitado.",
        };
      }

      // 2. Hash de la contraseña con el mismo sistema Scrypt que usa register()
      const hashedPassword = await hashPassword(password);

      // 3. Crear el usuario. No asignamos rol por campo (si no tienes el campo
      //    'role' en tu schema simplemente no lo incluyas).
      const newUser = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
        },
      });

      console.log(
        `[SETUP] Primer administrador creado con id=${newUser.id} email=${newUser.email}`,
      );

      return {
        success: true,
        user: {
          id: parseInt(newUser.id),
          email: newUser.email,
          name: newUser.name,
        },
      };
    } catch (error) {
      console.error("[SETUP ERROR]:", error.message);

      // P2002 → unique constraint (email duplicado, aunque no debería pasar
      // dado el chequeo de count anterior, pero por si acaso)
      if (error.code === "P2002") {
        return {
          success: false,
          message: "Ya existe un usuario con ese correo electrónico.",
        };
      }

      return {
        success: false,
        message: error.message || "Error al crear el administrador",
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // MÉTODOS EXISTENTES (sin cambios)
  // ───────────────────────────────────────────────────────────────────────────

  async register(userData) {
    const { email, password, name } = userData;

    try {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return {
          success: false,
          message: "El usuario ya existe",
        };
      }

      const hashedPassword = await hashPassword(password);

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
          themeConfig: true,
        },
      });

      return { success: true, user: updatedUser };
    } catch (error) {
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
      const cleanHandle = handle.trim().replace(/^@/, "").toLowerCase();

      if (!cleanHandle) {
        return { success: false, message: "Username inválido" };
      }

      const response = await axios.get(
        `https://api.github.com/users/${cleanHandle}`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Invenicum-App-Server",
          },
        },
      );

      return {
        success: true,
        data: {
          githubHandle: response.data.login,
          avatarUrl: response.data.avatar_url,
          name: response.data.name || response.data.login,
        },
      };
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return { success: false, message: "El usuario de GitHub no existe" };
      }
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
          avatarUrl: null,
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
      const user = await prisma.user.findUnique({
        where: { email: username },
        include: {
          themeConfig: true,
          preferences: true,
        },
      });

      let isPasswordValid = false;

      if (user) {
        const [salt, storedHash] = user.password.split(":");

        if (salt && storedHash) {
          const derivedKey = await scrypt(password, salt, 64);
          const hashBuffer = Buffer.from(storedHash, "hex");

          if (crypto.timingSafeEqual(hashBuffer, derivedKey)) {
            isPasswordValid = true;
          }
        }
      }

      if (!user || !isPasswordValid) {
        return {
          success: false,
          message: "Credenciales incorrectas",
        };
      }

      const token = jwt.sign(
        { userId: parseInt(user.id), email: user.email },
        process.env.JWT_SECRET || "tu-secret-key",
        { expiresIn: "24h" },
      );

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

      return {
        success: true,
        user: new UserDTO(user).toJSON(),
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async updateGitHubIdentity(userId, githubData) {
    const linkedAt = Temporal.Now.zonedDateTimeISO();

    try {
      const githubIdStr = String(githubData.githubId);

      const existingLink = await prisma.user.findUnique({
        where: { githubId: githubIdStr },
      });

      if (existingLink && existingLink.id !== userId) {
        return {
          success: false,
          message: "Esta cuenta de GitHub ya está vinculada a otro perfil.",
        };
      }

      const encryptedToken = githubData.githubToken
        ? encrypt(githubData.githubToken)
        : null;

      const updatedUser = await prisma.user.update({
        where: { id: parseInt(userId) },
        data: {
          githubHandle: String(githubData.githubHandle),
          githubId: githubIdStr,
          avatarUrl: githubData.avatarUrl,
          githubToken: encryptedToken,
          githubLinkedAt: linkedAt.toString(),
          username: String(githubData.githubHandle),
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
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return { success: false, message: "Usuario no encontrado" };
      }

      const isMatch = await verifyPassword(currentPassword, user.password);

      if (!isMatch) {
        return {
          success: false,
          message: "La contraseña actual es incorrecta",
        };
      }

      const hashedPassword = await hashPassword(newPassword);

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