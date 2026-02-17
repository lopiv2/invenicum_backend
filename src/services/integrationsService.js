const prisma = require("../middleware/prisma");
const IntegrationDTO = require("../models/integrationModel");
const { encrypt, decrypt } = require("../middleware/cryptoUtils");
const { GoogleGenAI } = require("@google/genai");

class IntegrationService {
  /**
   * Realiza una prueba de conexión sin guardar datos
   */
  async testConnection(type, config) {
    try {
      switch (type) {
        case "gemini": {
          if (!config.apiKey) throw new Error("API Key requerida");

          // 1. Inicializamos un cliente temporal con la clave que viene de Flutter
          const tempClient = new GoogleGenAI({ apiKey: config.apiKey });
          let defaultModel = "gemini-3-flash-preview";
          if (config.model) defaultModel = config.model;

          // 2. Intentamos una llamada mínima para validar la clave.
          // Usamos el modelo flash por ser más rápido y barato para un test.

          // Hacemos una petición "vacía" o mínima.
          // Si la clave es falsa, Google devolverá un 401 o 403 aquí.
          const response = await tempClient.models.generateContent({
            model: defaultModel || "gemini-3-flash-preview",
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: "hi",
                  },
                ],
              },
            ],
            config: {
              generationConfig: { maxOutputTokens: 1 },
            },
          });

          return {
            success: true,
            message: "Conexión con Gemini establecida correctamente",
          };
        }

        default:
          return {
            success: false,
            message: `El tipo '${type}' no tiene test automático implementado`,
          };
      }
    } catch (error) {
      // Si el error viene del SDK de Google, suele estar en error.response.data o error.message
      const googleError = error.response?.data?.error?.message || error.message;

      let msg = "Error de conexión";
      if (googleError.includes("API key not valid"))
        msg = "La API Key de Google no es válida";
      if (googleError.includes("403"))
        msg = "Permisos insuficientes para Gemini";

      return { success: false, message: msg };
    }
  }

  /**
   * Guarda o actualiza la configuración de una integración
   */
  async saveConfig(userId, type, config) {
    // 1. CIFRAMOS MANUALMENTE AQUÍ
    const configString = JSON.stringify(config);
    const encryptedData = encrypt(configString);

    const result = await prisma.userIntegration.upsert({
      where: { userId_type: { userId: parseInt(userId), type } },
      update: {
        config: { data: encryptedData },
        isActive: true,
      },
      create: {
        userId: parseInt(userId),
        type,
        config: { data: encryptedData },
        isActive: true,
      },
    });

    // Devolvemos el DTO (el DTO debe recibir la config ya descifrada)
    result.config = config;
    return new IntegrationDTO(result);
  }

  /**
   * Obtiene la configuración descifrada para una integración específica
   */
  async getConfig(userId, type) {
    const record = await prisma.userIntegration.findUnique({
      where: { userId_type: { userId: parseInt(userId), type } },
    });
    if (!record || !record.config?.data) return null;

    // 2. DESCIFRAMOS MANUALMENTE AQUÍ
    try {
      const decrypted = decrypt(record.config.data);
      console.log("🔐 Config descifrada:", decrypted);
      record.config = JSON.parse(decrypted);
      return new IntegrationDTO(record);
    } catch (e) {
      console.error("Error descifrando integración:", e.message);
      return null;
    }
  }

  /**
   * Obtiene el mapa de estados para los checks de la UI en Flutter
   */
  async getStatuses(userId) {
    const integrations = await prisma.userIntegration.findMany({
      where: {
        userId: parseInt(userId),
        isActive: true, // Solo las activas
      },
    });

    // 🚩 Para Flutter es mejor un Mapa { "gemini": true, "telegram": true }
    // Pero si quieres seguir usando DTOs para una lista:
    return integrations.map((i) => new IntegrationDTO(i));
  }

  /**
   * Desactiva una integración sin borrar los datos
   */
  async deleteIntegration(userId, type) {
    return await prisma.userIntegration.update({
      where: { userId_type: { userId: parseInt(userId), type: type } },
      data: { isActive: false },
    });
  }
}

module.exports = new IntegrationService();
