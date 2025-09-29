// Importa el módulo Express
const express = require("express");
const cors = require("cors");

// Importa las rutas
const authRoutes = require("./routes/auth");
const containerRoutes = require("./routes/containersRoutes");
const assetTypeRoutes = require("./routes/assetTypeRoutes");

// Crea una instancia de la aplicación Express
const app = express();

// Configuración de CORS
app.use(
  cors({
    origin: "*", // En producción, deberías especificar el origen exacto de tu frontend
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Middleware para procesar JSON
app.use(express.json());

// Define el puerto donde el servidor escuchará
const port = process.env.PORT || 3000;

// Rutas base
app.get("/", (req, res) => {
  res.send(`
    <h1>API de Invenicum</h1>
    <h2>Endpoints disponibles:</h2>
    <ul>
      <li><strong>POST /api/auth/login</strong> - Iniciar sesión</li>
      <li><strong>POST /api/auth/register</strong> - Registrar nuevo usuario</li>
      <li><strong>POST /api/auth/logout</strong> - Cerrar sesión</li>
    </ul>
    <p>Estado: API funcionando correctamente</p>
    <p>Versión: 1.0.0</p>
    <p>Timestamp: ${new Date().toISOString()}</p>
  `);
});

// Usar las rutas de autenticación
app.use("/api/" + process.env.API_VERSION + "/auth", authRoutes);
app.use("/api/" + process.env.API_VERSION + "/", containerRoutes);
app.use("/api/" + process.env.API_VERSION + "/", assetTypeRoutes);

// Inicia el servidor
app.listen(port, () => {
  console.log(`La aplicación está corriendo en http://localhost:${port}`);
});
