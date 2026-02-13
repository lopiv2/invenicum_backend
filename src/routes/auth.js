const express = require("express");
const router = express.Router();
const userService = require("../services/userService");
const verifyToken = require("../middleware/authMiddleware");
const axios = require("axios");

// Middleware para logging
router.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  console.log("Body:", req.body);
  next();
});

// Ruta para verificar el token y obtener datos del usuario
router.get("/github/config", (req, res) => {
  res.json({
    success: true,
    clientId: process.env.GITHUB_CLIENT_ID,
    // No envíes el Client Secret nunca
  });
});

// --- RUTA GITHUB OAUTH ---
router.post("/github/complete", verifyToken, async (req, res) => {
  const { code } = req.body;
  const userId = req.user.userId || req.user.id; // Obtenido del token

  if (!code) {
    return res
      .status(400)
      .json({ success: false, message: "Código no proporcionado" });
  }

  try {
    // 1. Intercambiar código por Access Token
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

    // 2. Obtener datos del perfil de GitHub
    const userRes = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `token ${accessToken}`,
        "User-Agent": "Invenicum-App",
      },
    });

    // 3. Llamar al servicio para actualizar la DB con Prisma
    const result = await userService.updateGitHubIdentity(userId, {
      githubHandle: userRes.data.login,
      githubId: userRes.data.id.toString(),
      avatarUrl: userRes.data.avatar_url,
      username: userRes.data.login,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json({
      success: true,
      data: result.data, // Asegúrate de que esto incluya githubHandle
    });
  } catch (error) {
    console.error("[GITHUB ERROR]:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Error al vincular con GitHub" });
  }
});

// Ruta para iniciar sesión
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Faltan credenciales" });
    }

    const result = await userService.login({ username, password });

    // Si el servicio dice que falló (usuario no existe o clave mal), respondemos 401
    if (!result.success) {
      console.log(`[LOGIN FAILED]: ${result.message}`); // Aquí sí lo verás en tu consola de Node
      return res.status(401).json({
        success: false,
        message: result.message, // Aquí enviamos "Usuario no encontrado"
      });
    }

    // Si tuvo éxito, devolvemos el objeto limpio
    // Quitamos la envoltura extra de 'data: result'
    // SI TODO SALIÓ BIEN
    return res.status(200).json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error interno" });
  }
});

// Ruta para registrar un nuevo usuario
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validación básica
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

router.get("/me", verifyToken, async (req, res) => {
  try {
    // 🚩 EL CAMBIO ESTÁ AQUÍ:
    // En lugar de devolver req.user (que solo tiene datos viejos del token),
    // consultamos al servicio los datos frescos de la DB incluyendo el tema.
    const result = await userService.getUserById(
      req.user.userId || req.user.id,
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    // El result.user ya contiene el themeConfig gracias al include que pusimos en el service
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

// Ruta para cerrar sesión
router.post("/logout", (req, res) => {
  // Aquí iría la lógica para invalidar el token si estás usando JWT
  res.status(200).json({
    success: true,
    message: "Sesión cerrada exitosamente",
  });
});

module.exports = router;
