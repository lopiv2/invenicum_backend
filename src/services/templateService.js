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
      auth: process.env.GITHUB_TOKEN,
      repo: process.env.GITHUB_REPO_NAME,
      templateRepoUrl: process.env.GITHUB_TEMPLATE_REPO,
    };
  }

  /**
   * Guarda una plantilla en la biblioteca personal del usuario.
   */
  async saveTemplateToUser(userId, templateData) {
    try {
      const { id: templateId } = templateData;

      // Guardamos solo la relación.
      // Si tu DB requiere que la plantilla exista, puedes hacer un upsert mínimo (solo ID y nombre)
      // para satisfacer la integridad referencial sin guardar todos los campos/fields.
      await prisma.assetTemplate.upsert({
        where: { id: templateId },
        update: { name: templateData.name }, // Actualización mínima
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
      console.error("❌ Error al vincular plantilla al usuario:", error);
      throw error;
    }
  }

  async _getGitHubTemplates() {
    try {
      const { templateRepoUrl } = this._githubConfig;
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
   * Market con Sincronización y DTO
   */
  async getAllMarketTemplates() {
    try {
      // 1. Obtenemos directamente de GitHub
      const githubTemplates = await this._getGitHubTemplates();

      // 2. Retornamos los datos transformados por el DTO sin pasar por Prisma
      // Nota: Asegúrate de que tu DTO acepte objetos simples de JS
      return AssetTemplateDTO.fromList(githubTemplates);
    } catch (error) {
      console.error("❌ Error al obtener market desde GitHub:", error);
      return [];
    }
  }

  /**
   * Detalle Hidratado con DTO
   */
  async getTemplateDetail(id) {
    try {
      const templates = await this._getGitHubTemplates();
      const templateMeta = templates.find((t) => t.id === id);

      if (!templateMeta)
        throw new Error("Plantilla no encontrada en el repositorio");

      // Descargamos el contenido completo (fields, etc.) desde la download_url
      const response = await axios.get(templateMeta.download_url);
      const fullData = response.data;

      // Retornamos un objeto combinado (meta + contenido completo)
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
   * Publicación con Sistema de PR corregido
   */
  async publishTemplate(userId, templateData) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("Usuario no encontrado");

    // 1. Generamos el ID Único para que sea el mismo en DB y GitHub
    const templateId = `tpl_${uuidv4().substring(0, 8)}`;

    // 2. Creamos el objeto completo con el ID inyectado
    const templateToPublish = {
      ...templateData,
      id: templateId, // 🚩 IMPORTANTE: Aquí asignamos el ID
      authorName: user.githubHandle || user.username,
      authorAvatarUrl: user.avatarUrl,
      isOfficial: false,
      isPublic: true,
      createdAt: new Date().toISOString()
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

    // 4. Enviar a GitHub (Ahora enviamos el objeto que YA TIENE el ID)
    // 🚩 IMPORTANTE: Pasamos templateToPublish, no templateData
    await this._openGitHubPullRequest(
      templateToPublish, 
      user.githubHandle, 
      templateId
    );

    return { ...templateToPublish, status: "published_pending_index" };
  } catch (error) {
    console.error("❌ Error publicación:", error);
    throw error;
  }
}

  async incrementDownloadCount(templateId) {
    const { auth, owner, repo } = this._githubConfig;
    const octokit = new Octokit({ auth });
    const path = "repository_template.json"; // El archivo de índice

    try {
      // 1. Descargamos el índice actual de GitHub
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      const content = JSON.parse(
        Buffer.from(fileData.content, "base64").toString(),
      );

      // 2. Buscamos la plantilla en el JSON y sumamos 1
      let found = false;
      content.templates = content.templates.map((tpl) => {
        if (tpl.id === templateId) {
          tpl.downloadCount = (tpl.downloadCount || 0) + 1;
          found = true;
        }
        return tpl;
      });

      if (!found) return;

      // 3. Subimos el archivo actualizado a GitHub
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
    const token = process.env.GITHUB_TOKEN;
    const { owner, repo } = this._githubConfig;

    // 1. Validación de configuración básica
    if (!token) throw new Error("Configuración incompleta: Falta GITHUB_TOKEN");
    if (!owner || !repo)
      throw new Error(
        "Configuración incompleta: Falta OWNER o REPO en el servidor",
      );

    const octokit = new Octokit({ auth: token });

    try {
      // 🚀 2. VALIDACIÓN ACTIVA DEL TOKEN
      // Intentamos obtener los datos del usuario autenticado para verificar el token
      await octokit.users.getAuthenticated();
      console.log("🔐 Token verificado exitosamente para el proceso de PR.");

      const branchName = `submission/${template.id}`;

      // 3. Obtener el SHA de main
      const { data: ref } = await octokit.git.getRef({
        owner,
        repo,
        ref: "heads/main",
      });

      // 4. Crear la rama
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

      // 7. Crear el Pull Request
      const pr = await octokit.pulls.create({
        owner,
        repo,
        title: `📦 Template: ${template.name}`,
        body: `Propuesta de plantilla enviada por @${githubHandle}.\n\nID: ${template.id}`,
        head: branchName,
        base: "main",
      });

      return pr.data;
    } catch (err) {
      // Manejo de errores específico según el código de estado de GitHub
      if (err.status === 401) {
        console.error(
          "❌ ERROR: El GITHUB_ADMIN_TOKEN no es válido o ha expirado.",
        );
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
