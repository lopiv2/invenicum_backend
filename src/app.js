// app.js

// Importa el módulo Express
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config(); // Asegúrate de cargar las variables
const { Temporal } = require('@js-temporal/polyfill');
const { AppConstants } = require("./config/appConstants");
const authRoutes = require("./routes/authRoutes");
const containerRoutes = require("./routes/containersRoutes");
const assetTypeRoutes = require("./routes/assetTypeRoutes");
const itemRoutes = require("./routes/itemRoutes");
const dataListRoutes = require("./routes/dataListRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const locationRoutes = require("./routes/locationRoutes");
const loanRoutes = require("./routes/loanRoutes");
const voucherRoutes = require("./routes/voucherRoutes");
const alertRoutes = require("./routes/alertRoutes");
const aiRoutes = require("./routes/aiRoutes");
const userRoutes = require("./routes/userRoutes");
const preferencesRoutes = require("./routes/preferencesRoutes");
const pluginRoutes = require("./routes/pluginRoutes");
const integrationRoutes = require("./routes/integrationsRoutes");
const ebayRoutes = require("./routes/ebayRoutes");
const upcMarketRoutes = require("./routes/upcMarketRoutes");
const templateRoutes = require("./routes/templateRoutes");
const reportRoutes = require("./routes/reportRoutes");
const appRoutes = require("./routes/appRoutes");




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
    credentials: true
  }),
);

// 🔑 Aumenta el límite para soportar Base64 de la IA
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// 🔑 CONSTANTES DE ENTORNO
const STATIC_URL_PREFIX = AppConstants.STATIC_URL_PREFIX;
// 🔑 CAMBIO 1: UPLOAD_FOLDER debe ser la base (uploads/inventory)
const UPLOAD_BASE_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
// Definimos las subrutas dentro de esa base, usando las variables de ENV si las tuvieras:
const ASSET_TYPES_SUBDIR = AppConstants.UPLOAD_FOLDER_ASSET_TYPES_SUBDIR;

const API_VERSION = AppConstants.API_VERSION;
const port = 3000;
const WEB_BUILD_DIR = path.resolve(process.cwd(), "public/web");
const WEB_INDEX_FILE = path.join(WEB_BUILD_DIR, "index.html");
const HAS_WEB_BUILD = fs.existsSync(WEB_INDEX_FILE);

// ----------------------------------------------------
// 2. CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS Y DIRECTORIOS
// ----------------------------------------------------

// Usamos path.resolve(process.cwd(), ...) en lugar de path.join(__dirname, ...)
// para que app.js y upload.js usen EXACTAMENTE la misma ruta base.
// upload.js ya usa process.cwd() al guardar — si app.js usara __dirname y el
// servidor se arranca desde un directorio distinto al del proyecto, los archivos
// se guardarían en un sitio y Express los serviría desde otro → Cannot GET.
const UPLOAD_DIR_TO_SERVE = path.resolve(process.cwd(), UPLOAD_BASE_FOLDER);
const ASSET_TYPES_DIR = path.resolve(process.cwd(), UPLOAD_BASE_FOLDER, ASSET_TYPES_SUBDIR);

// Asegurar que los directorios existan al arrancar
[UPLOAD_DIR_TO_SERVE, ASSET_TYPES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created uploads directory: ${dir}`);
  }
});

// Mapeo: GET /images/asset-types/file.png → disco: uploads/inventory/asset-types/file.png
app.use(STATIC_URL_PREFIX, express.static(UPLOAD_DIR_TO_SERVE));
console.log(`[Static] Sirviendo ${STATIC_URL_PREFIX} → ${UPLOAD_DIR_TO_SERVE}`);

if (HAS_WEB_BUILD) {
  app.use(express.static(WEB_BUILD_DIR));
  console.log(`[Web] Sirviendo frontend web desde ${WEB_BUILD_DIR}`);
}

// ----------------------------------------------------
// 3. RUTAS
// ----------------------------------------------------

// Ruta raíz
app.get("/", (req, res) => {
  if (HAS_WEB_BUILD) {
    return res.sendFile(WEB_INDEX_FILE);
  }

  res.send(`
<h1>API de Invenicum</h1>
...
<p>Versión: ${API_VERSION}</p>
<p>Archivos Estáticos Servidos en: ${STATIC_URL_PREFIX}</p>
  <p>Ruta física servida: ${UPLOAD_DIR_TO_SERVE}</p>
<p>Timestamp: ${Temporal.Now.plainDateISO().toString()}</p>
`);
});

// Usar las rutas con la versión de API
const API_BASE_PATH = "/api/" + API_VERSION;
app.use((req, res, next) => {
  console.log(`[${Temporal.Now.plainDateISO().toString()}] ${req.method} ${req.url}`);
  console.log(
    `Auth Header: ${req.headers.authorization ? "Presente" : "AUSENTE"}`,
  );
  next();
});
app.use(API_BASE_PATH + "/auth", authRoutes);
app.use(API_BASE_PATH + "/app", appRoutes);
app.use(API_BASE_PATH + "/", containerRoutes);
app.use(API_BASE_PATH + "/", assetTypeRoutes);
app.use(API_BASE_PATH + "/", itemRoutes);
app.use(API_BASE_PATH + "/", dataListRoutes);
app.use(API_BASE_PATH + "/dashboard", dashboardRoutes);
app.use(API_BASE_PATH + "/", locationRoutes);
app.use(API_BASE_PATH + "/", loanRoutes);
app.use(API_BASE_PATH + "/", voucherRoutes);
app.use(API_BASE_PATH + "/", alertRoutes);
app.use(API_BASE_PATH + "/ai", aiRoutes);
app.use(API_BASE_PATH + "/users", userRoutes);
app.use(API_BASE_PATH + "/preferences", preferencesRoutes);
app.use(API_BASE_PATH + "/plugins", pluginRoutes);
app.use(API_BASE_PATH + "/integrations", integrationRoutes);
app.use(API_BASE_PATH + "/ebay", ebayRoutes);
app.use(API_BASE_PATH + "/market", upcMarketRoutes);
app.use(API_BASE_PATH + "/templates", templateRoutes);
app.use(API_BASE_PATH + "/reports", reportRoutes);

if (HAS_WEB_BUILD) {
  // Fallback para rutas de Flutter Web (SPA)
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith(STATIC_URL_PREFIX)) {
      return next();
    }

    return res.sendFile(WEB_INDEX_FILE);
  });
}

// ----------------------------------------------------
// 4. INICIAR EL SERVIDOR
// ----------------------------------------------------

// Inicia el servidor
app.listen(port, () => {
  console.log(`La aplicación está corriendo en http://localhost:${port}`);
  console.log(`API Base Path: http://localhost:${port}${API_BASE_PATH}`);
  console.log(
    `Imágenes Estáticas en: http://localhost:${port}${STATIC_URL_PREFIX}`,
  );
});