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
  // FIRST USE
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Checks if the user table is empty.
   * @returns {Promise<boolean>} true if there are no users, false if there is at least one.
   */
  async isFirstRun() {
    const count = await prisma.user.count();
    return count === 0;
  }

  /**
   * Creates the first admin user of the platform.
   * It is protected: if a user already exists, returns forbidden instead
   * of creating a new one, preventing the /setup route from being exploitable.
   *
   * @param {{ name: string, email: string, password: string }} userData
   */
  async createFirstAdmin({ name, email, password }) {
    try {
      // 1. Security check: only allow this if there are no users
      const existingCount = await prisma.user.count();
      if (existingCount > 0) {
        return {
          success: false,
          forbidden: true,
          message:
            "A user already exists. The setup endpoint is disabled.",
        };
      }

      // 2. Hash the password with the same Scrypt system used by register()
      const hashedPassword = await hashPassword(password);

      // 3. Create the user. We do not assign a role by field (if you do not have the 'role' field in your schema, just do not include it).
      const newUser = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
        },
      });

      console.log(
        `[SETUP] Created first admin: id=${newUser.id}, email=${newUser.email}`,
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

      // P2002 → unique constraint (duplicate email, although it should not happen
      // given the previous count check, but just in case)
      if (error.code === "P2002") {
        return {
          success: false,
          message: "A user with that email already exists.",
        };
      }

      return {
        success: false,
        message: error.message || "Error creating the admin user",
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXISTING METHODS (without changes)
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
          message: "A user with that email already exists.",
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
        message: "User registered successfully",
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
        message: error.message || "Error registering user",
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
          message: "The username is already in use by another user",
        };
      }
      throw error;
    }
  }

  async verifyGitHubAccount(handle) {
    try {
      const cleanHandle = handle.trim().replace(/^@/, "").toLowerCase();

      if (!cleanHandle) {
        return { success: false, message: "Invalid username" };
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
        return { success: false, message: "The GitHub user does not exist" };
      }
      console.error("Error in GitHub Service:", error.message);
      return { success: false, message: "Error connecting to GitHub" };
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
          message: "Wrong username or password",
        };
      }

      const token = jwt.sign(
        { userId: parseInt(user.id), email: user.email },
        process.env.JWT_SECRET || "tu-secret-key",
        { expiresIn: "24h" },
      );

      return {
        success: true,
        message: "Login successful",
        token: token,
        user: new UserDTO(user).toJSON(),
      };
    } catch (error) {
      console.error("[LOGIN ERROR]:", error.message);
      return {
        success: false,
        message: error.message || "Internal server error",
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

      if (!user) return { success: false, message: "User not found" };

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
          message: "This GitHub account is already linked to another profile.",
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
        message: "GitHub identity linked successfully",
        data: new UserDTO(updatedUser).toJSON(),
      };
    } catch (error) {
      console.error("[SERVICE ERROR - GitHub Identity]:", error.message);
      if (error.code === "P2002") {
        return {
          success: false,
          message: "The GitHub ID already exists in the system.",
        };
      }
      return {
        success: false,
        message: "Internal error while processing GitHub identity linking",
      };
    }
  }

  async changePassword(userId, { currentPassword, newPassword }) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return { success: false, message: "User not found" };
      }

      const isMatch = await verifyPassword(currentPassword, user.password);

      if (!isMatch) {
        return {
          success: false,
          message: "Current password is incorrect",
        };
      }

      const hashedPassword = await hashPassword(newPassword);

      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });

      return { success: true, message: "Password updated successfully" };
    } catch (error) {
      console.error("Error in userService.changePassword:", error);
      return {
        success: false,
        message: "Error while changing password",
      };
    }
  }
}

module.exports = new UserService();
