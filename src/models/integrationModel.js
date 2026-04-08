class IntegrationDTO {
  constructor(prismaIntegration) {
    // 1. Mapping automático de todas the propiedades simples
    Object.assign(this, prismaIntegration);

    // 2. Limpieza and formateo de campos específicos
    this.id = parseInt(prismaIntegration.id);
    this.userId = parseInt(prismaIntegration.userId);

    // 3. Manejo del JSON de configuración
    // if viene encrypted bajo the llave 'data' (como en nuestro service),
    // lo extraemos. if no, lo dejamos como objeto.
    if (prismaIntegration.config) {
      this.config = prismaIntegration.config.data || prismaIntegration.config;
    }

    // 4. Ensurer que the fechas sean ISO strings for Flutter
    this.createdAt = prismaIntegration.createdAt?.toISOString();
    this.updatedAt = prismaIntegration.updatedAt?.toISOString();
  }

  /**
   * Este método es lo que Express llama automáticamente
   * when haces res.json(objeto)
   */
  toJSON() {
    return {
      ...this,
    };
  }
}

module.exports = IntegrationDTO;
