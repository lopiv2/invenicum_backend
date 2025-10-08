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
const UPLOAD_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
const API_VERSION = process.env.API_VERSION || "v1";
const port = process.env.PORT || 3000;

// ----------------------------------------------------
// 2. CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS
// ----------------------------------------------------
const UPLOAD_DIR_ABSOLUTE = path.join(__dirname, UPLOAD_FOLDER);

// 💡 Buena práctica: Asegurar que el directorio de subidas exista.
if (!fs.existsSync(UPLOAD_DIR_ABSOLUTE)) {
  fs.mkdirSync(UPLOAD_DIR_ABSOLUTE, { recursive: true });
  console.log(`Created uploads directory: ${UPLOAD_DIR_ABSOLUTE}`);
}

// Ahora, express.static se ejecuta DESPUÉS de CORS, por lo que las cabeceras CORS
// se aplicarán correctamente a las respuestas de las imágenes.
app.use(
  process.env.STATIC_URL_PREFIX,
  express.static(path.join(__dirname, process.env.UPLOAD_FOLDER))
);

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
