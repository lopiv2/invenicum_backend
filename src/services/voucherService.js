const prisma = require("../middleware/prisma");
const fs = require("fs");
const path = require("path");
const { getPublicUrl } = require("../middleware/upload");

const UPLOAD_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";
// process.cwd() para coincidir con voucherRoutes.js y upload.js
const UPLOAD_DIR_ABSOLUTE = path.resolve(process.cwd(), UPLOAD_FOLDER);

class VoucherService {
  async saveGlobalConfig(template, file) {
    // 1. Buscar la configuración global única (ID 1)
    const existing = await prisma.voucherConfig.findUnique({
      where: { id: 1 },
    });

    let logoPath = existing?.logoPath;

    // 2. Gestión de archivos (Multer)
    if (file) {
      // Borrar logo anterior si existe
      if (existing?.logoPath) {
        // process.cwd() en lugar de __dirname para coincidir con voucherRoutes.js
        const staticPrefix = process.env.STATIC_URL_PREFIX || "/images";
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
      // Construir ruta relativa siguiendo tu estándar
      logoPath = getPublicUrl(file.path); // ✅ "/images/vouchers/global-logo-xxx.ext"
    }

    // 3. Guardar/Actualizar siempre el registro 1
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