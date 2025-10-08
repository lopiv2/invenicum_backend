// app.js

// Importa el módulo Express
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs"); // Importamos fs para verificar la carpeta
require("dotenv").config(); // Asegúrate de cargar las variables
const authRoutes = require("./routes/auth");

const containerRoutes = require("./routes/containersRoutes");

const assetTypeRoutes = require("./routes/assetTypeRoutes");

const itemRoutes = require("./routes/itemRoutes");

// ... (imports de rutas se mantienen igual) ...

// Crea una instancia de la aplicación Express
const app = express();

// 🔑 CONSTANTES DE ENTORNO
const STATIC_URL_PREFIX = process.env.STATIC_URL_PREFIX || "/images";
const UPLOAD_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
const API_VERSION = process.env.API_VERSION || "v1";
const port = process.env.PORT || 3000;

// ----------------------------------------------------
// 1. CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS
// ----------------------------------------------------
const UPLOAD_DIR_ABSOLUTE = path.join(__dirname, UPLOAD_FOLDER);

// 💡 Buena práctica: Asegurar que el directorio de subidas exista.
if (!fs.existsSync(UPLOAD_DIR_ABSOLUTE)) {
  fs.mkdirSync(UPLOAD_DIR_ABSOLUTE, { recursive: true });
  console.log(`Created uploads directory: ${UPLOAD_DIR_ABSOLUTE}`);
}

// 🔑 USANDO VARIABLES DE ENTORNO: Sirve archivos estáticos
// e.g., app.use('/images', express.static('/ruta/absoluta/uploads/inventory'));
app.use(STATIC_URL_PREFIX, express.static(UPLOAD_DIR_ABSOLUTE));

// ----------------------------------------------------
// 2. MIDDLEWARES (CORS, JSON)
// ----------------------------------------------------
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// ----------------------------------------------------
// 3. RUTAS
// ----------------------------------------------------

// Ruta raíz
app.get("/", (req, res) => {
  res.send(`
 <h1>API de Invenicum</h1>
 ...
 <p>Versión: ${API_VERSION}</p>
 <p>Archivos Estáticos Servidos en: ${STATIC_URL_PREFIX}</p>
<p>Timestamp: ${new Date().toISOString()}</p>
 `);
});

// Usar las rutas con la versión de API
const API_BASE_PATH = "/api/" + API_VERSION;
app.use(API_BASE_PATH + "/auth", authRoutes);
app.use(API_BASE_PATH + "/", containerRoutes);
app.use(API_BASE_PATH + "/", assetTypeRoutes);
app.use(API_BASE_PATH + "/", itemRoutes);

// Inicia el servidor
app.listen(port, () => {
  console.log(`La aplicación está corriendo en http://localhost:${port}`);
  console.log(`API Base Path: http://localhost:${port}${API_BASE_PATH}`);
  console.log(
    `Imágenes Estáticas en: http://localhost:${port}${STATIC_URL_PREFIX}`
  );
});
