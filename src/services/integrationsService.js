const prisma = require("../middleware/prisma");
const _ = require("lodash");
const IntegrationDTO = require("../models/integrationModel");
const { encrypt, decrypt } = require("../middleware/cryptoUtils");
const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios");
const crypto = require("crypto");
const { Resend } = require("resend");
const { DEFAULT_MODELS, AI_PROVIDERS } = require("../config/aiConstants");
const DraftItemDTO = require("../models/draftItemModel");
const InventoryItemDTO = require("../models/inventoryItemModel");
const {
  getBase64FromUrl,
  generateUniversalPrompt,
} = require("../middleware/utils");
require("dotenv").config();

class IntegrationService {
  /**
   * Realiza una prueba de conexión sin guardar datos
   */
  async testConnection(type, config, userId) {
    console.log("Recibida petición de test:");
    console.log("Tipo:", type); // Mira qué imprime aquí (ej: 'telegram' o 'telegram_bot')
    console.log("Config:", config);
    console.log(type);
    try {
      switch (type) {
        case "bgg": {
          const { bgg_username } = config;

          // 1. Validaciones básicas de entrada
          if (!bgg_username) {
            throw new Error("El nombre de usuario de BGG es requerido.");
          }

          // 2. Obtención de credenciales maestras del servidor (desde .env)
          const bggToken = process.env.BGG_APPLICATION_TOKEN;
          const userAgent = "Invenicum-Backend/1.0 (contact: lopiv2@gmail.com)";

          if (!bggToken) {
            throw new Error(
              "El servidor no tiene configurado el Application Token de BGG.",
            );
          }

          try {
            console.log(
              `🧪 Validando existencia del usuario BGG: ${bgg_username}`,
            );

            // 3. Petición autorizada a BGG
            const response = await axios.get(
              `https://boardgamegeek.com/xmlapi2/user?name=${encodeURIComponent(bgg_username)}`,
              {
                headers: {
                  Authorization: `Bearer ${bggToken}`,
                  "User-Agent": userAgent,
                },
                timeout: 5000,
              },
            );

            // BGG devuelve 200 OK aunque el usuario no exista, pero con un id vacío en el XML
            if (response.data.includes('id=""')) {
              throw new Error(
                "El usuario no existe en BoardGameGeek. Revisa el nombre.",
              );
            }

            // 4. Verificación de dependencia (Gemini)
            // Pasamos el userId que debería venir en el contexto de la llamada
            const aiClient = await this.getActiveAiClient(userId);
            const aiWarning = !aiClient
              ? " (Nota: ningún proveedor de IA configurado, el auto-completado no funcionará)"
              : "";

            return {
              success: true,
              message: `¡Conexión exitosa! Perfil de ${bgg_username} vinculado${aiWarning}.`,
            };
          } catch (error) {
            console.error("❌ Error en el Test de BGG:", error.message);

            // Manejo específico de errores de la API de BGG
            if (error.response?.status === 401) {
              throw new Error(
                "Error de servidor: El Token de Aplicación de BGG no es válido.",
              );
            }
            if (error.response?.status === 429) {
              throw new Error(
                "BGG está limitando las peticiones temporalmente. Reintenta en un momento.",
              );
            }

            throw new Error(
              error.response
                ? "Error al contactar con la API de BoardGameGeek"
                : error.message,
            );
          }
        }
        case "pokemon": {
          const pokemon_name = "Pikachu";

          // 1. Validación básica: que no esté vacío
          if (!pokemon_name) {
            throw new Error(
              "El nombre del Pokémon es requerido para la validación.",
            );
          }

          try {
            console.log(`🧪 Validando existencia de Pokémon: ${pokemon_name}`);

            // 2. Intentamos obtener el Pokémon (limpiamos el nombre por si acaso)
            // PokeAPI solo acepta minúsculas y sin espacios
            const sanitizedName = pokemon_name
              .toLowerCase()
              .trim()
              .replace(/\s+/g, "-");

            await axios.get(
              `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(sanitizedName)}`,
              { timeout: 5000 },
            );

            // 3. Verificación de Gemini (mantenemos la lógica de BGG para avisar al usuario)
            // Nota: Asegúrate de que 'userId' esté llegando a la función testConnection
            const aiClient = await this.getActiveAiClient(userId);
            const aiWarning = !aiClient
              ? " (Nota: ningún proveedor de IA configurado, las descripciones no funcionarán)"
              : "";

            return {
              success: true,
              message: `¡Pokémon ${pokemon_name} localizado!${aiWarning}.`,
            };
          } catch (error) {
            console.error("❌ Error en el Test de PokeAPI:", error.message);

            // Si la API devuelve 404, es que el nombre está mal escrito
            if (error.response?.status === 404) {
              throw new Error(
                `The Pokémon "${pokemon_name}" does not exist. Please check the spelling.`,
              );
            }

            throw new Error(
              error.response
                ? "Error al contactar con PokeAPI. Inténtalo más tarde."
                : error.message,
            );
          }
        }
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
          const defaultModel =
            config.model || DEFAULT_MODELS[AI_PROVIDERS.GEMINI];

          // 2. Intentamos una llamada mínima para validar la clave.
          // Usamos el modelo flash por ser más rápido y barato para un test.

          // Hacemos una petición "vacía" o mínima.
          // Si la clave es falsa, Google devolverá un 401 o 403 aquí.
          const response = await tempClient.models.generateContent({
            model: defaultModel,
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
        case "openai": {
          if (!config.apiKey) throw new Error("API Key requerida");
          try {
            const tempClient = new OpenAI({ apiKey: config.apiKey });
            const testModel =
              config.model || DEFAULT_MODELS[AI_PROVIDERS.OPENAI];
            await tempClient.chat.completions.create({
              model: testModel,
              messages: [{ role: "user", content: "hi" }],
              max_tokens: 1,
            });
            return {
              success: true,
              message: "Conexión con OpenAI establecida correctamente",
            };
          } catch (error) {
            throw new Error(
              error.message?.includes("401") ||
                error.message?.includes("Incorrect API key")
                ? "La API Key de OpenAI no es válida"
                : `Error de conexión: ${error.message}`,
            );
          }
        }
        case "claude": {
          if (!config.apiKey) throw new Error("API Key requerida");
          try {
            const tempClient = new Anthropic({ apiKey: config.apiKey });
            const testModel =
              config.model || DEFAULT_MODELS[AI_PROVIDERS.CLAUDE];
            await tempClient.messages.create({
              model: testModel,
              max_tokens: 1,
              messages: [{ role: "user", content: "hi" }],
            });
            return {
              success: true,
              message:
                "Conexión con Claude (Anthropic) establecida correctamente",
            };
          } catch (error) {
            throw new Error(
              error.message?.includes("401") ||
                error.message?.includes("authentication")
                ? "La API Key de Anthropic no es válida"
                : `Error de conexión: ${error.message}`,
            );
          }
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
      const parsedId = parseInt(userId);

      const record = await prisma.userIntegration.findUnique({
        where: { userId_type: { userId: parsedId, type: "gemini" } },
      });

      // Log detallado para diagnóstico — eliminar en producción
      if (!record) {
        return null;
      }

      if (!record.isActive) {
        return null;
      }

      // config viene de Prisma como objeto JSON: { data: "encrypted_string" }
      // Si config.data existe → está cifrado con nuestro encrypt()
      // Si no existe → se guardó sin cifrar (directamente el objeto)
      let apiKey, model;

      if (record.config?.data) {
        // Caso normal: cifrado
        const decrypted = decrypt(record.config.data);
        const configObj = JSON.parse(decrypted);
        apiKey = configObj.apiKey;
        model = configObj.model;
      } else if (record.config?.apiKey) {
        // Caso fallback: guardado sin cifrar (config = { apiKey: "...", model: "..." })
        apiKey = record.config.apiKey;
        model = record.config.model;
      } else {
        return null;
      }

      if (!apiKey) {
        return null;
      }

      return {
        apiKey,
        model: model || DEFAULT_MODELS[AI_PROVIDERS.GEMINI],
      };
    } catch (e) {
      console.error(
        "❌ [Gemini] Error obteniendo/descifrando API Key:",
        e.message,
      );
      return null;
    }
  }

  /**
   * Obtiene la API Key de OpenAI ya desencriptada para uso interno
   */
  async getOpenAIApiKey(userId) {
    try {
      const record = await prisma.userIntegration.findUnique({
        where: { userId_type: { userId: parseInt(userId), type: "openai" } },
      });
      if (!record || !record.isActive) return null;

      let apiKey, model;
      if (record.config?.data) {
        const configObj = JSON.parse(decrypt(record.config.data));
        apiKey = configObj.apiKey;
        model = configObj.model;
      } else if (record.config?.apiKey) {
        apiKey = record.config.apiKey;
        model = record.config.model;
      }
      if (!apiKey) return null;

      return { apiKey, model: model || DEFAULT_MODELS[AI_PROVIDERS.OPENAI] };
    } catch (e) {
      console.error("❌ [OpenAI] Error obteniendo API Key:", e.message);
      return null;
    }
  }

  /**
   * Obtiene la API Key de Anthropic/Claude ya desencriptada para uso interno
   */
  async getClaudeApiKey(userId) {
    try {
      const record = await prisma.userIntegration.findUnique({
        where: { userId_type: { userId: parseInt(userId), type: "claude" } },
      });
      if (!record || !record.isActive) return null;

      let apiKey, model;
      if (record.config?.data) {
        const configObj = JSON.parse(decrypt(record.config.data));
        apiKey = configObj.apiKey;
        model = configObj.model;
      } else if (record.config?.apiKey) {
        apiKey = record.config.apiKey;
        model = record.config.model;
      }
      if (!apiKey) return null;

      return { apiKey, model: model || DEFAULT_MODELS[AI_PROVIDERS.CLAUDE] };
    } catch (e) {
      console.error("❌ [Claude] Error obteniendo API Key:", e.message);
      return null;
    }
  }

  /**
   * Devuelve el cliente de IA activo según las preferencias del usuario.
   * Usado por getEnrichedItem y los warnings de testConnection.
   * Retorna { client, model, provider } o null si nada está configurado.
   */
  async getActiveAiClient(userId) {
    const prefs = await prisma.userPreferences.findUnique({
      where: { userId: parseInt(userId) },
      select: { aiProvider: true, aiModel: true },
    });

    const provider = prefs?.aiProvider || AI_PROVIDERS.GEMINI;
    const preferredModel = prefs?.aiModel || DEFAULT_MODELS[provider];

    switch (provider) {
      case AI_PROVIDERS.OPENAI: {
        const data = await this.getOpenAIApiKey(userId);
        if (!data) return null;
        return {
          provider,
          model: preferredModel || data.model,
          client: new OpenAI({ apiKey: data.apiKey }),
        };
      }
      case AI_PROVIDERS.CLAUDE: {
        const data = await this.getClaudeApiKey(userId);
        if (!data) return null;
        return {
          provider,
          model: preferredModel || data.model,
          client: new Anthropic({ apiKey: data.apiKey }),
        };
      }
      case AI_PROVIDERS.GEMINI:
      default: {
        const data = await this.getGeminiApiKey(userId);
        if (!data) return null;
        return {
          provider,
          model: preferredModel || data.model,
          client: new GoogleGenAI({ apiKey: data.apiKey }),
        };
      }
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

  async lookupBarcode(userId, barcode) {
    // 1. Obtener estados de integración
    const integrations = await this.getStatuses(userId);

    // 2. Verificar si upcitemdb está activa
    const upcIntegration = integrations.find((i) => i.type === "upcitemdb");
    const isUpcActive = upcIntegration?.isActive === true;

    if (isUpcActive) {
      const fullConfig = await this.getConfig(userId, "upcitemdb");

      // 🚩 EXTRACCIÓN DINÁMICA DE API KEY
      let apiKey = null;
      if (fullConfig && fullConfig.config) {
        // Si config es el string 'id:key', sacamos la segunda parte. Si es objeto, sacamos .apiKey
        if (typeof fullConfig.config === "string") {
          const parts = fullConfig.config.split(":");
          apiKey = parts.length > 1 ? parts[1] : parts[0];
        } else {
          apiKey = fullConfig.config.apiKey;
        }
      }

      // 🚩 SELECCIÓN DE ENDPOINT
      // Si tenemos apiKey -> Pro. Si no -> Trial.
      const isPro = !!apiKey;
      const baseURL = isPro
        ? "https://api.upcitemdb.com/prod/v1/lookup"
        : "https://api.upcitemdb.com/prod/trial/lookup";

      try {
        const response = await axios.get(baseURL, {
          params: { upc: barcode },
          headers: {
            Accept: "application/json",
            // Solo incluimos el header si realmente tenemos una key
            ...(isPro ? { user_key: apiKey, key_type: "free" } : {}),
          },
        });

        if (response.data.items && response.data.items.length > 0) {
          const item = response.data.items[0];
          let imageUrl =
            item.images && item.images.length > 0 ? item.images[0] : null;

          // 3. 🚩 LA MAGIA: Convertir a Base64 antes de enviar al DTO
          // Esto evita el error de pantalla blanca/CORS en Flutter Web
          if (imageUrl && imageUrl.startsWith("http")) {
            console.log(
              "🔄 Convirtiendo imagen de código de barras a Base64...",
            );
            imageUrl = await getBase64FromUrl(imageUrl);
          }

          // Mapeo al DTO (Simulando Prisma)
          const mockPrismaItem = {
            id: 0,
            name: item.title,
            description: item.description,
            barcode: barcode,
            quantity: 1,
            minStock: 0,
            marketValue: item.highest_price || 0,
            currency: "EUR",
            assetTypeId: 0,
            containerId: 0,
            images: imageUrl ? [{ id: 0, url: imageUrl, order: 0 }] : [],
            customFieldValues: {
              brand: item.brand,
              source: isPro ? "upcitemdb_pro" : "upcitemdb_trial",
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          return new InventoryItemDTO(mockPrismaItem);
        }
      } catch (err) {
        console.error(
          `❌ Error en UPCItemDB (${isPro ? "PRO" : "TRIAL"}):`,
          err.message,
        );

        // Si el Pro falla por Key inválida, podrías intentar un fallback a trial aquí si quisieras
      }
    }

    return null;
  }

  /**
   * Genera un hash único basado en las llaves del JSON (su estructura)
   */
  getStructureHash(rawData) {
    try {
      const json = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      const keys = Object.keys(json).sort().join("|");
      // Esto retorna un STRING hexadecimal
      return crypto.createHash("md5").update(keys).digest("hex");
    } catch (e) {
      console.error("Error parseando JSON para hash:", e);
      return "default-hash";
    }
  }

  applyLocalMapping(sourceJson, mappingRules) {
    const result = {
      name: _.get(sourceJson, mappingRules.name, "Sin nombre"),
      images: [{ url: _.get(sourceJson, mappingRules.image_url, "") }],
      customFieldValues: {},
    };

    // Mapear campos dinámicos
    for (const [label, path] of Object.entries(mappingRules.fields || {})) {
      result.customFieldValues[label] = _.get(sourceJson, path, "N/A");
    }
    return result;
  }

  async getEnrichedItem(userId, query, source, locale = "es") {
    const normalizedQuery = query.toLowerCase().trim();

    // --- CAPA 1: CACHÉ DE RESULTADO FINAL ---
    const cachedResult = await prisma.enrichedCache.findUnique({
      where: {
        source_query_locale: { source, query: normalizedQuery, locale },
      },
    });
    if (cachedResult) return cachedResult.data;

    // --- CAPA 2: OBTENCIÓN DE DATOS RAW ---
    const aiData = await this.getActiveAiClient(userId);
    if (!aiData)
      throw new Error(
        "Ningún proveedor de IA configurado. Ve a Integraciones.",
      );

    let rawData = "";
    let contextHint = "";

    switch (source) {
      case "pokemon": {
        contextHint = "un Pokémon de PokeAPI";
        const pokemonName = normalizedQuery.replace(/\s+/g, "-");
        const pokeRes = await axios.get(
          `https://pokeapi.co/api/v2/pokemon/${pokemonName}`,
        );
        rawData = JSON.stringify(pokeRes.data);
        break;
      }
      case "bgg": {
        contextHint = "un juego de mesa de BoardGameGeek";
        const bggHeaders = {
          Authorization: `Bearer ${process.env.BGG_APPLICATION_TOKEN}`,
          "User-Agent": "Invenicum-Backend/1.0",
        };
        const searchRes = await axios.get(
          `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame`,
          { headers: bggHeaders },
        );
        const match = searchRes.data.match(/id="(\d+)"/);
        if (!match) throw new Error("No se encontró ningún juego en BGG.");
        const detailRes = await axios.get(
          `https://boardgamegeek.com/xmlapi2/thing?id=${match[1]}&stats=1`,
          { headers: bggHeaders },
        );
        rawData = detailRes.data; // Nota: Si es XML, convendría pasarlo a JSON antes del hash
        break;
      }
      case "books": {
        contextHint = "un libro de OpenLibrary";
        const { data } = await axios.get(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1`,
        );
        if (!data.docs?.length) throw new Error("Libro no encontrado.");
        rawData = JSON.stringify(data.docs[0]);
        break;
      }
      default:
        throw new Error(`La fuente ${source} no está soportada.`);
    }

    // --- CAPA 3: GESTIÓN DE MAPEO (ESTRUCTURA) ---
    const structureHash = this.getStructureHash(rawData);
    // Validación de seguridad
    if (!structureHash) {
      throw new Error("No se pudo generar el hash de la estructura.");
    }
    const existingMapper = await prisma.apiMapper.findUnique({
      where: { structureHash: structureHash },
    });

    let finalPrompt = "";
    let isNewStructure = !existingMapper;

    if (isNewStructure) {
      // Si la estructura es nueva, pedimos el mapeo y el enriquecimiento completo
      finalPrompt = generateUniversalPrompt(contextHint, rawData, locale, true);
    } else {
      // Si ya conocemos la estructura, extraemos datos y la IA solo traduce/redacta
      const extractedData = this.applyLocalMapping(
        JSON.parse(rawData),
        existingMapper.mappingJson,
      );
      finalPrompt = `
    ENTREGA ÚNICAMENTE UN OBJETO JSON.
    Basándote en estos datos: ${JSON.stringify(extractedData)}, 
    genera una ficha en ${locale} con 'name', 'description' (2 párrafos), 
    'images' (mantén la URL) y 'customFieldValues'.
  `;
    }

    // --- FASE DE IA ---
    const { client, model, provider } = aiData;
    let rawText = "";

    if (provider === AI_PROVIDERS.GEMINI) {
      const result = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        config: {
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        },
      });
      rawText = result.candidates[0].content.parts[0].text;
    } else if (provider === AI_PROVIDERS.OPENAI) {
      const result = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: "Responde ÚNICAMENTE con un objeto JSON válido.",
          },
          { role: "user", content: finalPrompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      });
      rawText = result.choices[0].message.content;
    } else if (provider === AI_PROVIDERS.CLAUDE) {
      const result = await client.messages.create({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: finalPrompt }],
        system: "Responde ÚNICAMENTE con un objeto JSON válido.",
      });
      rawText = result.content.find((b) => b.type === "text")?.text ?? "{}";
    }

    let aiResponse;
    try {
      // Limpiamos posibles marcas de markdown y buscamos los límites del JSON
      let sanitizedText = rawText.replace(/```json|```/g, "").trim();
      const start = sanitizedText.indexOf("{");
      const end = sanitizedText.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("No se encontró JSON");

      aiResponse = JSON.parse(sanitizedText.substring(start, end + 1));
    } catch (e) {
      console.error(
        "❌ Error al parsear respuesta de IA. Texto recibido:",
        rawText,
      );
      throw new Error("La IA no devolvió un formato válido.");
    }

    // --- CAPA 4: ASIGNACIÓN DE DATOS SEGÚN ORIGEN ---
    let finalData;

    if (isNewStructure) {
      // Si es nueva, los datos reales vienen dentro de 'itemData'
      finalData = aiResponse.itemData || aiResponse;

      if (aiResponse.mappingRules) {
        await prisma.apiMapper
          .create({
            data: {
              source,
              structureHash,
              mappingJson: aiResponse.mappingRules,
            },
          })
          .catch((err) =>
            console.error("⚠️ Error guardando mapeador:", err.message),
          );
      }
    } else {
      // Si no es nueva, la IA devolvió el objeto directamente
      finalData = aiResponse;
    }

    // --- 5. POST-PROCESADO (Imagen y DTO) ---
    if (finalData.images?.[0]?.url?.startsWith("http")) {
      try {
        // Convertimos la URL a Base64 para que el front no tenga problemas de CORS
        finalData.images[0].url = await getBase64FromUrl(
          finalData.images[0].url,
        );
      } catch (err) {
        console.error("⚠️ Fallo al convertir imagen:", err.message);
      }
    }

    const draft = new DraftItemDTO(finalData).toJSON();

    // Guardar en caché de resultados finales
    await prisma.enrichedCache
      .create({
        data: {
          source,
          query: normalizedQuery,
          locale,
          data: draft,
        },
      })
      .catch(() => {});

    return draft;
  }
}

module.exports = new IntegrationService();
