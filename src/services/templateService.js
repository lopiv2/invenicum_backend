const prisma = require("../middleware/prisma");
const axios = require("axios");
const { Octokit } = require("@octokit/rest");
const { v4: uuidv4 } = require("uuid");
const AssetTemplateDTO = require("../models/templateModel"); // 👈 Importamos el DTO
require("dotenv").config();

class TemplateService {
  get _githubConfig() {
    return {
      owner: process.env.GITHUB_REPO_OWNER,
      repo: process.env.GITHUB_REPO_NAME,
    };
  }

  /**
   * Guarda una plantilla en la biblioteca personal del usuario.
   */
  async saveTemplateToUser(userId, templateData) {
    try {
      const { id: templateId, isOfficial } = templateData;

      let template = await prisma.assetTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template && isOfficial) {
        // Si no tenemos los fields, los descargamos antes de guardar en caché
        let fields = templateData.fields;
        if ((!fields || fields.length === 0) && templateData.download_url) {
          const response = await axios.get(templateData.download_url);
          fields = response.data.fields;
        }

        template = await prisma.assetTemplate.create({
          data: {
            id: templateId,
            name: templateData.name,
            description: templateData.description,
            category: templateData.category,
            tags: templateData.tags || [],
            authorName: templateData.author || "Invenicum Team",
            authorAvatarUrl: templateData.authorAvatarUrl,
            fields: fields || [],
            isOfficial: true,
            isPublic: true,
            version: templateData.version || 1.0,
          },
        });
      }

      const connection = await prisma.userTemplate.upsert({
        where: { userId_templateId: { userId, templateId } },
        update: {},
        create: { userId, templateId },
      });

      return connection;
    } catch (error) {
      console.error("❌ Error al guardar en biblioteca:", error);
      throw error;
    }
  }

  async _getGitHubTemplates() {
    try {
      const { owner, repo } = this._githubConfig;
      const repoUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/repository.json`;
      const response = await axios.get(repoUrl);

      if (response.data && response.data.templates) {
        return response.data.templates.map((t) => ({
          ...t,
          isOfficial: true,
        }));
      }
      return [];
    } catch (error) {
      console.error("❌ Error GitHub API:", error.message);
      return [];
    }
  }

  /**
   * Market con Sincronización y DTO
   */
  async getAllMarketTemplates() {
    try {
      const githubTemplates = await this._getGitHubTemplates();
      if (githubTemplates.length > 0) {
        await prisma.$transaction(
          githubTemplates.map((t) =>
            prisma.assetTemplate.upsert({
              where: { id: t.id },
              update: {
                name: t.name,
                description: t.description,
                downloadUrl: t.download_url,
                downloadCount: t.downloadCount || 0,
                authorAvatarUrl: t.authorAvatarUrl,
                tags: t.tags || [],
                category: t.category,
                authorName: t.author || "Invenicum Team",
                fields: t.fields || [],
                isOfficial: true,
                isPublic: true,
              },
              create: {
                id: t.id,
                name: t.name,
                downloadUrl: t.download_url,
                downloadCount: t.downloadCount || 0,
                authorAvatarUrl: t.authorAvatarUrl,
                tags: t.tags || [],
                description: t.description,
                category: t.category,
                authorName: t.author || "Invenicum Team",
                // 🚩 HIDRATAR AL CREAR: No guardar vacío
                fields: t.fields || [],
                isOfficial: true,
                isPublic: true,
              },
            }),
          ),
        );
      }

      const dbTemplates = await prisma.assetTemplate.findMany({
        where: { isPublic: true },
        orderBy: { createdAt: "desc" },
      });
      // 🚩 Retornamos a través del DTO para normalizar fechas y campos
      return AssetTemplateDTO.fromList(dbTemplates);
    } catch (error) {
      console.error("❌ Error Market:", error);
      const cache = await prisma.assetTemplate.findMany({
        where: { isPublic: true },
      });
      return AssetTemplateDTO.fromList(cache);
    }
  }

  /**
   * Detalle Hidratado con DTO
   */
  async getTemplateDetail(id) {
    let template = await prisma.assetTemplate.findUnique({ where: { id } });
    if (!template) throw new Error("Plantilla no encontrada");
    // Si es oficial y no tiene campos, es una plantilla de GitHub "sin hidratar"
    if (
      template.isOfficial &&
      (!template.fields || template.fields.length === 0)
    ) {
      try {
        const response = await axios.get(template.downloadUrl);
        const fullData = response.data;
        // Guardamos los campos en nuestra DB para que la PRÓXIMA vez sea instantáneo
        template = await prisma.assetTemplate.update({
          where: { id },
          data: {
            fields: fullData.fields || [],
            // Aprovechamos para actualizar descripción o tags si han cambiado
            description: fullData.description || template.description,
          },
        });
        /*console.log(
          `✅ Plantilla ${id} hidratada desde GitHub y cacheada en DB.`,
        );*/
      } catch (error) {
        console.error(
          `❌ Error al hidratar detalle desde GitHub para ${id}:`,
          error.message,
        );
        // Si falla GitHub, devolvemos lo que tengamos (aunque sea vacío)
      }
    }
    return new AssetTemplateDTO(template);
  }

  /**
   * Publicación con Sistema de PR corregido
   */
  async publishTemplate(userId, templateData) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.githubHandle) throw new Error("GitHub no vinculado");

      // Generamos un ID temporal para el PR
      const templateId = `tpl_${uuidv4().substring(0, 8)}`;

      // 🚩 NO guardamos en prisma.assetTemplate.
      // Simplemente preparamos el objeto para enviar a GitHub.
      const templateToPublish = {
        id: templateId,
        name: templateData.name,
        description: templateData.description,
        category: templateData.category || "General",
        tags: templateData.tags || [],
        author: user.githubHandle,
        authorAvatarUrl: user.avatarUrl,
        fields: templateData.fields,
        isOfficial: false,
        isPublic: true, // Esto es para el JSON de GitHub
      };

      await tx.userTemplate.create({
        data: { userId, templateId },
      });

      // Abrimos el PR. Hasta que no se acepte, nadie la verá en el market.
      await this._openGitHubPullRequest(templateToPublish, user.githubHandle);

      // Devolvemos el objeto al front para que lo vea en "Mi Biblioteca" localmente
      // si hace falta, pero no persistirá en la tabla global de la DB.
      return templateToPublish;
    } catch (error) {
      console.error("❌ Error publicación:", error);
      throw error;
    }
  }

  async incrementDownloadCount(templateId) {
    const octokit = new Octokit({ auth: process.env.GITHUB_ADMIN_TOKEN });
    const { owner, repo } = this._githubConfig;
    const path = "repository.json"; // Ruta de tu archivo índice

    try {
      // 1. Obtener el archivo actual y su SHA
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      const content = JSON.parse(
        Buffer.from(fileData.content, "base64").toString(),
      );

      // 2. Buscar la plantilla e incrementar
      let found = false;
      content.templates = content.templates.map((tpl) => {
        if (tpl.id === templateId) {
          tpl.downloadCount = (tpl.downloadCount || 0) + 1;
          found = true;
        }
        return tpl;
      });

      if (!found) return; // Si no existe en el repository.json, no hacemos nada

      // 3. Subir el cambio de vuelta a GitHub
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `📈 Analytics: Increment download count for ${templateId}`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString(
          "base64",
        ),
        sha: fileData.sha, // Requerido para actualizar archivos existentes
      });
    } catch (error) {
      console.error("[INCREMENT_DOWNLOAD_ERROR]:", error.message);
      // No lanzamos el error para no bloquear la instalación al usuario si falla la analítica
    }
  }

  async _openGitHubPullRequest(template, githubHandle) {
    const octokit = new Octokit({ auth: process.env.GITHUB_ADMIN_TOKEN });
    const { owner, repo } = this._githubConfig;
    const branchName = `submission/${template.id}`;

    try {
      const { data: ref } = await octokit.git.getRef({
        owner,
        repo,
        ref: "heads/main",
      });

      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: ref.object.sha,
      });

      // Usamos el DTO para generar el JSON que irá a GitHub, pero marcándolo como oficial
      const dto = new AssetTemplateDTO(template);
      dto.isOfficial = true;

      const githubContent = dto.toJSON();

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: `templates/${template.id}.json`,
        message: `✨ Contribution: ${template.name} by @${githubHandle}`,
        content: Buffer.from(JSON.stringify(githubContent, null, 2)).toString(
          "base64",
        ),
        branch: branchName,
      });

      await octokit.pulls.create({
        owner,
        repo,
        title: `📦 Template: ${template.name}`,
        body: `Propuesta de plantilla enviada por @${githubHandle}.`,
        head: branchName,
        base: "main",
      });
    } catch (err) {
      console.error("⚠️ GitHub PR Failed:", err.message);
    }
  }
}

module.exports = new TemplateService();
