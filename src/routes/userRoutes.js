const express = require("express");
const router = express.Router();
const userService = require("../services/userService");
const verifyToken = require("../middleware/authMiddleware");

// Middleware de logging (opcional, si quieres mantener la consistencia con tus otras rutas)
router.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

router.post("/auth/github/verify", verifyToken, async (req, res) => {
  const { code } = req.body; // Código enviado desde Flutter

  try {
    // 1. Intercambiamos el código por un Access Token
    const response = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
      },
      { headers: { Accept: "application/json" } },
    );

    const accessToken = response.data.access_token;

    // 2. Usamos el token para pedir los datos oficiales a GitHub
    const userResponse = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${accessToken}` },
    });

    // 3. Actualizamos al usuario en nuestra base de datos
    const updatedUser = await userService.updateProfile(req.user.id, {
      githubHandle: userResponse.data.login,
      githubId: userResponse.data.id.toString(),
      // Guardamos la URL oficial del avatar de GitHub
      avatarUrl: userResponse.data.avatar_url,
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Error en la vinculación con GitHub" });
  }
});

/**
 * Endpoint to check if a GitHub account exists and is linked to a user in the system.
 * POST /api/v1/users/verify-github
 * Body: { handle: "githubUsername" }
 */

router.post("/verify-github", verifyToken, async (req, res) => {
  const { handle } = req.body;
  const result = await userService.verifyGitHubAccount(handle);

  if (!result.success) {
    return res.status(404).json(result);
  }
  res.json(result);
});

/**
 * Ruta para actualizar el perfil del usuario
 * PUT /api/v1/users/profile
 */
router.put("/profile", verifyToken, async (req, res) => {
  try {
    // El id viene del middleware verifyToken (ajusta según cómo lo guardes: userId o id)
    const userId = req.user.userId || req.user.id;
    const { name, username, githubHandle } = req.body;

    // Validación mínima: el nombre no debería ser null si se envía
    if (name !== undefined && name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "El nombre no puede estar vacío",
      });
    }

    const result = await userService.updateProfile(userId, {
      name,
      username,
      githubHandle,
    });

    if (!result.success) {
      // Si el error es por username duplicado, devolvemos 400
      const statusCode = result.message.includes("uso") ? 400 : 500;
      return res.status(statusCode).json({
        success: false,
        message: result.message,
      });
    }

    // Devolvemos el usuario actualizado (que incluirá los nuevos campos y themeConfig)
    return res.status(200).json({
      success: true,
      message: "Perfil actualizado con éxito",
      user: result.user,
    });
  } catch (error) {
    console.error(`[ERROR][UPDATE_PROFILE]: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Error interno al actualizar el perfil",
    });
  }
});

module.exports = router;
