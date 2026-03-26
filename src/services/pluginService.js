const prisma = require("../middleware/prisma");
const axios = require("axios");
const { Octokit } = require("@octokit/rest");
require("dotenv").config();
const semver = require("semver");
const { Temporal } = require('@js-temporal/polyfill');

class PluginService {
  // Centralizamos la configuración de GitHub para no repetir código
  get _githubConfig() {
    return {
      auth: process.env.GITHUB_TOKEN,
      owner: process.env.GITHUB_REPO_OWNER,
      repo: process.env.GITHUB_REPO_NAME,
      pluginRepoUrl: process.env.GITHUB_PLUGIN_REPO,
      pluginTemplateRepoUrl: process.env.GITHUB_TEMPLATE_REPO,
    };
  }

  async _incrementPluginDownloadCount(pluginId) {
    const { auth, owner, repo, pluginRepoUrl } = this._githubConfig;
    const octokit = new Octokit({ auth });

    // Extraemos el nombre del archivo del índice desde la URL (ej: repository_plugin.json)
    const path = "repository_plugin.json";

    try {
      // 1. Obtener el archivo de índice actual de GitHub
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      const content = JSON.parse(
        Buffer.from(fileData.content, "base64").toString(),
      );

      // 2. Buscar el plugin y sumar 1
      let found = false;
      if (content.plugins && Array.isArray(content.plugins)) {
        content.plugins = content.plugins.map((p) => {
          if (p.id === pluginId) {
            p.downloadCount = (p.downloadCount || 0) + 1;
            found = true;
          }
          return p;
        });
      }

      if (!found) return; // Si no está en el índice, no hacemos nada

      // 3. Subir el archivo actualizado
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `📈 Analytics: Plugin ${pluginId} installed`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString(
          "base64",
        ),
        sha: fileData.sha,
      });
    } catch (error) {
      console.error(
        "❌ Error actualizando downloadCount en GitHub:",
        error.message,
      );
    }
  }

  /**
   * Privado: Obtiene plugins desde GitHub e "hidrata" cada uno con su UI y Avatar real
   */
  async _getGitHubPlugins() {
    try {
      const { pluginRepoUrl } = this._githubConfig;
      const response = await axios.get(pluginRepoUrl);

      if (response.data && Array.isArray(response.data.plugins)) {
        const basePlugins = response.data.plugins;

        // 🚩 HIDRATACIÓN: Descargamos el contenido de cada download_url en paralelo
        const hydratedPlugins = await Promise.all(
          basePlugins.map(async (plugin) => {
            try {
              // Si tiene URL de descarga, buscamos los datos completos (UI y Avatar)
              if (plugin.download_url) {
                const res = await axios.get(plugin.download_url);
                const fullData = res.data;

                return {
                  ...plugin,
                  // 🚩 Extraemos el avatar del JSON completo del plugin
                  downloadCount: plugin.downloadCount || 0,
                  authorAvatar:
                    fullData.authorAvatar ||
                    fullData.avatarUrl ||
                    plugin.authorAvatar,
                  // Extraemos la propiedad 'ui'
                  ui: fullData.ui || fullData,
                };
              }
              return plugin;
            } catch (e) {
              console.error(
                `❌ Error hidratando plugin ${plugin.id}:`,
                e.message,
              );
              return plugin;
            }
          }),
        );

        return hydratedPlugins.map((p) => ({
          ...p,
          isOfficial: true,
          isPublic: true,
        }));
      }

      return [];
    } catch (error) {
      console.error("❌ Error cargando catálogo de GitHub:", error.message);
      return [];
    }
  }

  /**
   * Crea o actualiza un plugin localmente y sincroniza con GitHub
   */
  async createPlugin(pluginData, userId) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({
      where: { id: uId },
      select: { githubHandle: true, avatarUrl: true },
    });

    if (!user || !user.githubHandle)
      throw new Error("Usuario no encontrado o sin GitHub vinculado");

    // Verificación de seguridad: Si ya existe, ¿soy el dueño?
    const existing = await prisma.plugin.findUnique({
      where: { id: pluginData.id },
    });
    if (existing && existing.author !== user.githubHandle) {
      throw new Error("No autorizado: Este plugin pertenece a otro autor");
    }

    // 3. Llamamos al método que mencionaste para hacer el trabajo sucio con GitHub
    try {
      const prData = await this.uploadPluginJson(
        pluginData,
        user.githubHandle,
        user.avatarUrl,
      );

      return {
        success: true,
        message: "Propuesta enviada a GitHub correctamente",
        prUrl: prData.html_url,
      };
    } catch (error) {
      console.error("❌ Error al proponer plugin:", error.message);
      throw new Error("Error al procesar la propuesta en GitHub");
    }
  }

  async getPluginPreview(url) {
    try {
      if (!url.startsWith("https://raw.githubusercontent.com")) {
        throw new Error("URL no permitida");
      }
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error("❌ Error en getPluginPreview:", error.message);
      throw new Error("No se pudo obtener la previsualización del plugin.");
    }
  }

  async uploadPluginJson(plugin, authorName, authorAvatar) {
    const { auth, owner, repo } = this._githubConfig;
    if (!semver.valid(plugin.version)) {
      throw new Error(
        `La versión '${plugin.version}' no es un SemVer válido (ej: 1.0.0)`,
      );
    }
    const octokit = new Octokit({ auth });

    const branchName = `plugin-submission-${plugin.id}-${Temporal.Now.instant().epochMilliseconds}`;
    const path = `plugins/${plugin.id}.json`;

    try {
      const { data: mainRef } = await octokit.git.getRef({
        owner,
        repo,
        ref: "heads/main",
      });

      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: mainRef.object.sha,
      });

      const pluginFileContent = {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        author: authorName,
        authorAvatar: authorAvatar,
        slot: plugin.slot,
        ui: plugin.ui,
      };

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch: branchName,
        message: `🚀 Propose plugin: ${plugin.name} by ${authorName}`,
        content: Buffer.from(
          JSON.stringify(pluginFileContent, null, 2),
        ).toString("base64"),
      });

      const pr = await octokit.pulls.create({
        owner,
        repo,
        title: `🆕 Plugin Submission: ${plugin.name}`,
        head: branchName,
        base: "main",
        body: `Usuario: ${authorName}\nID: ${plugin.id}\nVersión: ${plugin.version}`,
      });

      return pr.data;
    } catch (error) {
      console.error("❌ Error en flujo de PR de GitHub:", error.message);
      throw error;
    }
  }

  /**
   * Mezcla plugins locales y remotos
   */
  async getAllCommunityPlugins(userId) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({
      where: { id: uId },
      select: { githubHandle: true },
    });

    const installedPlugins = await prisma.userPlugin.findMany({
      where: { userId: uId },
      select: { pluginId: true },
    });
    const installedIds = installedPlugins.map((up) => up.pluginId);

    const dbPlugins = await prisma.plugin.findMany({
      where: { isPublic: true, id: { notIn: installedIds } },
    });

    const allGithubPlugins = await this._getGitHubPlugins();
    const githubPlugins = allGithubPlugins.filter(
      (p) => !installedIds.includes(p.id),
    );

    const communityMap = new Map();

    githubPlugins.forEach((p) => {
      communityMap.set(p.id, {
        ...p,
        isOfficial: true,
        isMine: false,
      });
    });

    dbPlugins.forEach((p) => {
      communityMap.set(p.id, {
        ...p,
        isOfficial: false,
        isMine: p.author === user?.githubHandle,
      });
    });

    return Array.from(communityMap.values());
  }

  /**
   * Instala un plugin detectando automáticamente la estructura de la UI
   */
  async installPlugin(userId, pluginData) {
    const uId = parseInt(userId);
    if (!pluginData || !pluginData.id)
      throw new Error("Datos del plugin incompletos");

    let uiData = pluginData.ui;

    if (!uiData) {
      const url =
        pluginData.download_url || pluginData.downloadUrl || pluginData.url;
      if (url) {
        const response = await axios.get(url);
        uiData = response.data.ui ? response.data.ui : response.data;
      }
    } else if (uiData.ui) {
      uiData = uiData.ui;
    }

    // Upsert del plugin sin authorId (usamos los campos de texto author y authorAvatar)
    await prisma.plugin.upsert({
      where: { id: pluginData.id },
      update: {
        name: pluginData.name,
        description: pluginData.description,
        version: pluginData.version || "1.0.0",
        ui: uiData,
        authorAvatar: pluginData.authorAvatar,
      },
      create: {
        id: pluginData.id,
        name: pluginData.name || "No name",
        version: pluginData.version || "1.0.0",
        description: pluginData.description || "",
        slot: pluginData.slot || "dashboard_top",
        ui: uiData || {},
        isPublic: true,
        author: pluginData.author,
        authorAvatar: pluginData.authorAvatar,
      },
    });

    const result = await prisma.userPlugin.upsert({
      where: { userId_pluginId: { userId: uId, pluginId: pluginData.id } },
      update: { isActive: true },
      create: { userId: uId, pluginId: pluginData.id, isActive: true },
    });

    // 2. 🚀 Sincronizar con GitHub (Sin bloquear la respuesta al usuario)
    // No usamos 'await' aquí para que el usuario no espere a GitHub para ver su plugin instalado
    this._incrementPluginDownloadCount(pluginData.id).catch(console.error);

    return result;
  }

  /**
   * Lista plugins instalados comparando handle para determinar isMine
   */
  async getUserPlugins(userId) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({
      where: { id: uId },
      select: { githubHandle: true },
    });

    const userPlugins = await prisma.userPlugin.findMany({
      where: { userId: uId },
      include: { plugin: true },
    });

    const githubPlugins = await this._getGitHubPlugins();

    return userPlugins.map((up) => {
      const installed = up.plugin;
      const remote = githubPlugins.find((p) => p.id === installed.id);
      const hasUpdate =
        remote &&
        semver.gt(
          semver.clean(remote.version) || remote.version,
          semver.clean(installed.version) || installed.version,
        );

      return {
        ...installed,
        isActive: up.isActive,
        isMine: installed.author === user?.githubHandle,
        hasUpdate: !!hasUpdate,
        latestVersion: remote ? remote.version : installed.version,
      };
    });
  }

  /**
   * Actualiza un plugin validando el handle de GitHub
   */
  async updatePlugin(id, data, uId) {
    // 1. Obtener datos del usuario desde la DB para el autor/avatar
    const user = await prisma.user.findUnique({
      where: { id: parseInt(uId) },
      select: { githubHandle: true, avatarUrl: true, name: true },
    });

    const { auth, owner, repo } = this._githubConfig;
    const octokit = new Octokit({ auth });

    // 2. Definir nombres de rama y ruta del archivo
    const branchName = `plugin-update-${id}-${Temporal.Now.instant().epochMilliseconds}`;
    const path = `plugins/${id}.json`;

    try {
      // A. Obtener referencia de main (para crear la rama)
      const { data: mainRef } = await octokit.git.getRef({
        owner,
        repo,
        ref: "heads/main",
      });

      // B. Obtener el archivo actual para conseguir su SHA (Obligatorio para actualizar)
      const { data: currentFile } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      // C. Crear la nueva rama
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: mainRef.object.sha,
      });

      // D. Preparar el contenido del JSON (igual que en uploadPluginJson)
      const pluginFileContent = {
        id: id,
        name: data.name,
        description: data.description,
        version: data.version || "1.0.0",
        author: user.githubHandle || user.name,
        authorAvatar: user.avatarUrl,
        slot: data.slot,
        ui: data.ui,
      };

      // E. Subir el archivo modificado a la nueva rama usando el SHA
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch: branchName,
        sha: currentFile.sha, // 🚩 Esto es lo que diferencia la actualización de la creación
        message: `🆙 Update plugin: ${data.name} by ${user.githubHandle}`,
        content: Buffer.from(
          JSON.stringify(pluginFileContent, null, 2),
        ).toString("base64"),
      });

      // F. Crear el Pull Request
      const pr = await octokit.pulls.create({
        owner,
        repo,
        title: `🆙 Plugin Update: ${data.name}`,
        head: branchName,
        base: "main",
        body: `Solicitud de actualización enviada por @${user.githubHandle}\nID: ${id}\nVersión: ${data.version}`,
      });

      // Una vez creado el PR con éxito:
      await prisma.plugin.update({
        where: { id: id },
        data: {
          hasPendingPR: true,
          pendingVersion: parseFloat(data.version),
        },
      });

      return pr.data;
    } catch (error) {
      console.error("❌ Error en flujo de PR de actualización:", error.message);
      throw new Error(
        "No se pudo procesar la actualización en GitHub: " + error.message,
      );
    }
  }

  /**
   * Borra un plugin validando el handle de GitHub
   */
  async deletePlugin(id, userId, deleteFromGitHub = false) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({
      where: { id: uId },
      select: { githubHandle: true },
    });
    const plugin = await prisma.plugin.findUnique({ where: { id } });

    if (!plugin || plugin.author !== user?.githubHandle) {
      throw new Error(
        "No autorizado: Solo el autor puede eliminar este plugin",
      );
    }

    if (deleteFromGitHub && plugin.isPublic) {
      const { auth, owner, repo } = this._githubConfig;
      const octokit = new Octokit({ auth });

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
          message: `🗑️ Remove plugin: ${id}`,
          sha: fData.sha,
        });
      } catch (e) {
        console.warn("No se pudo borrar de GitHub:", e.message);
      }
    }

    return await prisma.plugin.delete({ where: { id } });
  }

  async toggleUserPlugin(userId, pluginId, isActive) {
    return await prisma.userPlugin.update({
      where: { userId_pluginId: { userId: parseInt(userId), pluginId } },
      data: { isActive },
    });
  }

  async uninstallPlugin(userId, pluginId) {
    return await prisma.userPlugin.delete({
      where: { userId_pluginId: { userId: parseInt(userId), pluginId } },
    });
  }
}

module.exports = new PluginService();
