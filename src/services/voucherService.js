const prisma = require("../middleware/prisma");
const fs = require("fs");
const path = require("path");
const { getPublicUrl } = require("../middleware/upload");
const { AppConstants } = require("../config/appConstants");

const UPLOAD_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
// process.cwd() to match voucherRoutes.js and upload.js
const UPLOAD_DIR_ABSOLUTE = path.resolve(process.cwd(), UPLOAD_FOLDER);

class VoucherService {
  async saveGlobalConfig(template, file) {
    // 1. Search for the unique global configuration (ID 1)
    const existing = await prisma.voucherConfig.findUnique({
      where: { id: 1 },
    });

    let logoPath = existing?.logoPath;

    // 2. File management (Multer)
    if (file) {
      // Delete previous logo if it exists
      if (existing?.logoPath) {
        // process.cwd() instead of __dirname to match voucherRoutes.js
        const staticPrefix = AppConstants.STATIC_URL_PREFIX;
        const relativePath = existing.logoPath.startsWith(staticPrefix)
          ? existing.logoPath.slice(staticPrefix.length + 1)
          : existing.logoPath;
        const oldPath = path.join(UPLOAD_DIR_ABSOLUTE, relativePath);
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch (e) {
            console.error("Error al borrar logo antiguo:", e);
          }
        }
      }
      // Build relative path following your standard
      logoPath = getPublicUrl(file.path); // ✅ "/images/vouchers/global-logo-xxx.ext"
    }

    // 3. Always save/update record 1
    return await prisma.voucherConfig.upsert({
      where: { id: 1 },
      update: {
        template,
        ...(file && { logoPath }),
      },
      create: {
        id: 1,
        template,
        logoPath,
      },
    });
  }

  async getGlobalConfig() {
    return await prisma.voucherConfig.findUnique({
      where: { id: 1 }
    });
  }
}

module.exports = new VoucherService();
