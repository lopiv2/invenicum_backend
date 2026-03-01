const prisma = require("../middleware/prisma");
const axios = require("axios");
const { Octokit } = require("@octokit/rest");
require("dotenv").config();

class PluginService {
  // Centralizamos la configuración de GitHub para no repetir código
  get _githubConfig() {
    return {
      auth: process.env.GITHUB_ADMIN_TOKEN,
      owner: process.env.GITHUB_REPO_OWNER,
      repo: process.env.GITHUB_REPO_NAME,
      pluginRepoUrl: process.env.GITHUB_PLUGIN_REPO,
      pluginTemplateRepoUrl: process.env.GITHUB_TEMPLATE_REPO,
    };
  }
  /**
   * Privado: Obtiene plugins desde el repositorio externo (GitHub)
   */
  async _getGitHubPlugins() {
    try {
      const { pluginRepoUrl } = this._githubConfig;
      const repoUrl = pluginRepoUrl;

      console.log("🔍 Intentando leer catálogo desde:", repoUrl);

      const response = await axios.get(repoUrl);

      // Verificación de seguridad:
      // Si response.data existe y tiene la propiedad plugins, mapeamos.
      // Si no, devolvemos un array vacío.
      if (
        response.data &&
        Array.from(response.data.plugins || []).length >= 0
      ) {
        const pluginsArray = response.data.plugins || [];
        return pluginsArray.map((p) => ({
          ...p,
          isOfficial: true,
          isPublic: true,
          authorId: "system",
        }));
      }

      return [];
    } catch (error) {
      // Si el archivo no existe (404), devolvemos array vacío en lugar de error
      if (error.response?.status === 404) {
        console.warn(
          "⚠️ El archivo repository_plugin.json no existe todavía en GitHub.",
        );
        return [];
      }
      console.error("❌ Error cargando catálogo de GitHub:", error.message);
      return [];
    }
  }

  //
  async createPlugin(pluginData, userId) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({ where: { id: uId } });

    if (!user) throw new Error("User not found");

    // 1. Guardar en DB local siempre (como "Mis Plugins")
    const newPlugin = await prisma.$transaction(async (tx) => {
      const p = await tx.plugin.create({
        data: {
          id: pluginData.id,
          name: pluginData.name,
          description: pluginData.description || "",
          version: pluginData.version || "1.0.0",
          ui: pluginData.ui,
          slot: pluginData.slot || "dashboard_top",
          isPublic: pluginData.isPublic, // Aquí se decide si va a GitHub
          authorId: uId,
        },
      });

      await tx.userPlugin.create({
        data: { userId: uId, pluginId: p.id, isActive: true },
      });
      return p;
    });

    // 2. Si el usuario marcó "Público", sincronizamos con el Market de GitHub
    if (newPlugin.isPublic) {
      try {
        // Pasamos el username para que el archivo en GitHub tenga el autor correcto
        await this.uploadPluginJson(newPlugin, user.username);
      } catch (e) {
        console.error("⚠️ Error en sync inicial con GitHub:", e.message);
      }
    }
    return newPlugin;
  }

  /**
   * Obtiene el contenido de un plugin (STAC) desde una URL externa
   * Actúa como proxy para evitar problemas de CORS en el frontend
   */
  async getPluginPreview(url) {
    try {
      console.log("🌐 Proxy de Preview para: %s", url);

      // Validamos que sea una URL de confianza (opcional pero recomendado)
      if (!url.startsWith("https://raw.githubusercontent.com")) {
        throw new Error("URL no permitida");
      }

      const response = await axios.get(url);

      // Devolvemos la data. Si el JSON de GitHub tiene una estructura
      // específica (como el campo 'content'), aquí podrías normalizarlo.
      return response.data;
    } catch (error) {
      console.error("❌ Error en getPluginPreview:", error.message);
      throw new Error("No se pudo obtener la previsualización del plugin.");
    }
  }

  // githubService.js

  async uploadPluginJson(plugin, authorName) {
    const { auth, owner, repo } = this._githubConfig;
    const octokit = new Octokit({ auth });
    const path = `plugins/${plugin.id}.json`;

    // 🚩 Este es el objeto que la GitHub Action procesará
    const pluginFileContent = {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      author: authorName,
      slot: plugin.slot,
      ui: plugin.ui, // La lógica visual/funcional del plugin
    };

    try {
      let sha;
      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path });
        sha = data.sha;
      } catch (e) {
        /* Archivo nuevo */
      }

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `🚀 Publish/Update plugin: ${plugin.name}`,
        content: Buffer.from(
          JSON.stringify(pluginFileContent, null, 2),
        ).toString("base64"),
        sha,
      });
    } catch (error) {
      console.error("❌ Error subiendo a GitHub:", error.message);
      throw error;
    }
  }

  /**
   * Obtiene la mezcla de plugins locales y de GitHub para la tienda
   */
  async getAllCommunityPlugins(userId) {
    const uId = parseInt(userId);

    // 1. Plugins que ya tiene el usuario (para no mostrarlos en la tienda)
    const installedPlugins = await prisma.userPlugin.findMany({
      where: { userId: uId },
      select: { pluginId: true },
    });
    const installedIds = installedPlugins.map((up) => up.pluginId);

    // 2. Plugins de la DB (Públicos y no instalados)
    const dbPlugins = await prisma.plugin.findMany({
      where: {
        isPublic: true,
        id: { notIn: installedIds },
      },
    });

    // 3. Plugins de GitHub (No instalados)
    const allGithubPlugins = await this._getGitHubPlugins();
    const githubPlugins = allGithubPlugins.filter(
      (p) => !installedIds.includes(p.id),
    );

    // 4. DEDUPLICACIÓN: Combinar ambas listas usando un Map por ID
    // El Map asegura que cada ID sea único.
    const communityMap = new Map();

    // Primero metemos los de GitHub
    githubPlugins.forEach((p) => {
      communityMap.set(p.id, {
        ...p,
        isOfficial: p.isOfficial || false,
        isMine: false,
      });
    });

    // Luego metemos los de la DB. Si el ID ya existe, lo SOBREESCRIBE.
    // Esto es bueno porque la DB tiene la info más actual de tu servidor.
    dbPlugins.forEach((p) => {
      communityMap.set(p.id, {
        ...p,
        isOfficial: false,
        isMine: p.authorId === uId, // Marcamos si es nuestra creación
      });
    });

    // Convertimos el Map de nuevo a un Array
    return Array.from(communityMap.values());
  }

  /**
   * Instala un plugin (Soporta IDs de DB o Datos de GitHub)
   */
  async installPlugin(userId, pluginData) {
  try {
    const uId = parseInt(userId);
    // 1. Validar que recibimos datos
    if (!pluginData || !pluginData.id) {
      throw new Error("Datos del plugin incompletos");
    }

    const targetPluginId = pluginData.id;
    const finalAuthorId = pluginData.isOfficial
      ? null
      : pluginData.authorId || uId;

    // 2. Obtener y limpiar la UI (Stac fragment)
    let uiData = pluginData.ui;

    // A. Si no hay UI, intentamos descargarla de GitHub
    if (!uiData) {
      const urlToDownload =
        pluginData.download_url || pluginData.downloadUrl || pluginData.url;
      if (urlToDownload) {
        const response = await axios.get(urlToDownload);
        
        // 🚩 CORRECCIÓN: Si el JSON descargado tiene la nueva estructura, extraemos la llave 'ui'
        uiData = response.data.ui ? response.data.ui : response.data;
      }
    } else {
      // B. Si la UI ya viene en el pluginData, verificamos si está anidada
      // Esto pasa si el frontend envía el objeto del Market tal cual
      if (uiData.ui) {
        uiData = uiData.ui;
      }
    }

    const incomingVersion = pluginData.version || "1.0.0";

    // 3. UPSERT: Guardamos en la base de datos
    await prisma.plugin.upsert({
      where: { id: targetPluginId },
      update: {
        version: incomingVersion, // Mantiene la actualización de versión
        ui: uiData,               // 🚩 Ahora guardamos la UI limpia (sin metadatos)
      },
      create: {
        id: targetPluginId,
        name: pluginData.name || "No name",
        version: incomingVersion,
        description: pluginData.description || "",
        slot: pluginData.slot || "dashboard_top",
        ui: uiData || {},        // 🚩 Ahora guardamos la UI limpia
        isPublic: true,
        authorId: finalAuthorId,
      },
    });

    // 4. Relación UserPlugin (Activar el plugin para el usuario)
    return await prisma.userPlugin.upsert({
      where: {
        userId_pluginId: { userId: uId, pluginId: targetPluginId },
      },
      update: { isActive: true },
      create: {
        userId: uId,
        pluginId: targetPluginId,
        isActive: true,
      },
    });
  } catch (error) {
    console.error("❌ ERROR REAL EN EL BACKEND:", error.message);
    throw error;
  }
}

  // --- MÉTODOS DE GESTIÓN LOCAL ---

  async getUserPlugins(userId) {
    const userPlugins = await prisma.userPlugin.findMany({
      where: { userId: userId },
      include: { plugin: true },
    });

    const githubPlugins = await this._getGitHubPlugins();

    return userPlugins.map((up) => {
      const installed = up.plugin;
      const remote = githubPlugins.find((p) => p.id === installed.id);

      // Comprobamos si la versión de GitHub es distinta a la de nuestra DB
      const hasUpdate = remote && remote.version !== installed.version;

      return {
        ...installed,
        isActive: up.isActive,
        isMine: installed.authorId === userId,
        hasUpdate: !!hasUpdate,
        latestVersion: remote ? remote.version : installed.version,
      };
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

  async deletePlugin(id, userId, deleteFromGitHub = false) {
  const plugin = await prisma.plugin.findUnique({ where: { id } });

  if (!plugin || Number(plugin.authorId) !== Number(userId)) {
    throw new Error("No autorizado");
  }

  // Si es público y se solicita, borramos el archivo de la carpeta /plugins
  if (deleteFromGitHub && plugin.isPublic) {
    const { auth, owner, repo } = this._githubConfig;
    const octokit = new Octokit({ auth });

    try {
      const { data: fData } = await octokit.repos.getContent({
        owner, repo, path: `plugins/${id}.json`
      });
      
      await octokit.repos.deleteFile({
        owner,
        repo,
        path: `plugins/${id}.json`,
        message: `🗑️ Remove plugin: ${id}`,
        sha: fData.sha,
      });
      // 💡 La Action detectará el borrado y actualizará el índice global solo.
    } catch (e) {
      console.warn("No se pudo borrar de GitHub (quizás no existía):", e.message);
    }
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
