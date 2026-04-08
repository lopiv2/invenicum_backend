const prisma = require("../middleware/prisma");
const _ = require("lodash");
const IntegrationDTO = require("../models/integrationModel");
const { encrypt, decrypt } = require("../middleware/cryptoUtils");
const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios");
const { Temporal } = require("@js-temporal/polyfill");
const crypto = require("crypto");
const { Resend } = require("resend");
const { DEFAULT_MODELS, AI_PROVIDERS } = require("../config/aiConstants");
const DraftItemDTO = require("../models/draftItemModel");
const InventoryItemDTO = require("../models/inventoryItemModel");
const {
  getBase64FromUrl,
  generateUniversalPrompt,
  extractMarketPrice,
} = require("../middleware/utils");
require("dotenv").config();

class IntegrationService {
  /**
   * Runs a connection test without saving data
   */
  async testConnection(type, config, userId) {
    console.log("Recibida petición de test:");
    console.log("Tipo:", type); // Mira qué imprime aquí (ej: 'telegram' o 'telegram_bot')
    console.log("Config:", config);
    console.log(type);
    try {
      switch (type) {
        case "bgg": {
          try {
            console.log(`🧪 Testing BGG API connection...`);
            // Test: searches "Catan" as a known game to validate that the proxy responds
            const BGG_PROXY_URL = "https://api.invenicum.com/api/bgg";
            const response = await axios.get(BGG_PROXY_URL, {
              params: {
                action: "search",
                query: "Catan",
              },
              timeout: 10000,
            });

            // Validate that the proxy returned results
            const items = response.data?.items?.item;
            if (!response.data || !items) {
              throw new Error(
                "El proxy de BGG no devolvió datos. Verifica la configuración.",
              );
            }

            // Extract number of results to show the user
            const totalResults = response.data?.items?.total || 0;
            const firstGame = Array.isArray(items)
              ? items[0]?.name?.value || items[0]?.name
              : items?.name?.value || items?.name;

            // 4. Dependency check (AI)
            const aiClient = await this.getActiveAiClient(userId);
            const aiWarning = !aiClient
              ? " (Nota: ningún proveedor de IA configurado, el auto-completado no funcionará)"
              : "";

            return {
              success: true,
              message: `¡Conexión exitosa! Proxy de BGG operativo. Test: se encontraron ${totalResults} resultados para "Catan" (ej: ${firstGame})${aiWarning}.`,
            };
          } catch (error) {
            console.error("❌ Error en el Test de BGG:", error.message);

            // Proxy-specific error handling
            if (error.response?.status === 401) {
              throw new Error(
                "Error de autenticación: La INTERNAL_API_KEY no es válida.",
              );
            }
            if (error.response?.status === 429) {
              throw new Error(
                "BGG está limitando las peticiones temporalmente. Reintenta en un momento.",
              );
            }

            throw new Error(
              error.response
                ? `Error al conectar con el proxy de BGG: ${error.response.data?.error || error.message}`
                : error.message,
            );
          }
        }
        case "pokemon": {
          const pokemon_name = "Pikachu";

          // 1. Basic validation: must not be empty
          if (!pokemon_name) {
            throw new Error(
              "El nombre del Pokémon es requerido para la validación.",
            );
          }

          try {
            console.log(`🧪 Validando existencia de Pokémon: ${pokemon_name}`);

            // 2. Try to get the Pokémon (sanitize the name just in case)
            // PokeAPI only accepts lowercase and no spaces
            const sanitizedName = pokemon_name
              .toLowerCase()
              .trim()
              .replace(/\s+/g, "-");

            await axios.get(
              `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(sanitizedName)}`,
              { timeout: 5000 },
            );

            // 3. Gemini check (keep BGG logic to notify the user)
            // Note: Make sure 'userId' is being passed to the testConnection function
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

            // if the API returns 404, es que the nombre está mal escrito
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
        case "tcgdex": {
          try {
            console.log(`🧪 Testing TCGdex API connection...`);

            const response = await axios.get(
              "https://api.tcgdex.net/v2/en/cards",
              {
                params: { name: "Pikachu" },
                timeout: 10000,
              },
            );

            const cards = response.data;
            if (!cards || !cards.length) {
              throw new Error(
                "TCGdex no devolvió datos. Verifica la conexión.",
              );
            }

            const aiClient = await this.getActiveAiClient(userId);
            const aiWarning = !aiClient
              ? " (Nota: ningún proveedor de IA configurado, el auto-completado no funcionará)"
              : "";

            return {
              success: true,
              message: `¡Conexión exitosa! TCGdex operativo. Test: se encontraron ${cards.length} cartas de "Pikachu"${aiWarning}.`,
            };
          } catch (error) {
            console.error("❌ Error en el Test de TCGdex:", error.message);

            throw new Error(
              error.response
                ? `Error al conectar con TCGdex: ${error.message}`
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
              // Esto nos dirá if es 'Unauthorized', 'Invalid Sender', etc.
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
            // We test by calling Telegram's getMe method to validate the token
            const response = await axios.get(
              `https://api.telegram.org/bot${config.botToken}/getMe`,
            );

            if (response.data.ok) {
              // if the token es válido, intentamos enviar a mensaje de test
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
          if (!config.apiKey || !config.apiKey.trim()) {
            throw new Error("API Key requerida");
          }

          try {
            const tempClient = new GoogleGenAI({ apiKey: config.apiKey });
            const testModel =
              config.model || DEFAULT_MODELS[AI_PROVIDERS.GEMINI];

            // minimal call to validate credentials and model availability.
            await tempClient.models.generateContent({
              model: testModel,
              contents: "ping",
              config: {
                maxOutputTokens: 1,
                temperature: 0,
              },
            });

            return {
              success: true,
              message: `Conexión con Gemini establecida correctamente (modelo: ${testModel})`,
            };
          } catch (error) {
            const status = error?.status || error?.response?.status;
            const apiMessage =
              error?.response?.data?.error?.message || error?.message || "";
            const lowerMsg = String(apiMessage).toLowerCase();

            if (
              status === 401 ||
              lowerMsg.includes("api key not valid") ||
              lowerMsg.includes("invalid api key")
            ) {
              throw new Error("La API Key de Google no es válida");
            }

            if (status === 403) {
              throw new Error(
                "Permisos insuficientes para Gemini (revisa proyecto y API habilitada)",
              );
            }

            if (status === 404 || lowerMsg.includes("model") || lowerMsg.includes("not found")) {
              throw new Error(
                `El modelo de Gemini no está disponible: ${config.model || DEFAULT_MODELS[AI_PROVIDERS.GEMINI]}`,
              );
            }

            if (
              status === 429 ||
              status === 503 ||
              lowerMsg.includes("quota") ||
              lowerMsg.includes("rate limit") ||
              lowerMsg.includes("overloaded") ||
              lowerMsg.includes("unavailable")
            ) {
              throw new Error(
                "Gemini está saturado o alcanzaste cuota/límite de peticiones. Reintenta en unos minutos.",
              );
            }

            throw new Error(`Error de conexión con Gemini: ${apiMessage}`);
          }
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

            // ✅ if llega aquí, es a 200 OK
            console.log("✅ Respuesta de UPCitemdb:", response.data);

            return {
              success: true,
              message: isProTest
                ? "Conexión PRO establecida correctamente"
                : "Conexión modo FREE (Trial) disponible",
            };
          } catch (error) {
            // ❌ Error log for backend console
            console.error("❌ Error detectado en UPC Service:");
            if (error.response) {
              // the server respondió with a código fuera de 2xx
              console.error("Status:", error.response.status);
              console.error("Data:", JSON.stringify(error.response.data));
            } else if (error.request) {
              // the petición se hizo pero no hubo Response (CORS, Red, etc)
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
            // if the error comes from the Google SDK, it's usually in error.response.data or error.message
      const googleError = error.response?.data?.error?.message || error.message;

      let msg = googleError || "Error de conexión";
      if (googleError.includes("API key not valid"))
        msg = "La API Key de Google no es válida";
      if (googleError.includes("403"))
        msg = "Permisos insuficientes para Gemini";

      return { success: false, message: msg };
    }
  }

  /**
   * gets the config de Resend decrypted for uso interno
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
   * gets the config de Telegram decrypted
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
   * gets the API Key de Gemini ya decrypted for uso interno
   * @param {number|string} userId
   * @returns {Promise<{apiKey: string, model: string}|null>}
   */
  async getGeminiApiKey(userId) {
    try {
      const parsedId = parseInt(userId);

      const record = await prisma.userIntegration.findUnique({
        where: { userId_type: { userId: parsedId, type: "gemini" } },
      });

      // Detailed log for diagnostics — remove in production
      if (!record) {
        return null;
      }

      if (!record.isActive) {
        return null;
      }

      // config viene de Prisma como objeto JSON: { data: "encrypted_string" }
      // if config.data existe → está encrypted with nuestro encrypt()
      // if no existe → se guardó without cifrar (directamente the objeto)
      let apiKey, model;

      if (record.config?.data) {
        // Caso normal: encrypted
        const decrypted = decrypt(record.config.data);
        const configObj = JSON.parse(decrypted);
        apiKey = configObj.apiKey;
        model = configObj.model;
      } else if (record.config?.apiKey) {
        // Caso de fallback: guardado without cifrar (config = { apiKey: "...", model: "..." })
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
   * gets the API Key de OpenAI ya decrypted for uso interno
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
   * gets the API Key de Anthropic/Claude ya decrypted for uso interno
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
   * returns the cliente de IA activo según the preferencias del use.
   * Used por getEnrichedItem and the warnings de testConnection.
   * Retorna { client, model, provider } o null if nada está configurado.
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
   * Guarda o updates the configuración de a integración
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

    // Devolvemos the DTO (the DTO must recibir the config ya descifrada)
    result.config = config;
    return new IntegrationDTO(result);
  }

  /**
   * gets the configuración descifrada for a integración específica
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
   * gets the mapa de estados for the checks de the UI en Flutter
   */
  async getStatuses(userId) {
    const integrations = await prisma.userIntegration.findMany({
      where: {
        userId: parseInt(userId),
        isActive: true, // only las activas
      },
    });

    // 🚩 for Flutter es mejor a Mapa { "gemini": true, "telegram": true }
    // Pero if quieres seguir using DTOs for a lista:
    return integrations.map((i) => new IntegrationDTO(i));
  }

  /**
   * Desactiva a integración without borrar the data
   */
  async deleteIntegration(userId, type) {
    return await prisma.userIntegration.update({
      where: { userId_type: { userId: parseInt(userId), type: type } },
      data: { isActive: false },
    });
  }

  /**
   * gets the configuración de UPCitemdb ya decrypted for uso interno
   * @param {number|string} userId
   * @returns {Promise<{apiKey: string}|null>}
   */
  async getUpcApiKey(userId) {
    try {
      // 1. we search the registro en the base de data for the tipo 'upcitemdb'
      const record = await prisma.userIntegration.findUnique({
        where: {
          userId_type: {
            userId: parseInt(userId),
            type: "upcitemdb",
          },
        },
      });

      // 2. if no existe, no está activa o no tiene data, devolvemos null
      if (!record || !record.isActive || !record.config?.data) {
        return null;
      }

      // 3. DESENCRIPTAMOS MANUALMENTE using tu utilidad de crypto
      const decrypted = decrypt(record.config.data);
      const configObj = JSON.parse(decrypted);

      // 4. Devolvemos the API Key (and cualquier otro parámetro de config if existiera)
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
    // 1. get estados de integración
    const integrations = await this.getStatuses(userId);

    // 2. Verify if upcitemdb está activa
    const upcIntegration = integrations.find((i) => i.type === "upcitemdb");
    const isUpcActive = upcIntegration?.isActive === true;

    if (isUpcActive) {
      const fullConfig = await this.getConfig(userId, "upcitemdb");

      // 🚩 EXTRACCIÓN DINÁMICA DE API KEY
      let apiKey = null;
      if (fullConfig && fullConfig.config) {
        // if config es the string 'id:key', sacamos the segunda parte. if es objeto, sacamos .apiKey
        if (typeof fullConfig.config === "string") {
          const parts = fullConfig.config.split(":");
          apiKey = parts.length > 1 ? parts[1] : parts[0];
        } else {
          apiKey = fullConfig.config.apiKey;
        }
      }

      // 🚩 ENDPOINT SELECTION
      // if tenemos apiKey -> Pro. if no -> Trial.
      const isPro = !!apiKey;
      const baseURL = isPro
        ? "https://api.upcitemdb.com/prod/v1/lookup"
        : "https://api.upcitemdb.com/prod/trial/lookup";

      try {
        const response = await axios.get(baseURL, {
          params: { upc: barcode },
          headers: {
            Accept: "application/json",
            // only incluimos the header if realmente tenemos a key
            ...(isPro ? { user_key: apiKey, key_type: "free" } : {}),
          },
        });

        if (response.data.items && response.data.items.length > 0) {
          const item = response.data.items[0];
          let imageUrl =
            item.images && item.images.length > 0 ? item.images[0] : null;

          // 3. 🚩 the key step: Convert to Base64 before sending to the DTO
          // Esto evita the error de pantalla blanca/CORS en Flutter Web
          if (imageUrl && imageUrl.startsWith("http")) {
            console.log(
              "🔄 Convirtiendo imagen de código de barras a Base64...",
            );
            imageUrl = await getBase64FromUrl(imageUrl);
          }

          // Mapping to the DTO (simulating Prisma)
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
            createdAt: Temporal.Now.zonedDateTimeISO(),
            updatedAt: Temporal.Now.zonedDateTimeISO(),
          };

          return new InventoryItemDTO(mockPrismaItem);
        }
      } catch (err) {
        console.error(
          `❌ Error en UPCItemDB (${isPro ? "PRO" : "TRIAL"}):`,
          err.message,
        );

        // if the Pro fails por Key invalida, podrias intentar a fallback a trial aqui if quisieras
      }
    }

    return null;
  }

  /**
   * Genera a hash único basado en the llaves del JSON (su estructura)
   */
  getStructureHash(rawData) {
    try {
      const json = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      const keys = Object.keys(json).sort().join("|");
      // Esto retorna a STRING hexadecimal
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
      market_value: 0,
      customFieldValues: {},
    };

    // Extraer valor de mercado if the mapper tiene the route guardada
    if (mappingRules.market_value_path) {
      const rawPrice = _.get(sourceJson, mappingRules.market_value_path, null);
      const parsed = parseFloat(rawPrice);
      if (!isNaN(parsed) && parsed > 0) result.market_value = parsed;
    }

    // if the mapper no tenia route, hacer search programatica como fallback
    if (!result.market_value) {
      const found = extractMarketPrice(sourceJson);
      if (found) result.market_value = found;
    }

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
    // only use caché if the market value ya está calculado.
    // if es 0, forzamos reproceso for intentar get the precio de the API.
    if (cachedResult && (cachedResult.data?.marketValue ?? 0) > 0) {
      return cachedResult.data;
    }

    // --- CAPA 2: OBTENCIÓN DE data RAW ---
    let rawData = "";
    let contextHint = "";

    switch (source) {
      case "pokemon": {
        contextHint = "un Pokémon de PokeAPI";
        const pokemonName = normalizedQuery.replace(/\s+/g, "-");

        // Intentamos búsqueda directa por nombre exacto
        try {
          const pokeRes = await axios.get(
            `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(pokemonName)}`,
          );
          rawData = JSON.stringify(pokeRes.data);
        } catch (directErr) {
          // if fails (404), we search por listado parcial
          if (directErr.response?.status === 404) {
            const searchRes = await axios.get(
              `https://pokeapi.co/api/v2/pokemon?limit=1302`,
            );
            const allPokemon = searchRes.data.results || [];
            const matches = allPokemon.filter((p) =>
              p.name.includes(pokemonName),
            );

            if (!matches.length)
              throw new Error("No se encontró ningún Pokémon.");

            if (matches.length > 1) {
              const candidates = matches.slice(0, 20).map((p) => {
                const urlParts = p.url.split("/").filter(Boolean);
                const pokemonId = urlParts[urlParts.length - 1];
                return {
                  id: pokemonId,
                  name: p.name.charAt(0).toUpperCase() + p.name.slice(1),
                  image: pokemonId
                    ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`
                    : null,
                };
              });
              return {
                multipleResults: true,
                source: "pokemon",
                query: normalizedQuery,
                candidates,
              };
            }

            // a only match parcial → get detalle
            const pokeRes = await axios.get(matches[0].url);
            rawData = JSON.stringify(pokeRes.data);
          } else {
            throw directErr;
          }
        }
        break;
      }
      case "bgg": {
        const PROXY_URL = "https://api.invenicum.com/api/bgg";

        const searchRes = await axios.get(PROXY_URL, {
          params: { action: "search", query: normalizedQuery },
        });

        const results = searchRes.data.items?.item;
        if (!results) throw new Error("No se encontró ningún juego en BGG.");

        if (Array.isArray(results) && results.length > 1) {
          const candidates = results.map((item) => {
            const nameObj = Array.isArray(item.name)
              ? item.name.find((n) => n.type === "primary") || item.name[0]
              : item.name;
            const imageObj = Array.isArray(item.thumbnail)
              ? item.thumbnail[0]
              : item.thumbnail;
            return {
              id: item.id,
              name: nameObj?.value || nameObj || "Sin nombre",
              yearPublished: item.yearpublished?.value || null,
              image: imageObj?.value || imageObj || null,
            };
          });

          return {
            multipleResults: true,
            source: "bgg",
            query: normalizedQuery,
            candidates,
          };
        }

        const selectedId = Array.isArray(results) ? results[0].id : results.id;
        console.log(`🎯 Juego único seleccionado ID: ${selectedId}`);

        const detailRes = await axios.get(PROXY_URL, {
          params: { action: "thing", id: selectedId },
        });

        rawData = JSON.stringify(detailRes.data);
        contextHint = "un juego de mesa de BoardGameGeek";
        break;
      }
      case "books": {
        contextHint = "un libro de OpenLibrary";
        const { data } = await axios.get(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`,
        );
        if (!data.docs?.length) throw new Error("Libro no encontrado.");

        if (data.docs.length > 1) {
          const candidates = data.docs.map((doc) => ({
            id: doc.key,
            name: doc.title || "Sin título",
            author: doc.author_name?.[0] || null,
            yearPublished: doc.first_publish_year?.toString() || null,
            image: doc.cover_i
              ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
              : null,
          }));

          return {
            multipleResults: true,
            source: "books",
            query: normalizedQuery,
            candidates,
          };
        }

        rawData = JSON.stringify(data.docs[0]);
        break;
      }
      case "tcgdex": {
        contextHint = "una carta de Pokémon TCG de TCGdex";
        const TCGDEX_URL = "https://api.tcgdex.net/v2/en/cards";

        const searchRes = await axios.get(TCGDEX_URL, {
          params: { name: normalizedQuery },
          timeout: 10000,
        });

        const results = searchRes.data;
        if (!results || !results.length)
          throw new Error("No se encontró ninguna carta en TCGdex.");

        if (results.length > 1) {
          const candidates = results.slice(0, 30).map((card) => ({
            id: card.id,
            name: card.name || "Sin nombre",
            image: card.image ? `${card.image}/low.webp` : null,
          }));

          return {
            multipleResults: true,
            source: "tcgdex",
            query: normalizedQuery,
            candidates,
          };
        }

        // a only resultado → get detalle completo
        console.log(`🎯 Carta única seleccionada ID: ${results[0].id}`);
        const detailRes = await axios.get(`${TCGDEX_URL}/${results[0].id}`);
        rawData = JSON.stringify(detailRes.data);
        break;
      }
      default:
        throw new Error(`La fuente ${source} no está soportada.`);
    }

    // if llegamos aquí, tenemos rawData de a only item → procesamos with IA
    return this._processWithAI(userId, rawData, contextHint, source, normalizedQuery, locale);
  }

  /**
   * Procesa a item seleccionado por the frontend tras elegir de the lista de candidatos.
   * gets the detalles completos and pasa por Capa 3+ (Mapping + IA + post-procesado).
   */
  async processSelectedItem(userId, source, itemId, locale = "es") {
    let rawData = "";
    let contextHint = "";

    switch (source) {
      case "pokemon": {
        contextHint = "un Pokémon de PokeAPI";
        console.log(`🎯 Procesando Pokémon seleccionado ID: ${itemId}`);

        const pokeRes = await axios.get(
          `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(itemId)}`,
        );
        rawData = JSON.stringify(pokeRes.data);
        break;
      }
      case "bgg": {
        contextHint = "un juego de mesa de BoardGameGeek";
        const PROXY_URL = "https://api.invenicum.com/api/bgg";

        console.log(`🎯 Procesando juego BGG seleccionado ID: ${itemId}`);

        const detailRes = await axios.get(PROXY_URL, {
          params: { action: "thing", id: itemId },
        });

        rawData = JSON.stringify(detailRes.data);
        break;
      }
      case "books": {
        contextHint = "un libro de OpenLibrary";
        console.log(`🎯 Procesando libro seleccionado: ${itemId}`);

        const bookRes = await axios.get(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(itemId)}&limit=1`,
        );
        if (!bookRes.data.docs?.length) throw new Error("Libro no encontrado.");
        rawData = JSON.stringify(bookRes.data.docs[0]);
        break;
      }
      case "tcgdex": {
        contextHint = "una carta de Pokémon TCG de TCGdex";
        console.log(`🎯 Procesando carta TCGdex seleccionada ID: ${itemId}`);

        const cardRes = await axios.get(
          `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(itemId)}`,
        );
        //console.log("Detalle completo de carta obtenido:", cardRes.data);
        rawData = JSON.stringify(cardRes.data);
        break;
      }
      default:
        throw new Error(`processSelectedItem no soporta la fuente: ${source}`);
    }

    const cacheKey = `${source}_${itemId}`;
    return this._processWithAI(userId, rawData, contextHint, source, cacheKey, locale);
  }

  /**
   * CAPA 3+: Mapping, IA, post-procesado and caché.
   * Función interna reutilizada por getEnrichedItem and processSelectedItem.
   */
  async _processWithAI(userId, rawData, contextHint, source, cacheKey, locale) {
    // Pre-extract price from raw data BEFORE calling the AI.
    // More reliable than depending on the model for exact numeric values.
    let preExtractedPrice = 0;
    try {
      const rawJson = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      preExtractedPrice = extractMarketPrice(rawJson) || 0;
    } catch (_) {}

    // --- CAPA 3: GESTIÓN DE Mapping (ESTRUCTURA) ---
    const structureHash = this.getStructureHash(rawData);
    // Validación de security
    if (!structureHash) {
      throw new Error("No se pudo generar el hash de la estructura.");
    }
    const exactMapperByHash = await prisma.apiMapper.findUnique({
      where: { structureHash: structureHash },
    });

    // security: the hash es globalmente único, pero no queremos Use a mapper
    // de otra API/source por accidente.
    const exactMapper =
      exactMapperByHash && exactMapperByHash.source === source
        ? exactMapperByHash
        : null;

    // Mantener exactamente a mapper por source (the más reciente).
    const sourceMappers = await prisma.apiMapper.findMany({
      where: { source },
      orderBy: { createdAt: "desc" },
    });
    const sourceMapper = sourceMappers[0] || null;

    if (sourceMappers.length > 1) {
      await prisma.apiMapper.deleteMany({
        where: { id: { in: sourceMappers.slice(1).map((m) => m.id) } },
      });
    }

    // if there's no exact hash, use the single mapper from the source as fallback.
    const existingMapper = exactMapper || sourceMapper;

    let finalPrompt = "";
    let isNewStructure = !existingMapper;
    let finalData = null;

    if (isNewStructure) {
      // if the estructura es new, pedimos the Mapping and the enriquecimiento completo
      finalPrompt = generateUniversalPrompt(contextHint, rawData, locale, true);
    } else {
      // if ya conocemos the estructura, mapeamos localmente without volver a llamar a the IA
      const extractedData = this.applyLocalMapping(
        JSON.parse(rawData),
        existingMapper.mappingJson,
      );
      finalData = {
        name: extractedData.name || "Sin nombre",
        description: extractedData.description || "",
        images: Array.isArray(extractedData.images) ? extractedData.images : [],
        customFieldValues: extractedData.customFieldValues || {},
        marketValue: parseFloat(extractedData.market_value) || 0,
      };
    }
    if (isNewStructure) {
      // --- FASE DE IA (only when the estructura es new) ---
      const aiData = await this.getActiveAiClient(userId);
      if (!aiData)
        throw new Error(
          "No AI provider configured. Go to Integrations.",
        );
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
        // Clean possible markdown markers and search for JSON boundaries
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

      // --- CAPA 4: ASIGNACIÓN DE data SEGÚN ORIGEN (only estructura new) ---
      finalData = aiResponse.itemData || aiResponse;

      if (aiResponse.mappingRules) {
        // Reuse the source mapper if it exists; if not, create it.
        if (sourceMapper) {
          await prisma.apiMapper
            .update({
              where: { id: sourceMapper.id },
              data: {
                structureHash,
                mappingJson: aiResponse.mappingRules,
                locale,
              },
            })
            .catch((err) =>
              console.error("⚠️ Error actualizando mapeador:", err.message),
            );
        } else {
          await prisma.apiMapper
            .create({
              data: {
                source,
                structureHash,
                mappingJson: aiResponse.mappingRules,
                locale,
              },
            })
            .catch((err) =>
              console.error("⚠️ Error guardando mapeador:", err.message),
            );
        }
      }
    }

    // --- 5. POST-PROCESADO (Imagen, precio and DTO) ---
    // the price always comes from raw data (programmatic), never from the AI.
    // Así evitamos que the modelo devuelva 0 o a valor inventado.
    if (preExtractedPrice > 0) {
      finalData.marketValue = preExtractedPrice;
    } else {
      // without precio en raw data: intentar lo que returned the IA como último recurso
      const aiPrice = finalData.marketValue ?? finalData.market_value;
      finalData.marketValue = parseFloat(aiPrice) || 0;
    }

    let cacheImageUrl = null;
    if (finalData.images?.[0]?.url?.startsWith("http")) {
      try {
        let imgUrl = finalData.images[0].url;
        // TCGdex returns URLs without extensión (ej. .../sm/det1/4).
        // Añadimos /high.webp for get the imagen real.
        if (
          imgUrl.includes("assets.tcgdex.net") &&
          !/\.(webp|jpg|jpeg|png|gif)$/i.test(imgUrl)
        ) {
          imgUrl = `${imgUrl}/high.webp`;
        }
        // En caché guardamos URL (ligera). the Base64 se use only for the Response.
        cacheImageUrl = imgUrl;
        // Convertimos a Base64 so that the front no tenga problemas de CORS
        finalData.images[0].url = await getBase64FromUrl(imgUrl);
      } catch (err) {
        console.error("⚠️ Fallo al convertir imagen:", err.message);
      }
    }

    const draft = new DraftItemDTO(finalData).toJSON();

    // Guardar versión ligera en caché for evitar payloads gigantes por Base64
    const cacheDraft = JSON.parse(JSON.stringify(draft));
    if (cacheImageUrl) {
      cacheDraft.imageUrl = cacheImageUrl;
      if (Array.isArray(cacheDraft.images) && cacheDraft.images[0]) {
        cacheDraft.images[0].url = cacheImageUrl;
      }
    }

    // Guardar en caché de resultados finales (upsert for no fallar if ya existe)
    await prisma.enrichedCache
      .upsert({
        where: {
          source_query_locale: { source, query: cacheKey, locale },
        },
        update: { data: cacheDraft },
        create: { source, query: cacheKey, locale, data: cacheDraft },
      })
      .catch(() => {});

    return draft;
  }
}
module.exports = new IntegrationService();
