const prisma = require("../middleware/prisma");
const fs = require("fs");
const path = require("path");

const UPLOAD_FOLDER = process.env.UPLOAD_FOLDER || "uploads/inventory";

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
        const oldPath = path.join(__dirname, "..", UPLOAD_FOLDER, existing.logoPath);
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch (e) {
            console.error("Error al borrar logo antiguo:", e);
          }
        }
      }
      // Construir ruta relativa siguiendo tu estándar
      logoPath = path.join("vouchers", file.filename).replace(/\\/g, "/");
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