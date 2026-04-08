const express = require("express");
const router = express.Router();
const userService = require("../services/userService");
const verifyToken = require("../middleware/authMiddleware");
const axios = require("axios");
const { Temporal } = require('@js-temporal/polyfill');

// Middleware for logging
router.use((req, res, next) => {
  const timestamp = Temporal.Now.plainDateISO().toString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  console.log("Body:", req.body);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES DE first USO (públicas, without token)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /auth/first-run
 * Comprueba if the base de data tiene users.
 * the cliente llama a este endpoint al arrancar for decidir if redirige
 * al asistente de configuración inicial o al inicio de sesión normal.
 *
 * Response: { firstRun: true | false }
 */
router.get("/first-run", async (req, res) => {
  try {
    const firstRun = await userService.isFirstRun();
    return res.status(200).json({ firstRun });
  } catch (error) {
    console.error("[ERROR][FIRST-RUN]:", error.message);
    // En caso de error (BD caída, etc.) respondemos firstRun: false for
    // no bloquear the arranque de the app; the inicio de sesión fallará por su cuenta.
    return res.status(200).json({ firstRun: false });
  }
});

/**
 * POST /auth/setup
 * Create the first Use administrador.
 * Está protegido a nivel de service: if ya existe algún Use, rechaza
 * the petición with 403 for evitar que se llame después del first arranque.
 *
 * body: { name, email, password }
 * Response: 201 { success: true, message: "..." }
 */
router.post("/setup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Todos los campos son requeridos: name, email, password",
      });
    }

    const result = await userService.createFirstAdmin({ name, email, password });

    if (!result.success) {
      // the service returns forbidden: true when ya existen users
      const statusCode = result.forbidden ? 403 : 400;
      return res.status(statusCode).json({
        success: false,
        message: result.message,
      });
    }

    console.log(`[SETUP] Primer administrador creado: ${email}`);
    return res.status(201).json({
      success: true,
      message: "Administrador creado correctamente. Ya puedes iniciar sesión.",
    });
  } catch (error) {
    console.error("[ERROR][SETUP]:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error interno al crear el administrador",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES EXISTENTES (without Changes)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/github/config", (req, res) => {
  const hasClientId = Boolean(process.env.GITHUB_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.GITHUB_CLIENT_SECRET);
  const missingKeys = [
    ...(!hasClientId ? ["GITHUB_CLIENT_ID"] : []),
    ...(!hasClientSecret ? ["GITHUB_CLIENT_SECRET"] : []),
  ];

  res.json({
    success: true,
    clientId: hasClientId ? process.env.GITHUB_CLIENT_ID : null,
    isConfigured: hasClientId && hasClientSecret,
    missingKeys,
  });
});

router.post("/github/complete", verifyToken, async (req, res) => {
  const { code } = req.body;
  const userId = req.user.userId || req.user.id;

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return res.status(503).json({
      success: false,
      message:
        "GitHub OAuth no está configurado en el servidor. Faltan GITHUB_CLIENT_ID y/o GITHUB_CLIENT_SECRET.",
    });
  }

  if (!code) {
    return res
      .status(400)
      .json({ success: false, message: "Código no proporcionado" });
  }

  try {
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
      },
      { headers: { Accept: "application/json" } },
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      return res
        .status(400)
        .json({ success: false, message: "Token de GitHub inválido" });
    }

    const userRes = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `token ${accessToken}`,
        "User-Agent": "Invenicum-App",
      },
    });

    const githubData = userRes.data;

    const result = await userService.updateGitHubIdentity(userId, {
      githubHandle: githubData.login,
      githubId: githubData.id.toString(),
      avatarUrl: githubData.avatar_url,
      githubToken: accessToken,
      username: githubData.login,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json({
      success: true,
      message: "GitHub vinculado correctamente",
      data: result.data,
    });
  } catch (error) {
    console.error("[GITHUB ERROR]:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Error al vincular con GitHub",
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Faltan credenciales" });
    }

    const result = await userService.login({ username, password });

    if (!result.success) {
      console.log(`[LOGIN FAILED]: ${result.message}`);
      return res.status(401).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error interno" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: "Todos los campos son requeridos",
      });
    }

    const newUser = await userService.register({ email, password, name });

    console.log(`[REGISTRO] Nuevo usuario registrado: ${email}`);
    return res.status(201).json({
      success: true,
      message: "Usuario registrado exitosamente",
      data: newUser,
    });
  } catch (error) {
    console.error(
      `[ERROR][REGISTRO] Error al intentar registrar usuario:`,
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: error.message || "Error en el servidor",
    });
  }
});

router.post("/github/disconnect", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const result = await userService.disconnectGitHub(userId);

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error during GitHub disconnection",
    });
  }
});

router.get("/me", verifyToken, async (req, res) => {
  try {
    const result = await userService.getUserById(
      req.user.userId || req.user.id,
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.status(200).json({
      success: true,
      user: result.user,
    });
  } catch (error) {
    console.error(
      `[ERROR][ME] Error al obtener datos del usuario:`,
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Error al obtener datos del usuario",
    });
  }
});

router.post("/change-password", verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Ambas contraseñas son requeridas",
      });
    }

    const result = await userService.changePassword(userId, {
      currentPassword,
      newPassword,
    });

    if (!result.success) {
      return res.status(401).json(result);
    }

    return res.status(200).json({
      success: true,
      message: "Contraseña actualizada correctamente",
    });
  } catch (error) {
    console.error("[ERROR][CHANGE-PASSWORD]:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error interno al cambiar la contraseña",
    });
  }
});

router.post("/logout", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Sesión cerrada exitosamente",
  });
});

module.exports = router;
