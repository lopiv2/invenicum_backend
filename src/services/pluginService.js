const { PrismaClient } = require("@prisma/client");
const axios = require("axios");
const prisma = new PrismaClient();

// Nota: dotenv.config() suele ir en el index.js principal,
// pero dejarlo aquí no rompe nada si prefieres seguridad.
require("dotenv").config();

class PluginService {
  /**
   * Privado: Obtiene plugins desde el repositorio externo (GitHub)
   */
  async _getGitHubPlugins() {
    try {
      const repoUrl = process.env.GITHUB_PLUGIN_REPO;
      console.log("🔍 Obteniendo plugins de GitHub desde: %s", repoUrl);
      if (!repoUrl) return [];

      const response = await axios.get(repoUrl);
      const systemAuthorId = process.env.SYSTEM_AUTHOR_ID || "github-system";

      return response.data.plugins.map((p) => ({
        ...p,
        isOfficial: true,
        isPublic: true,
        authorId: systemAuthorId,
      }));
    } catch (error) {
      console.error("❌ Error GitHub:", error.message);
      return [];
    }
  }

  /**
   * Obtiene la mezcla de plugins locales y de GitHub para la tienda
   */
  async getAllCommunityPlugins(userId) {
    // 1. Plugins de la base de datos
    const dbPlugins = await prisma.plugin.findMany({
      where: { isPublic: true },
    });

    const formattedDb = dbPlugins.map((p) => ({
      ...p,
      isMine: p.authorId === userId,
      isOfficial: false,
    }));

    // 2. Plugins de GitHub
    const githubPlugins = await this._getGitHubPlugins();

    // 3. Unimos ambos (Los oficiales suelen ir primero)
    return [...githubPlugins, ...formattedDb];
  }

  /**
   * Instala un plugin (Soporta IDs de DB o Datos de GitHub)
   */
  async installPlugin(userId, pluginData) {
    const targetPluginId =
      typeof pluginData === "string" ? pluginData : pluginData.id;
    const uId = parseInt(userId);

    console.log("--- INICIANDO ESCANEO DE INSTALACIÓN ---");
    console.log(`> Usuario: ${uId} | Plugin: ${targetPluginId}`);

    // 1. VERIFICAR QUE EL USUARIO EXISTE
    const userExists = await prisma.user.findUnique({ where: { id: uId } });
    if (!userExists) {
      throw new Error(
        `CRÍTICO: El usuario ${uId} no existe en la tabla User. No se puede asignar autoría.`,
      );
    }

    // 2. INTENTAR CREAR EL PLUGIN GLOBAL (SI NO EXISTE)
    const pluginExists = await prisma.plugin.findUnique({
      where: { id: targetPluginId },
    });

    if (!pluginExists) {
      console.log("> El plugin no existe globalmente. Intentando crear...");
      try {
        // 🚩 FORZAMOS LA EXTRACCIÓN: Probamos todos los nombres posibles
        const urlToDownload =
          pluginData.download_url || pluginData.downloadUrl || pluginData.url;

        console.log(`> URL detectada para descarga: ${urlToDownload}`);

        if (!urlToDownload) {
          // Imprimimos el objeto completo para ver qué campos tiene realmente
          console.error(
            "> Contenido de pluginData recibido:",
            JSON.stringify(pluginData),
          );
          throw new Error(
            "No se encontró una URL de descarga válida en los datos del plugin.",
          );
        }

        const stacResponse = await axios.get(urlToDownload);
        console.log("> STAC descargado con éxito.");

        await prisma.plugin.create({
          data: {
            id: targetPluginId,
            name: pluginData.name,
            description: pluginData.description || "",
            slot: "dashboard_top",
            ui: stacResponse.data, // Aquí guardamos el JSON del reloj
            isPublic: true,
            authorId: uId,
          },
        });
        console.log("✅ PASO 1 EXITOSO: Plugin creado globalmente.");
      } catch (e) {
        console.error("❌ FALLO EN PASO 1 (Tabla Plugin):", e.message);
        throw e;
      }
    } else {
      console.log("i) El plugin ya existe globalmente.");
    }

    // 3. INTENTAR CREAR LA RELACIÓN
    console.log("> Intentando crear relación UserPlugin...");
    try {
      const result = await prisma.userPlugin.upsert({
        where: {
          userId_pluginId: {
            userId: uId,
            pluginId: targetPluginId,
          },
        },
        update: { isActive: true },
        create: {
          userId: uId,
          pluginId: targetPluginId,
          isActive: true,
        },
      });
      console.log("✅ PASO 2 EXITOSO: Relación creada.");
      return result;
    } catch (e) {
      console.error("❌ FALLO EN PASO 2 (Tabla UserPlugin):", e.message);
      if (e.code === "P2003") {
        console.error(
          "DATO CLAVE: La base de datos dice que el pluginId o userId no existen como FK.",
        );
      }
      throw e;
    }
  }

  // --- MÉTODOS DE GESTIÓN LOCAL ---

  async getUserPlugins(userId) {
    const userPlugins = await prisma.userPlugin.findMany({
      where: { userId: userId },
      include: { plugin: true },
    });

    return userPlugins.map((up) => ({
      ...up.plugin,
      isActive: up.isActive,
      isMine: up.plugin.authorId === userId,
    }));
  }

  async createPlugin(data, userId) {
    return await prisma.plugin.create({
      data: {
        ...data,
        authorId: userId,
        isPublic: data.isPublic ?? true,
      },
    });
  }

  async updatePlugin(id, data, userId) {
    const plugin = await prisma.plugin.findUnique({ where: { id } });
    if (!plugin || plugin.authorId !== userId) {
      throw new Error("No autorizado");
    }

    return await prisma.plugin.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        slot: data.slot,
        ui: data.ui,
      },
    });
  }

  async deletePlugin(id, userId) {
    const plugin = await prisma.plugin.findUnique({ where: { id } });
    if (!plugin || plugin.authorId !== userId) {
      throw new Error("No autorizado");
    }
    return await prisma.plugin.delete({ where: { id } });
  }

  async toggleUserPlugin(userId, pluginId, isActive) {
    return await prisma.userPlugin.update({
      where: { userId_pluginId: { userId, pluginId } },
      data: { isActive },
    });
  }

  async uninstallPlugin(userId, pluginId) {
    return await prisma.userPlugin.deleteMany({
      where: { userId, pluginId },
    });
  }
}

module.exports = new PluginService();
