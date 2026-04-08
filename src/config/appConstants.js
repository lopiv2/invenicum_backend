// config/appConstants.js
// Constantes de the aplicación que no varían entre entornos.
// No leer from process.env — son valores fijos del producto.

class AppConstants {
  static STATIC_URL_PREFIX = "/images";

  static API_VERSION = "v1";

  static UPLOAD_FOLDER_ASSET_TYPES_SUBDIR = "asset-types";
}

module.exports = { AppConstants };
