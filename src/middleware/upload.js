// middleware/upload.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Temporal } = require('@js-temporal/polyfill');

// ─── Constantes centralizadas ─────────────────────────────────────────────────
// Fuente de verdad única para rutas de disco y URLs públicas.
// Todos los servicios deben llamar a getPublicUrl(file.path) para obtener
// la URL que se guarda en DB — nunca construirla a mano.

const BASE_DIR = process.env.UPLOAD_FOLDER || "uploads/inventory";
const STATIC_URL_PREFIX = process.env.STATIC_URL_PREFIX || "/images";

/**
 * Convierte la ruta absoluta en disco de un archivo subido por Multer
 * a la URL pública que Express sirve correctamente.
 *
 * Ejemplo con la configuración actual:
 *   file.path  = "/app/uploads/inventory/asset-types/asset-type-123.jpg"
 *   BASE_DIR   = "uploads/inventory"   → se sirve en STATIC_URL_PREFIX
 *   resultado  = "/images/asset-types/asset-type-123.jpg"   ✅
 *
 * Sin esta función los servicios solían guardar en DB la ruta absoluta del
 * disco ("/app/uploads/inventory/...") o una URL mal construida, lo que
 * hacía que el archivo existiera físicamente pero no fuera accesible.
 *
 * @param {string} filePath - El valor de file.path que proporciona Multer
 * @returns {string} URL pública relativa (sin dominio ni puerto)
 */
function getPublicUrl(filePath) {
  const absoluteBaseDir = path.resolve(process.cwd(), BASE_DIR);
  const relativePath = path
    .relative(absoluteBaseDir, filePath)
    .replace(/\\/g, "/"); // Normalizar en Windows
  return `${STATIC_URL_PREFIX}/${relativePath}`;
}

// ─── Configuración de almacenamiento ─────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const url = req.originalUrl.toLowerCase();

    let subDir = "others";
    if (url.includes("asset-types")) {
      subDir = "asset-types";
    } else if (url.includes("items") || url.includes("assets")) {
      subDir = "items";
    }

    const finalPath = path.resolve(process.cwd(), BASE_DIR, subDir);

    try {
      if (!fs.existsSync(finalPath)) {
        fs.mkdirSync(finalPath, { recursive: true });
        console.log(`[Multer] Carpeta creada: ${finalPath}`);
      }
    } catch (err) {
      console.error("[Multer] Error creando directorio:", err);
    }

    cb(null, finalPath);
  },

  filename: (req, file, cb) => {
    const uniqueSuffix = Temporal.Now.instant().epochMilliseconds + "-" + Math.round(Math.random() * 1e9);

    let prefix = "file-";
    const url = req.originalUrl;
    if (url.includes("asset-types")) prefix = "asset-type-";
    else if (url.includes("items") || url.includes("assets")) prefix = "item-";

    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${prefix}${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const isMimetypeValid = allowedTypes.test(file.mimetype);
  const isExtValid = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );

  if (isMimetypeValid && isExtValid) {
    cb(null, true);
  } else {
    cb(
      new Error("Solo se permiten imágenes (jpeg, jpg, png, gif, webp)"),
      false
    );
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter,
});

module.exports = upload;
module.exports.getPublicUrl = getPublicUrl;