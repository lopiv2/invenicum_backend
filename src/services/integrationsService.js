const prisma = require("../middleware/prisma");
const IntegrationDTO = require("../models/integrationModel");
const { encrypt, decrypt } = require("../middleware/cryptoUtils");
const { GoogleGenAI } = require("@google/genai");
const axios = require("axios");
const {Resend} = require("resend");


class IntegrationService {
  /**
   * Realiza una prueba de conexión sin guardar datos
   */
  async testConnection(type, config) {
    console.log("Recibida petición de test:");
    console.log("Tipo:", type); // Mira qué imprime aquí (ej: 'telegram' o 'telegram_bot')
    console.log("Config:", config);
    console.log(type);
    try {
      switch (type) {
        case "email": {
          const { apiKey, fromEmail } = config;
          const resend = new Resend(apiKey);
          
          try {
            console.log("Intentando enviar mail con Resend...");

            const response = await resend.emails.send({
              from: fromEmail,
              to: "lopiv2@gmail.com", // Pon tu mail real aquí para el test
              subject: "✅ Invenicum: Test de Conexión",
              html: "<p>Si lees esto, la configuración es correcta.</p>",
            });

            if (response.error) {
              console.error("Detalle error Resend:", response.error);
              // Esto nos dirá si es 'Unauthorized', 'Invalid Sender', etc.
              throw new Error(response.error.message);
            }

            return {
              success: true,
              message: "¡Correo enviado! Revisa lopiv2@gmail.com",
            };
          } catch (error) {
            console.error("Error capturado:", error);
            throw new Error(
              error.message || "Error de red al conectar con Resend",
            );
          }
        }
        case "telegram": {
          if (!config.botToken || !config.chatId) {
            throw new Error("Token del Bot y Chat ID son requeridos");
          }

          try {
            // Probamos llamando al método getMe de Telegram para validar el token
            const response = await axios.get(
              `https://api.telegram.org/bot${config.botToken}/getMe`,
            );

            if (response.data.ok) {
              // Si el token es válido, intentamos enviar un mensaje de prueba
              await axios.post(
                `https://api.telegram.org/bot${config.botToken}/sendMessage`,
                {
                  chat_id: config.chatId,
                  text: "✅ *Invenicum:* Prueba de conexión exitosa",
                  parse_mode: "Markdown",
                },
              );

              return {
                success: true,
                message: `Conectado como @${response.data.result.username}`,
              };
            }
          } catch (error) {
            const errorMsg =
              error.response?.data?.description ||
              "Token no válido o Chat ID incorrecto";
            throw new Error(errorMsg);
          }
        }
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
        case "upcitemdb": {
          const isProTest = !!(
            config &&
            config.apiKey &&
            config.apiKey.trim() !== ""
          );
          const testURL = isProTest
            ? "https://api.upcitemdb.com/prod/v1/lookup"
            : "https://api.upcitemdb.com/prod/trial/lookup";

          console.log(
            `🚀 Iniciando test UPC (${isProTest ? "PRO" : "FREE"}). URL: ${testURL}`,
          );

          try {
            const response = await axios.post(
              testURL,
              { upc: "4002293401102" },
              {
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  "Accept-Encoding": "gzip",
                  ...(isProTest && {
                    user_key: config.apiKey,
                    key_type: "3scale",
                  }),
                },
                timeout: 5000,
              },
            );

            // ✅ Si llega aquí, es un 200 OK
            console.log("✅ Respuesta de UPCitemdb:", response.data);

            return {
              success: true,
              message: isProTest
                ? "Conexión PRO establecida correctamente"
                : "Conexión modo FREE (Trial) disponible",
            };
          } catch (error) {
            // ❌ LOG DE ERROR PARA LA CONSOLA DEL BACKEND
            console.error("❌ Error detectado en UPC Service:");
            if (error.response) {
              // El servidor respondió con un código fuera de 2xx
              console.error("Status:", error.response.status);
              console.error("Data:", JSON.stringify(error.response.data));
            } else if (error.request) {
              // La petición se hizo pero no hubo respuesta (CORS, Red, etc)
              console.error(
                "No hubo respuesta del servidor (Posible Timeout/Red)",
              );
            } else {
              console.error("Mensaje:", error.message);
            }

            // Lógica de errores existente...
            if (error.response?.status === 401)
              throw new Error("La API Key proporcionada no es válida.");
            if (error.response?.status === 429) {
              return {
                success: isProTest,
                message: "Límite de peticiones alcanzado (Rate Limit).",
              };
            }

            throw new Error(
              "Error de conexión: " +
                (error.response?.data?.message || error.message),
            );
          }
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
   * Obtiene la config de Resend desencriptada para uso interno
   */
  async getResendConfig(userId) {
    try {
      const record = await prisma.userIntegration.findUnique({
        where: { userId_type: { userId: parseInt(userId), type: "resend" } },
      });

      if (!record || !record.isActive || !record.config?.data) return null;

      const decrypted = decrypt(record.config.data);
      const configObj = JSON.parse(decrypted);

      return {
        apiKey: configObj.apiKey,
        fromEmail: configObj.fromEmail,
      };
    } catch (e) {
      console.error("❌ Error al obtener config de Resend:", e.message);
      return null;
    }
  }

  /**
   * Obtiene la config de Telegram desencriptada
   */
  async getTelegramConfig(userId) {
    try {
      const record = await prisma.userIntegration.findUnique({
        where: { userId_type: { userId: parseInt(userId), type: "telegram" } },
      });

      if (!record || !record.isActive || !record.config?.data) return null;

      const decrypted = decrypt(record.config.data);
      const configObj = JSON.parse(decrypted);

      return {
        botToken: configObj.botToken,
        chatId: configObj.chatId,
      };
    } catch (e) {
      console.error("❌ Error al obtener config de Telegram:", e.message);
      return null;
    }
  }

  /**
   * Obtiene la API Key de Gemini ya desencriptada para uso interno
   * @param {number|string} userId
   * @returns {Promise<{apiKey: string, model: string}|null>}
   */
  async getGeminiApiKey(userId) {
    try {
      // 1. Buscamos el registro en la base de datos
      const record = await prisma.userIntegration.findUnique({
        where: { userId_type: { userId: parseInt(userId), type: "gemini" } },
      });

      // 2. Si no existe o no está activa, devolvemos null
      if (!record || !record.isActive || !record.config?.data) {
        return null;
      }

      // 3. DESENCRIPTAMOS MANUALMENTE (Igual que haces en getConfig)
      const decrypted = decrypt(record.config.data);
      const configObj = JSON.parse(decrypted);

      // 4. Devolvemos solo lo necesario para la IA
      return {
        apiKey: configObj.apiKey,
        model: configObj.model || "gemini-3-flash-preview",
      };
    } catch (e) {
      console.error("❌ Error obtaining/decrypting Gemini API Key:", e.message);
      return null;
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
      record.config = JSON.parse(decrypted);
      return new IntegrationDTO(record);
    } catch (e) {
      console.error("Error decrypting config:", e.message);
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

  /**
   * Obtiene la configuración de UPCitemdb ya desencriptada para uso interno
   * @param {number|string} userId
   * @returns {Promise<{apiKey: string}|null>}
   */
  async getUpcApiKey(userId) {
    try {
      // 1. Buscamos el registro en la base de datos para el tipo 'upcitemdb'
      const record = await prisma.userIntegration.findUnique({
        where: {
          userId_type: {
            userId: parseInt(userId),
            type: "upcitemdb",
          },
        },
      });

      // 2. Si no existe, no está activa o no tiene datos, devolvemos null
      if (!record || !record.isActive || !record.config?.data) {
        return null;
      }

      // 3. DESENCRIPTAMOS MANUALMENTE usando tu utilidad de crypto
      const decrypted = decrypt(record.config.data);
      const configObj = JSON.parse(decrypted);

      // 4. Devolvemos la API Key (y cualquier otro parámetro de config si existiera)
      return {
        apiKey: configObj.apiKey,
      };
    } catch (e) {
      console.error(
        "❌ Error obtaining/decrypting UPCitemdb API Key:",
        e.message,
      );
      return null;
    }
  }
}

module.exports = new IntegrationService();
