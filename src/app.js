// app.js

// Import the module Express
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config(); // Asegura que las variables de entorno se carguen
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
const scraperRoutes = require("./routes/scraperRoutes");
const achievementRoutes = require('./routes/achievementRoutes');



// Create a instancia de the application Express
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

// Increase the limit for soportar payloads Base64 de IA
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Environment constants
const STATIC_URL_PREFIX = AppConstants.STATIC_URL_PREFIX;
// Change 1: UPLOAD_FOLDER must ser the base path (uploads/inventory)
const UPLOAD_BASE_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
// Define subpaths bajo esa base using variables de environment when existan:
const ASSET_TYPES_SUBDIR = AppConstants.UPLOAD_FOLDER_ASSET_TYPES_SUBDIR;

const API_VERSION = AppConstants.API_VERSION;
const port = 3000;
const WEB_BUILD_DIR = path.resolve(process.cwd(), "public/web");
const WEB_INDEX_FILE = path.join(WEB_BUILD_DIR, "index.html");
const HAS_WEB_BUILD = fs.existsSync(WEB_INDEX_FILE);

// ----------------------------------------------------
// 2. configuration DE ARCHIVOS ESTATICOS and DIRECTORIOS
// ----------------------------------------------------

// Use path.resolve(process.cwd(), ...) en lugar de path.join(__dirname, ...)
// so that app.js and upload.js usen EXACTAMENTE the misma base path.
// upload.js ya Use process.cwd() al guardar. if app.js used __dirname and
// the server inicia from a directorio distinto a the raiz del proyecto,
// the archivos se guardarian en a lugar and Express the serviria from otro -> Cannot GET.
const UPLOAD_DIR_TO_SERVE = path.resolve(process.cwd(), UPLOAD_BASE_FOLDER);
const ASSET_TYPES_DIR = path.resolve(process.cwd(), UPLOAD_BASE_FOLDER, ASSET_TYPES_SUBDIR);

// Ensure que the directorios existan al iniciar
[UPLOAD_DIR_TO_SERVE, ASSET_TYPES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created uploads directory: ${dir}`);
  }
});

// Mapping: GET /images/asset-types/file.png -> disk: uploads/inventory/asset-types/file.png
app.use(STATIC_URL_PREFIX, express.static(UPLOAD_DIR_TO_SERVE));
console.log(`[Static] Serving ${STATIC_URL_PREFIX} -> ${UPLOAD_DIR_TO_SERVE}`);

if (HAS_WEB_BUILD) {
  app.use(express.static(WEB_BUILD_DIR));
  console.log(`[Web] Serving web frontend from ${WEB_BUILD_DIR}`);
}

// ----------------------------------------------------
// 3. ROUTES
// ----------------------------------------------------

// Root route
app.get("/", (req, res) => {
  if (HAS_WEB_BUILD) {
    return res.sendFile(WEB_INDEX_FILE);
  }

  res.send(`
<h1>API de Invenicum</h1>
...
<p>Version: ${API_VERSION}</p>
<p>Static Files Served At: ${STATIC_URL_PREFIX}</p>
  <p>Served physical path: ${UPLOAD_DIR_TO_SERVE}</p>
<p>Timestamp: ${Temporal.Now.plainDateISO().toString()}</p>
`);
});

// Use the ROUTES with the API version
const API_BASE_PATH = "/api/" + API_VERSION;
// Exponer las mismas imágenes también bajo el prefijo de la API
// (algunos clientes hacen la petición a /api/v1/images/...)
app.use(API_BASE_PATH + STATIC_URL_PREFIX, express.static(UPLOAD_DIR_TO_SERVE));
console.log(
  `[Static] Serving ${API_BASE_PATH + STATIC_URL_PREFIX} -> ${UPLOAD_DIR_TO_SERVE}`,
);
app.use((req, res, next) => {
  console.log(`[${Temporal.Now.plainDateISO().toString()}] ${req.method} ${req.url}`);
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
app.use(API_BASE_PATH + "/scrapers", scraperRoutes);
app.use(API_BASE_PATH + "/achievements", achievementRoutes);

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
// 4. START THE SERVER
// ----------------------------------------------------

// Start the server
app.listen(port, () => {
  console.log(`The application is running at http://localhost:${port}`);
  console.log(`API Base Path: http://localhost:${port}${API_BASE_PATH}`);
  console.log(
    `Static images at: http://localhost:${port}${STATIC_URL_PREFIX}`,
  );
});
