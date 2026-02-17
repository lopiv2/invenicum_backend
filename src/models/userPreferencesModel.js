class UserPreferencesDTO {
  /**
   * @param {Object} prismaPreferences - El objeto crudo que devuelve Prisma
   */
  constructor(prismaPreferences) {
    // Si por alguna razón no hay preferencias (usuario recién creado sin ellas),
    // inicializamos valores por defecto seguros.
    const prefs = prismaPreferences || {};

    // 1. ID único de la preferencia
    this.id = prefs.id ? parseInt(prefs.id) : null;

    // 2. Idioma: Mantenemos el 'es' por defecto del schema
    this.language = prefs.language || "es";

    // 3. AI Enabled: Este es el booleano que controla el Switch de Flutter
    // Forzamos a booleano real por seguridad
    this.aiEnabled =
      prefs.aiEnabled !== undefined ? Boolean(prefs.aiEnabled) : true;

    // 4. Fechas de auditoría (opcionales para el frontend, pero útiles)
    this.createdAt = prefs.createdAt || null;
    this.updatedAt = prefs.updatedAt || null;

    // 5. Relación con el usuario
    this.userId = prefs.userId ? parseInt(prefs.userId) : null;
  }

  static toPrismaData(data) {
    const prismaData = {};

    // Lista de campos que permitimos actualizar
    const allowedFields = ["language", "aiEnabled"];

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
      aiEnabled: this.aiEnabled,
      updatedAt: this.updatedAt,
      userId: this.userId,
    };
  }

  /**
   * Método estático para validar y limpiar los datos que vienen DE Flutter
   * Útil para el endpoint PUT /preferences
   */
  static fromRequest(body) {
    const validData = {};

    if (body.language !== undefined) validData.language = String(body.language);
    if (body.aiEnabled !== undefined)
      validData.aiEnabled = Boolean(body.aiEnabled);

    return validData;
  }
}

module.exports = UserPreferencesDTO;
