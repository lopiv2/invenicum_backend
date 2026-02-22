class UserPreferencesDTO {
  /**
   * @param {Object} prismaPreferences - El objeto crudo que devuelve Prisma
   */
  constructor(prismaPreferences) {
    const prefs = prismaPreferences || {};

    this.id = prefs.id ? parseInt(prefs.id) : null;
    this.language = prefs.language || "es";
    
    // 🔑 1. Aseguramos la moneda (coincidiendo con el default del schema)
    this.currency = prefs.currency || "EUR";

    this.aiEnabled =
      prefs.aiEnabled !== undefined ? Boolean(prefs.aiEnabled) : true;

    this.createdAt = prefs.createdAt || null;
    this.updatedAt = prefs.updatedAt || null;
    this.userId = prefs.userId ? parseInt(prefs.userId) : null;
  }

  static toPrismaData(data) {
    const prismaData = {};

    // 🔑 2. Añadimos 'currency' a la lista de campos permitidos para Prisma
    const allowedFields = ["language", "aiEnabled", "currency"];

    allowedFields.forEach((field) => {
      if (data[field] !== undefined) {
        prismaData[field] = data[field];
      }
    });

    return prismaData;
  }

  /**
   * Limpia el objeto para enviarlo a la App
   */
  toJSON() {
    return {
      id: this.id,
      language: this.language,
      // 🔑 3. IMPORTANTE: Si no lo añades aquí, Flutter nunca recibirá el campo
      currency: this.currency, 
      aiEnabled: this.aiEnabled,
      updatedAt: this.updatedAt,
      userId: this.userId,
    };
  }

  /**
   * Método estático para validar y limpiar los datos que vienen DE Flutter
   */
  static fromRequest(body) {
    const validData = {};

    if (body.language !== undefined) validData.language = String(body.language);
    
    // 🔑 4. Validamos la moneda que viene de la App
    if (body.currency !== undefined) validData.currency = String(body.currency);
    
    if (body.aiEnabled !== undefined)
      validData.aiEnabled = Boolean(body.aiEnabled);

    return validData;
  }
}

module.exports = UserPreferencesDTO;