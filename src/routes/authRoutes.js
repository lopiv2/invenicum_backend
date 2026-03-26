const express = require("express");
const router = express.Router();
const userService = require("../services/userService");
const verifyToken = require("../middleware/authMiddleware");
const axios = require("axios");
const { Temporal } = require('@js-temporal/polyfill');

// Middleware para logging
router.use((req, res, next) => {
  const timestamp = Temporal.Now.plainDateISO().toString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  console.log("Body:", req.body);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS DE PRIMER USO (públicas, sin token)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /auth/first-run
 * Comprueba si la base de datos tiene usuarios.
 * El frontend llama a este endpoint al arrancar para decidir si redirige
 * al wizard de configuración inicial o al login normal.
 *
 * Response: { firstRun: true | false }
 */
router.get("/first-run", async (req, res) => {
  try {
    const firstRun = await userService.isFirstRun();
    return res.status(200).json({ firstRun });
  } catch (error) {
    console.error("[ERROR][FIRST-RUN]:", error.message);
    // En caso de error (DB caída, etc.) respondemos firstRun: false para
    // no bloquear el arranque de la app — el login fallará por su cuenta.
    return res.status(200).json({ firstRun: false });
  }
});

/**
 * POST /auth/setup
 * Crea el primer usuario administrador.
 * Está protegido a nivel de servicio: si ya existe algún usuario, rechaza
 * la petición con 403 para evitar que se llame después del primer arranque.
 *
 * Body: { name, email, password }
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
      // El servicio devuelve forbidden: true cuando ya hay usuarios
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
// RUTAS EXISTENTES (sin cambios)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/github/config", (req, res) => {
  res.json({
    success: true,
    clientId: process.env.GITHUB_CLIENT_ID,
  });
});

router.post("/github/complete", verifyToken, async (req, res) => {
  const { code } = req.body;
  const userId = req.user.userId || req.user.id;

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
        .status(401)
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