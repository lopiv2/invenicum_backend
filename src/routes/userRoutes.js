const express = require("express");
const router = express.Router();
const userService = require("../services/userService");
const verifyToken = require("../middleware/authMiddleware");
const { Temporal } = require('@js-temporal/polyfill');

// Middleware de logging (opcional, if quieres mantener the consistencia with tus otras ROUTES)
router.use((req, res, next) => {
  const timestamp = Temporal.Now.plainDateISO().toString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

router.post("/auth/github/verify", verifyToken, async (req, res) => {
  const { code } = req.body; // Código enviado desde Flutter

  try {
    // 1. Intercambiamos the código por a Access Token
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

    // 2. Use the token for pedir the data oficiales a GitHub
    const userResponse = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${accessToken}` },
    });

    // 3. Actualizamos al Use en nuestra base de data
    const updatedUser = await userService.updateProfile(req.user.id, {
      githubHandle: userResponse.data.login,
      githubId: userResponse.data.id.toString(),
      // Guardamos the URL oficial del avatar de GitHub
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
 * endpoint for Verify if a cuenta de GitHub existe and esta vinculada a a use del sistema.
 * POST /api/v1/users/verify-github
 * body: { handle: "githubUsername" }
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
 * route for update the perfil del Use
 * PUT /api/v1/users/profile
 */
router.put("/profile", verifyToken, async (req, res) => {
  try {
    // the id viene del middleware verifyToken (ajusta según cómo lo guardes: userId o id)
    const userId = req.user.userId || req.user.id;
    const { name, username, githubHandle } = req.body;

    // Validación mínima: the nombre no debería ser null if se envía
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
      // if the error es por username duplicado, devolvemos 400
      const statusCode = result.message.includes("uso") ? 400 : 500;
      return res.status(statusCode).json({
        success: false,
        message: result.message,
      });
    }

    // Devolvemos the Use actualizado (que incluirá the nuevos campos and themeConfig)
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
