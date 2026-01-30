const express = require("express");
const router = express.Router();
const userService = require("../services/userService");
const verifyToken = require("../middleware/authMiddleware");

// Middleware para logging
router.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  console.log("Body:", req.body);
  next();
});

// Ruta para iniciar sesión
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Usuario y contraseña son requeridos",
      });
    }

    const result = await userService.login({ username, password });

    console.log(`[LOGIN] Usuario ${username} ha iniciado sesión exitosamente`);
    return res.status(200).json({
      success: true,
      message: "Login exitoso",
      data: result,
    });
  } catch (error) {
    console.error(
      `[ERROR][LOGIN] Error al intentar iniciar sesión:`,
      error.message
    );
    return res.status(500).json({
      success: false,
      message: error.message || "Error en el servidor",
    });
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
      error.message
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
      req.user.userId || req.user.id
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
      error.message
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
