// config/appConstants.js
// Constantes de la aplicación que no varían entre entornos.
// No leer desde process.env — son valores fijos del producto.

class AppConstants {
  static STATIC_URL_PREFIX = "/images";

  static API_VERSION = "v1";

  static UPLOAD_FOLDER_ASSET_TYPES_SUBDIR = "asset-types";
}

module.exports = { AppConstants };
