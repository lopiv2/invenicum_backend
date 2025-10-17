// app.js

// Importa el módulo Express
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config(); // Asegúrate de cargar las variables

const authRoutes = require("./routes/auth");
const containerRoutes = require("./routes/containersRoutes");
const assetTypeRoutes = require("./routes/assetTypeRoutes");
const itemRoutes = require("./routes/itemRoutes");
const dataListRoutes = require("./routes/dataListRoutes");

// Crea una instancia de la aplicación Express
const app = express();

// ----------------------------------------------------
// 1. MIDDLEWARES (CORS, JSON)
// ----------------------------------------------------
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// 🔑 CONSTANTES DE ENTORNO
const STATIC_URL_PREFIX = process.env.STATIC_URL_PREFIX || "/images";
// 🔑 CAMBIO 1: UPLOAD_FOLDER debe ser la base (uploads/inventory)
const UPLOAD_BASE_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
// Definimos las subrutas dentro de esa base, usando las variables de ENV si las tuvieras:
const ASSET_TYPES_SUBDIR =
  process.env.UPLOAD_FOLDER_ASSET_TYPES_SUBDIR || "asset-types";

const API_VERSION = process.env.API_VERSION || "v1";
const port = process.env.PORT || 3000;

// ----------------------------------------------------
// 2. CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS Y DIRECTORIOS
// ----------------------------------------------------

// 🔑 CAMBIO 2: La ruta física que Express va a servir es la base 'uploads/inventory'
const UPLOAD_DIR_TO_SERVE = path.join(__dirname, UPLOAD_BASE_FOLDER);
// La subcarpeta donde Multer guardará físicamente los Asset Types:
const ASSET_TYPES_DIR = path.join(UPLOAD_DIR_TO_SERVE, ASSET_TYPES_SUBDIR);

// 💡 Asegurar que todos los directorios de subida existan
// 🔑 Cambio 3: Solo verificamos las carpetas que contienen archivos.
[UPLOAD_DIR_TO_SERVE, ASSET_TYPES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created uploads directory: ${dir}`);
  }
});

// 🔑 CAMBIO 4: Servir archivos estáticos DESDE UPLOAD_BASE_FOLDER.
// Esto mapea: URL /images/* -->  FÍSICO path/to/project/uploads/inventory/*
app.use(STATIC_URL_PREFIX, express.static(UPLOAD_DIR_TO_SERVE));

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
  <p>Ruta física servida: ${UPLOAD_DIR_TO_SERVE}</p>
<p>Timestamp: ${new Date().toISOString()}</p>
`);
});

// Usar las rutas con la versión de API
const API_BASE_PATH = "/api/" + API_VERSION;
app.use(API_BASE_PATH + "/auth", authRoutes);
app.use(API_BASE_PATH + "/", containerRoutes);
app.use(API_BASE_PATH + "/", assetTypeRoutes);
app.use(API_BASE_PATH + "/", itemRoutes);
app.use(API_BASE_PATH + "/", dataListRoutes);

// Inicia el servidor
app.listen(port, () => {
  console.log(`La aplicación está corriendo en http://localhost:${port}`);
  console.log(`API Base Path: http://localhost:${port}${API_BASE_PATH}`);
  console.log(
    `Imágenes Estáticas en: http://localhost:${port}${STATIC_URL_PREFIX}`
  );
});
