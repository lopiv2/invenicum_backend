const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

class PluginService {
  async createPlugin(data, userId) {
    // Asegúrate de extraer los campos correctamente del objeto 'data'
    const { name, slot, ui, isPublic, description } = data;

    return await prisma.plugin.create({
      data: {
        name,
        slot,
        ui,
        description: description || "",
        isPublic: isPublic !== undefined ? isPublic : true,
        authorId: userId, // Ahora sí, el ID llega correctamente
      },
    });
  }

  async updatePlugin(id, data, userId) {
    // Añadimos userId para validar
    // Verificamos primero si es el autor
    const plugin = await prisma.plugin.findUnique({ where: { id } });

    if (!plugin || plugin.authorId !== userId) {
      throw new Error("You are not authorized to update this plugin");
    }

    return await prisma.plugin.update({
      where: { id: id },
      data: {
        name: data.name,
        description: data.description,
        slot: data.slot,
        ui: data.ui,
      },
    });
  }

  async deletePlugin(id, userId) {
    // Añadimos userId para validar
    const plugin = await prisma.plugin.findUnique({ where: { id } });

    if (!plugin || plugin.authorId !== userId) {
      throw new Error("You are not authorized to delete this plugin");
    }

    return await prisma.plugin.delete({
      where: { id: id },
    });
  }

  /**
   * Obtiene los plugins que un usuario específico tiene instalados.
   * Devuelve el JSON de UI y el Slot para que Flutter sepa dónde pintarlos.
   */
  async getUserPlugins(userId) {
    const userPlugins = await prisma.userPlugin.findMany({
      where: { userId: userId },
      include: { plugin: true },
    });

    return userPlugins.map((up) => ({
      id: up.plugin.id,
      name: up.plugin.name,
      description: up.plugin.description,
      slot: up.plugin.slot,
      ui: up.plugin.ui,
      isActive: up.isActive,
      isMine: up.plugin.authorId === userId,
    }));
  }

  async toggleUserPlugin(userId, pluginId, isActive) {
    return await prisma.userPlugin.update({
      where: {
        userId_pluginId: {
          // Usamos el índice único compuesto
          userId: userId,
          pluginId: pluginId,
        },
      },
      data: { isActive },
    });
  }

  /**
   * Obtiene todos los plugins disponibles en la tienda (comunidad)
   */
  async getAllCommunityPlugins(userId) {
    // Pasamos el userId del solicitante
    const plugins = await prisma.plugin.findMany({
      where: { isPublic: true },
    });

    return plugins.map((p) => ({
      ...p,
      isMine: p.authorId === userId, // Determina si el usuario puede borrarlo globalmente
    }));
  }

  /**
   * Vincula un plugin a un usuario (Instalación)
   */
  async installPlugin(userId, pluginId) {
    return await prisma.userPlugin.create({
      data: {
        userId: userId,
        pluginId: pluginId,
      },
    });
  }

  /**
   * Desvincula un plugin de un usuario (Desinstalación)
   */
  async uninstallPlugin(userId, pluginId) {
    return await prisma.userPlugin.deleteMany({
      where: {
        userId: userId,
        pluginId: pluginId,
      },
    });
  }
}

module.exports = new PluginService();
