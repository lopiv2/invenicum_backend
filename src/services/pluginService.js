const prisma = require("../middleware/prisma");
const axios = require("axios");

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

  async createPlugin(pluginData, userId) {
    const uId = parseInt(userId);

    // 0. Buscar el usuario para obtener su identidad 'online' (username)
    const user = await prisma.user.findUnique({
      where: { id: uId },
      select: { username: true, name: true },
    });

    if (!user) throw new Error("User not found");

    if (pluginData.isPublic && !user.username) {
      throw new Error(" You must have a username to publish public plugins");
    }

    // 1. Guardar en la base de datos local (Prisma)
    const newPlugin = await prisma.$transaction(async (tx) => {
      const p = await tx.plugin.create({
        data: {
          id: pluginData.id,
          name: pluginData.name,
          version: pluginData.version || "1.0.0",
          ui: pluginData.ui,
          slot: pluginData.slot,
          isPublic: pluginData.isPublic,
          authorId: uId,
        },
      });

      await tx.userPlugin.create({
        data: { userId: uId, pluginId: p.id, isActive: true },
      });
      return p;
    });

    // 2. Si es público, sincronizar con GitHub
    if (newPlugin.isPublic) {
      try {
        // A. Subimos el contenido real
        const rawUrl = await this.uploadPluginJson(
          newPlugin.id,
          newPlugin.ui,
          newPlugin.name,
        );

        // B. Preparamos el objeto para el catálogo (repository.json)
        // Usamos el username como autor para que sea visible en la comunidad
        const pluginForRepo = {
          ...newPlugin,
          author: user.username, // <-- Aquí inyectamos la identidad online
          download_url: rawUrl,
        };

        // B. Actualizamos el repository.json con esa URL
        await this.pushPluginToGitHub(pluginForRepo);

        console.log("🚀 Plugin publicado globalmente con éxito");
      } catch (e) {
        console.error(
          "⚠️ Error en la publicación de GitHub, pero el plugin se creó localmente.",
        );
      }
    }

    return newPlugin;
  }

  async pushPluginToGitHub(pluginData) {
    const { GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } = process.env;
    const path = "repository.json";
    const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${path}`;
    const headers = { Authorization: `token ${GITHUB_TOKEN}` };

    try {
      // 1. Obtener el archivo actual
      const { data: fileData } = await axios.get(url, { headers });
      const repoContent = JSON.parse(
        Buffer.from(fileData.content, "base64").toString(),
      );

      // 2. Preparar el nuevo objeto del plugin
      // Usamos el ID del plugin para ver si ya existe en la lista
      const pluginIndex = repoContent.plugins.findIndex(
        (p) => p.id === pluginData.id,
      );

      const newEntry = {
        id: pluginData.id,
        name: pluginData.name,
        version: pluginData.version || "1.0.0",
        description:
          pluginData.description || "Plugin created by the community",
        author: pluginData.authorName || "Community User", // Creator friendly name
        isOfficial: false, // Updated to false since it's a community plugin
        download_url: `https://raw.githubusercontent.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/main/plugins/${pluginData.id}.json`,
      };

      // 3. Actualizar o Añadir
      if (pluginIndex !== -1) {
        repoContent.plugins[pluginIndex] = newEntry;
      } else {
        repoContent.plugins.push(newEntry);
      }

      // 4. Hacer el Push de vuelta a GitHub
      await axios.put(
        url,
        {
          message: `Comunidad: Añadido plugin ${pluginData.name}`,
          content: Buffer.from(JSON.stringify(repoContent, null, 2)).toString(
            "base64",
          ),
          sha: fileData.sha,
        },
        { headers },
      );

      console.log("✅ Índice repository.json actualizado en GitHub");
    } catch (error) {
      console.error(
        "❌ Error actualizando el índice:",
        error.response?.data || error.message,
      );
    }
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

  async uploadPluginJson(pluginId, uiContent, pluginName) {
    const { GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } = process.env;

    // Ruta donde se guardará: carpeta 'plugins' + id del plugin + .json
    const path = `plugins/${pluginId}.json`;
    const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${path}`;
    const headers = { Authorization: `token ${GITHUB_TOKEN}` };
    console.log(`Intentando subir a: ${url}`); // <--- DEBUG
    try {
      let sha;
      try {
        // Intentamos obtener el archivo por si ya existe (para el SHA)
        const { data } = await axios.get(url, { headers });
        sha = data.sha;
        console.log("Archivo encontrado, actualizando con SHA:", sha);
      } catch (e) {
        console.log("Archivo nuevo, no requiere SHA");
        // Si no existe, no pasa nada, sha será undefined y GitHub lo creará de cero
      }

      // El contenido debe ir en Base64
      const contentBase64 = Buffer.from(
        JSON.stringify(uiContent, null, 2),
      ).toString("base64");

      await axios.put(
        url,
        {
          message: `Update plugin content: ${pluginName}`,
          content: contentBase64,
          sha: sha,
        },
        { headers },
      );

      console.log(`✅ Archivo JSON de ${pluginName} subido a GitHub`);

      // Devolvemos la URL "raw" para guardarla en el índice
      return `https://raw.githubusercontent.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/main/${path}`;
    } catch (error) {
      console.error(
        "DETALLE DEL ERROR GITHUB:",
        error.response?.status,
        error.response?.data,
      );
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

      // 2. Descargar UI si es necesario (GitHub)
      let uiData = pluginData.ui;
      if (!uiData) {
        const urlToDownload =
          pluginData.download_url || pluginData.downloadUrl || pluginData.url;
        if (urlToDownload) {
          const response = await axios.get(urlToDownload);
          uiData = response.data;
        }
      }

      const incomingVersion = pluginData.version || "1.0.0";

      // 3. UPSERT: Si la tabla está vacía, esto creará el primer registro sin fallar
      await prisma.plugin.upsert({
        where: { id: targetPluginId },
        update: {
          version: incomingVersion, // Actualiza la versión si ya existe
          ui: uiData,
        },
        create: {
          id: targetPluginId,
          name: pluginData.name || "No name",
          version: incomingVersion,
          description: pluginData.description || "",
          slot: pluginData.slot || "dashboard_top",
          ui: uiData || {},
          isPublic: true,
          authorId: finalAuthorId,
        },
      });

      // 4. Relación UserPlugin
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
      // 🔍 ESTO ES VITAL: Mira la consola de tu BACKEND (Node) para ver el mensaje real
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
