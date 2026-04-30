const prisma = require("../middleware/prisma");
const axios = require("axios");
const { Octokit } = require("@octokit/rest");
const crypto = require("crypto");
const AssetTemplateDTO = require("../models/templateModel"); // 👈 Import the DTO
require("dotenv").config();
const { Temporal } = require('@js-temporal/polyfill');
const { GitHubConstants } = require("../config/githubConstants");

class TemplateService {
  get _githubConfig() {
    return GitHubConstants.getConfig();
  }

  async _getGithubConfigAsync() {
    return await GitHubConstants.getConfigWithProxyToken();
  }

  /**
   * Saves a template in the user's personal library.
   */
  async saveTemplateToUser(userId, templateData) {
    try {
      const { id: templateId } = templateData;

      // We only save the relation.
      // If your DB requires the template to exist, you can do a minimal upsert (only ID and name)
      // to satisfy referential integrity without saving all fields.
      await prisma.assetTemplate.upsert({
        where: { id: templateId },
        update: { name: templateData.name }, // Minimal update
        create: {
          id: templateId,
          name: templateData.name,
          isOfficial: true,
          isPublic: true,
        },
      });

      return await prisma.userTemplate.upsert({
        where: { userId_templateId: { userId, templateId } },
        update: {},
        create: { userId, templateId },
      });
    } catch (error) {
      console.error("❌ Error linking template to user:", error);
      throw error;
    }
  }

  async _getGitHubTemplates() {
    try {
      const { templateRepoUrl } = this._githubConfig;
      console.log(`🌐 Fetching templates from GitHub: ${templateRepoUrl}`);
      const response = await axios.get(templateRepoUrl);

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
   * Market with synchronization and DTO
   */
  async getAllMarketTemplates() {
    try {
      // 1. We get directly from GitHub
      const githubTemplates = await this._getGitHubTemplates();

      // 2. Return the data transformed by the DTO without going through Prisma
      // Note: Make sure your DTO accepts simple JS objects
      return AssetTemplateDTO.fromList(githubTemplates);
    } catch (error) {
      console.error("❌ Error getting market from GitHub:", error);
      return [];
    }
  }

  /**
   * Detalle Hidratado with DTO
   */
  async getTemplateDetail(id) {
    try {
      const templates = await this._getGitHubTemplates();
      const templateMeta = templates.find((t) => t.id === id);

      if (!templateMeta)
        throw new Error("Template not found in repository");

      // Descargamos the contenido completo (fields, etc.) from the download_url
      const response = await axios.get(templateMeta.download_url);
      const fullData = response.data;

      // Retornamos a objeto combinado (meta + contenido completo)
      return new AssetTemplateDTO({
        ...templateMeta,
        ...fullData,
      });
    } catch (error) {
      console.error(`❌ Error obteniendo detalle de ${id}:`, error.message);
      throw error;
    }
  }

  /**
   * Publicación with Sistema de PR corregido
   */
  async publishTemplate(userId, templateData) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("Usuario no encontrado");

      // 1. Generamos the ID Único so that sea the mismo en DB and GitHub
      const templateId = `tpl_${crypto.randomUUID().substring(0, 8)}`;

      // 2. Create the objeto completo with the ID inyectado
      const templateToPublish = {
        ...templateData,
        id: templateId, // 🚩 IMPORTANTE: Aquí asignamos el ID
        authorName: user.githubHandle || user.username,
        authorAvatarUrl: user.avatarUrl,
        isOfficial: false,
        isPublic: true,
        createdAt: Temporal.Now.plainDateISO().toString(),
      };

      // 3. Registro en DB Local
      await prisma.$transaction(async (tx) => {
        await tx.assetTemplate.create({
          data: {
            id: templateId,
            name: templateToPublish.name,
            description: templateToPublish.description,
            category: templateToPublish.category || "General",
            authorName: templateToPublish.authorName,
            authorAvatarUrl: templateToPublish.authorAvatarUrl,
            fields: templateToPublish.fields,
            isOfficial: false,
            isPublic: true,
          },
        });

        await tx.userTemplate.create({
          data: { userId, templateId },
        });
      });

      // 4. Enviar a GitHub (Ahora enviamos the objeto que YA TIENE the ID)
      // 🚩 Important: Pasamos templateToPublish, no templateData
      await this._openGitHubPullRequest(
        templateToPublish,
        user.githubHandle,
        templateId,
      );

      return { ...templateToPublish, status: "published_pending_index" };
    } catch (error) {
      console.error("❌ Error publicación:", error);
      throw error;
    }
  }

  async incrementDownloadCount(templateId) {
    const { auth, owner, repo } = await this._getGithubConfigAsync();
    const octokit = new Octokit({ auth });
    const path = "repository_template.json"; // El archivo de índice

    try {
      // 1. Descargamos the índice actual de GitHub
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      const content = JSON.parse(
        Buffer.from(fileData.content, "base64").toString(),
      );

      // 2. we search the template in the JSON and increment by 1
      let found = false;
      content.templates = content.templates.map((tpl) => {
        if (tpl.id === templateId) {
          tpl.downloadCount = (tpl.downloadCount || 0) + 1;
          found = true;
        }
        return tpl;
      });

      if (!found) return;

      // 3. Subimos the archivo actualizado a GitHub
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `📈 Analytics: Increment download count for ${templateId}`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString(
          "base64",
        ),
        sha: fileData.sha, // Importante: SHA actual para poder sobreescribir
      });

      console.log(`✅ Contador incrementado en GitHub para ${templateId}`);
    } catch (error) {
      console.error(
        "❌ Error al actualizar contador en GitHub:",
        error.message,
      );
    }
  }

  async _openGitHubPullRequest(template, githubHandle) {
    const { auth: token, owner, repo } = await this._getGithubConfigAsync();

    // 1. Validación de configuración básica
    if (!token) throw new Error("Configuración incompleta: Falta GITHUB_TOKEN");
    if (!owner || !repo)
      throw new Error(
        "Configuración incompleta: Falta OWNER o REPO en el servidor",
      );

    const octokit = new Octokit({ auth: token });

    try {
      // 🚀 2. VALIDACIÓN ACTIVA DEL TOKEN
      // Intentamos get the data del use autenticado for Verify the token
      await octokit.users.getAuthenticated();
      console.log("🔐 Token verificado exitosamente para el proceso de PR.");

      const branchName = `submission/${template.id}`;

      // 3. get the SHA de main
      const { data: ref } = await octokit.git.getRef({
        owner,
        repo,
        ref: "heads/main",
      });

      // 4. Create the rama
      try {
        await octokit.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branchName}`,
          sha: ref.object.sha,
        });
      } catch (e) {
        if (e.status !== 422) throw e; // 422 significa que la rama ya existe
      }

      // 5. Preparar contenido del archivo
      const dto = new AssetTemplateDTO(template);
      dto.isOfficial = true;
      const githubContent = dto.toJSON ? dto.toJSON() : dto;

      // 6. Subir archivo
      // Nombre: slug del nombre + id → ej: "retrogames-tpl_ed2de3eb.json"
      const slug = template.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const filename = `${slug}-${template.id}.json`;

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: `templates/${filename}`,
        message: `✨ Contribution: ${template.name} by @${githubHandle}`,
        content: Buffer.from(JSON.stringify(githubContent, null, 2)).toString(
          "base64",
        ),
        branch: branchName,
      });

      // 7. Create the Pull Request
      const pr = await octokit.pulls.create({
        owner,
        repo,
        title: `📦 Template: ${template.name}`,
        body: `Template proposal submitted by @${githubHandle}.\n\nID: ${template.id}`,
        head: branchName,
        base: "main",
      });

      return pr.data;
    } catch (err) {
      // Manejo de errores específico según the código de estado de GitHub
      if (err.status === 401) {
        console.error("❌ ERROR: El GITHUB_TOKEN no es válido o ha expirado.");
        throw new Error(
          "El servidor no tiene permisos para publicar en GitHub (Auth Error).",
        );
      }
      if (err.status === 404) {
        console.error(
          `❌ ERROR: No se encontró el repositorio ${owner}/${repo}.`,
        );
        throw new Error("Repositorio de destino no encontrado.");
      }

      console.error("❌ Error en el proceso de GitHub:", err.message);
      throw err;
    }
  }
}

module.exports = new TemplateService();
