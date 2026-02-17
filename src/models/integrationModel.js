class IntegrationDTO {
  constructor(prismaIntegration) {
    // 1. Mapeo automático de todas las propiedades simples
    Object.assign(this, prismaIntegration);

    // 2. Limpieza y formateo de campos específicos
    this.id = parseInt(prismaIntegration.id);
    this.userId = parseInt(prismaIntegration.userId);

    // 3. Manejo del JSON de configuración
    // Si viene cifrado bajo la llave 'data' (como en nuestro servicio),
    // lo extraemos. Si no, lo dejamos como objeto.
    if (prismaIntegration.config) {
      this.config = prismaIntegration.config.data || prismaIntegration.config;
    }

    // 4. Asegurar que las fechas sean ISO strings para Flutter
    this.createdAt = prismaIntegration.createdAt?.toISOString();
    this.updatedAt = prismaIntegration.updatedAt?.toISOString();
  }

  /**
   * Este método es lo que Express llama automáticamente
   * cuando haces res.json(objeto)
   */
  toJSON() {
    return {
      ...this,
      // Aquí podrías filtrar campos sensibles si no quieres que
      // la API Key cifrada viaje al front por alguna razón,
      // pero para tu modal de configuración la necesitamos.
    };
  }
}

module.exports = IntegrationDTO;
