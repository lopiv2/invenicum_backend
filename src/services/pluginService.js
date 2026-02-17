const prisma = require("../middleware/prisma");
const axios = require("axios");
const { Octokit } = require("@octokit/rest");
const { decrypt } = require("../middleware/cryptoUtils");
require("dotenv").config();

class PluginService {
  // Centralizamos la configuración de GitHub para no repetir código
  get _githubConfig() {
    return {
      auth: process.env.GITHUB_ADMIN_TOKEN,
      owner: process.env.GITHUB_REPO_OWNER,
      repo: process.env.GITHUB_REPO_NAME,
    };
  }
  /**
   * Privado: Obtiene plugins desde el repositorio externo (GitHub)
   */
  async _getGitHubPlugins() {
    try {
      const { owner, repo } = this._githubConfig;
      const repoUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/repository.json`;

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
          "⚠️ El archivo repository.json no existe todavía en GitHub.",
        );
        return [];
      }
      console.error("❌ Error cargando catálogo de GitHub:", error.message);
      return [];
    }
  }

  async createPlugin(pluginData, userId) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({ where: { id: uId } });

    if (!user) throw new Error("User not found");
    if (pluginData.isPublic && !user.username) {
      throw new Error("You must have a username to publish public plugins");
    }

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

    if (newPlugin.isPublic) {
      try {
        // Subimos el JSON individual
        await this.uploadPluginJson(newPlugin.id, newPlugin.ui, newPlugin.name);

        // Actualizamos el índice global
        const pluginForRepo = {
          ...newPlugin,
          author: user.username,
        };
        await this.pushPluginToGitHub(pluginForRepo);
        console.log("🚀 Publicado en GitHub con Token Maestro");
      } catch (e) {
        console.error("⚠️ Error sincronizando con GitHub:", e.message);
      }
    }
    return newPlugin;
  }

  async pushPluginToGitHub(pluginData) {
    const { auth, owner, repo } = this._githubConfig;
    const octokit = new Octokit({ auth });
    const path = "repository.json";

    try {
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      // 1. Convertimos el contenido de base64 a string
      const rawContent = Buffer.from(fileData.content, "base64").toString();

      // 2. 🌟 LA LÍNEA MÁGICA: Limpia comas sobrantes antes de ] o }
      const cleanContent = rawContent.replace(/,[ \t\r\n]*([\]}])/g, "$1");

      // 3. Parseamos el contenido ya limpio
      const repoContent = JSON.parse(cleanContent);

      const newEntry = {
        id: pluginData.id,
        name: pluginData.name,
        version: pluginData.version || "1.0.0",
        author: pluginData.author || "Community",
        isOfficial: false,
        download_url: `https://raw.githubusercontent.com/${owner}/${repo}/main/plugins/${pluginData.id}.json`,
      };

      const idx = repoContent.plugins.findIndex((p) => p.id === pluginData.id);
      if (idx !== -1) repoContent.plugins[idx] = newEntry;
      else repoContent.plugins.push(newEntry);

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `Añadido plugin ${pluginData.name}`,
        content: Buffer.from(JSON.stringify(repoContent, null, 2)).toString(
          "base64",
        ),
        sha: fileData.sha,
      });

      console.log("✅ repository.json actualizado correctamente.");
    } catch (error) {
      console.error("❌ Error actualizando repository.json:", error.message);
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
    const { auth, owner, repo } = this._githubConfig;
    const octokit = new Octokit({ auth });
    const path = `plugins/${pluginId}.json`;

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
        message: `Update plugin content: ${pluginName}`,
        content: Buffer.from(JSON.stringify(uiContent, null, 2)).toString(
          "base64",
        ),
        sha,
      });

      return `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
    } catch (error) {
      console.error("❌ Error subiendo JSON:", error.message);
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

  async deletePlugin(id, userId, deleteFromGitHub = false) {
    const plugin = await prisma.plugin.findUnique({ where: { id } });

    // Verificamos que el usuario sea el dueño
    if (!plugin || Number(plugin.authorId) !== Number(userId)) {
      throw new Error("No autorizado");
    }

    if (deleteFromGitHub && plugin.isPublic) {
      const { auth, owner, repo } = this._githubConfig;
      const octokit = new Octokit({ auth });

      try {
        // A. Borrar archivo individual
        try {
          const { data: fData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `plugins/${id}.json`,
          });
          await octokit.repos.deleteFile({
            owner,
            repo,
            path: `plugins/${id}.json`,
            message: `Delete plugin: ${id}`,
            sha: fData.sha,
          });
        } catch (e) {
          console.log("Archivo no estaba en GitHub");
        }

        // B. Borrar del índice repository.json
        const { data: iData } = await octokit.repos.getContent({
          owner,
          repo,
          path: "repository.json",
        });
        const content = JSON.parse(
          Buffer.from(iData.content, "base64").toString(),
        );

        content.plugins = content.plugins.filter((p) => p.id !== id);

        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: "repository.json",
          message: `Remove ${id} from repository`,
          content: Buffer.from(JSON.stringify(content, null, 2)).toString(
            "base64",
          ),
          sha: iData.sha,
        });

        console.log("✅ Eliminado de GitHub con éxito");
      } catch (error) {
        console.error("❌ Error eliminando de GitHub:", error.message);
      }
    }

    // Borrado de base de datos local
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
