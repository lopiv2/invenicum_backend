// services/aiService.js
const prisma = require("../middleware/prisma");
const { TOOL_DEFINITIONS, executeTool } = require("./mcpServer");
const { AI_PROVIDERS, DEFAULT_MODELS } = require("../config/aiConstants");
const { Temporal } = require('@js-temporal/polyfill');
const geminiAdapter = require("../adapters/geminiAdapter");
const openaiAdapter = require("../adapters/openaiAdapter");
const claudeAdapter = require("../adapters/claudeAdapter");

async function getAdapter(userId) {
  const prefs = await prisma.userPreferences.findUnique({
    where: { userId: parseInt(userId) },
    select: { aiProvider: true, aiModel: true },
  });

  const provider = prefs?.aiProvider || AI_PROVIDERS.GEMINI;
  const model    = prefs?.aiModel    || DEFAULT_MODELS[provider];

  switch (provider) {
    case AI_PROVIDERS.OPENAI:
      return { adapter: openaiAdapter, getClient: () => openaiAdapter.getOpenAIClient(userId, model) };
    case AI_PROVIDERS.CLAUDE:
      return { adapter: claudeAdapter, getClient: () => claudeAdapter.getClaudeClient(userId, model) };
    case AI_PROVIDERS.GEMINI:
    default:
      return { adapter: geminiAdapter, getClient: () => geminiAdapter.getGeminiClient(userId, model) };
  }
}

async function buildSystemPrompt(userId, locale) {
  const containers = await prisma.container.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const listaContenedores =
    containers.map((c) => `- ${c.name} (ID: ${c.id})`).join("\n") ||
    "- (sin contenedores aún)";

  return (
    `Eres Veni, el asistente de inventario de Invenicum. ` +
    `Responde SIEMPRE en el idioma "${locale}". ` +
    `\n\nContenedores del usuario:\n${listaContenedores}` +
    `\n\nREGLAS CRÍTICAS:` +
    `\n- NUNCA escribas XML, JSON, <tool_call> ni bloques de código en tu respuesta.` +
    `\n- NUNCA describas lo que vas a hacer con una tool — simplemente INVÓCALA.` +
    `\n- Para navegar usa SIEMPRE la function "navigate", nunca escribas la ruta en el texto.` +
    `\n- Tu respuesta debe ser breve y conversacional.` +
    `\n\nHerramientas disponibles: navigate, open_scanner, search_assets, ` +
    `create_asset, list_containers, create_container, create_template, extract_product_from_url.`
  );
}

function isCreateTemplateIntent(input = "") {
  const text = String(input || "").toLowerCase();
  const mentionsTemplate = /(plantilla|template)/.test(text);
  const createVerb = /(crear|crea|diseña|disena|genera|arma|haz|construye|build|generate|design|create)/.test(text);
  return mentionsTemplate && createVerb;
}

function inferNavigationPathFromInput(input = "") {
  const text = String(input || "").toLowerCase();

  const directPath = text.match(/\/(dashboard|settings|integrations|templates|scanner|loans|inventory)\b/);
  if (directPath) return directPath[0];

  if (/integraciones|integration/.test(text)) return "/integrations";
  if (/dashboard|inicio|home/.test(text)) return "/dashboard";
  if (/ajustes|configuraci[oó]n|settings|preferencias|preferences/.test(text)) return "/settings";
  if (/plantillas|templates/.test(text)) return "/templates";
  if (/esc[aá]ner|scanner/.test(text)) return "/scanner";
  if (/pr[eé]stamos|prestamos|loans/.test(text)) return "/loans";
  if (/inventario|inventory/.test(text)) return "/dashboard";

  return null;
}

function isNavigationIntent(input = "") {
  const text = String(input || "").toLowerCase();
  const hasVerb = /(ir|ve|v[eé]|ll[eé]vame|llevar|navega|navegar|abrir|abre|open|go to|take me|navigate)/.test(text);
  return hasVerb && !!inferNavigationPathFromInput(text);
}

function modelPromisesNavigation(text = "") {
  const t = String(text || "").toLowerCase();
  return /(te llevo|i'?ll take you|i will take you|navigat|go to|llevarte)/.test(t);
}

function isTransientProviderError(error) {
  const status = error?.status;
  const msg = String(error?.message || "").toLowerCase();
  return [429, 500, 502, 503, 504].includes(status) || msg.includes("unavailable") || msg.includes("high demand");
}

function buildAnswerSnippet(text, maxLen = 120) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "<empty>";
  return value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
}

class AIService {
  async processChatConversation(userInput, context = {}) {
    const userId = parseInt(context.userId);
    const locale = context.locale || "es";
    if (isNaN(userId)) throw new Error("userId requerido");

    const { adapter, getClient } = await getAdapter(userId);

    let clientData;
    try {
      clientData = await getClient();
    } catch (err) {
      return { answer: `⚠️ ${err.message}`, action: "NAVIGATE", data: { path: "/integrations" } };
    }

    const { client, model, provider } = clientData;
    console.log(`[AI] Proveedor: ${provider} | Modelo: ${model}`);

    const toolContext = {
      userId,
      locale,
      geminiClient: provider === AI_PROVIDERS.GEMINI ? client : null,
      geminiModel:  provider === AI_PROVIDERS.GEMINI ? model  : null,
      aiClient:  client,
      aiModel:   model,
      aiProvider: provider,
    };

    let finalInput = userInput;
    const strictTemplateMode = userInput !== "SAY_HELLO_INITIAL" && isCreateTemplateIntent(userInput);
    if (strictTemplateMode) {
      console.log("[AI][TemplateStrict] Modo estricto activado para solicitud de plantilla.");
    }
    if (userInput === "SAY_HELLO_INITIAL") {
      finalInput =
        `Actúa como Veni, asistente de Invenicum. Preséntate brevemente. ` +
        `Responde en "${locale}". Dime que puedes ayudar con el inventario.`;
    } else if (strictTemplateMode) {
      finalInput =
        `Solicitud del usuario: ${userInput}\n\n` +
        `Modo estricto de plantillas: debes invocar create_template.` +
        ` No escribas create_template(...) como texto.` +
        ` El payload debe cumplir exactamente:` +
        ` name:string, description:string, category:string, fields:array(5-8).` +
        ` Cada field requiere name y type en [text, number, date, dropdown, price, boolean, url].` +
        ` Si type='dropdown', options es obligatorio con 3-6 strings.` +
        ` Si falta información, asume valores razonables y completa campos útiles.`;
    }

    const systemPrompt = await buildSystemPrompt(userId, locale);
    const initialMessages = adapter.buildInitialMessages(systemPrompt, finalInput);
    const messages = initialMessages.messages ?? initialMessages;
    const claudeSystemPrompt = initialMessages.systemPrompt;

    const onToolCall = async (name, args) => {
      console.log(`[MCP] Tool: ${name}`, JSON.stringify(args));
      try {
        return await executeTool(name, args, toolContext);
      } catch (err) {
        console.error(`[MCP] Error en tool ${name}:`, err.message);
        return { toolResult: { error: err.message } };
      }
    };

    let finalAnswer;
    let finalAction;
    let finalData;
    try {
      ({ finalAnswer, finalAction, finalData } = await adapter.runAgenticLoop({
        client, model, messages,
        toolDefinitions: TOOL_DEFINITIONS,
        onToolCall,
        systemPrompt: claudeSystemPrompt ?? systemPrompt,
        forceToolName: strictTemplateMode ? "create_template" : null,
        strictToolMode: strictTemplateMode,
      }));
    } catch (error) {
      if (isTransientProviderError(error)) {
        console.warn(
          `[AI][Provider] Error transitorio del proveedor (status=${error?.status ?? "n/a"}) en intento 1.`,
        );
        if (strictTemplateMode) {
          return {
            answer:
              "El proveedor de IA está con alta demanda en este momento. Te abro el creador para que no pierdas tiempo.",
            action: "NAVIGATE",
            data: { path: "/templates/create", reason: "provider_transient_error" },
          };
        } else {
          return {
            answer:
              "El proveedor de IA está temporalmente saturado. Intenta de nuevo en unos segundos.",
            action: null,
            data: {},
          };
        }
      }
      throw error;
    }

    if (strictTemplateMode) {
      console.log(
        `[AI][TemplateStrict] Intento 1 completado. finalAction=${finalAction ?? "null"}`,
      );
    }

    if (!strictTemplateMode && !finalAction) {
      const providerNoAnswer =
        !finalAnswer ||
        /no pude procesar la solicitud|respuesta vac[ií]a/i.test(String(finalAnswer));

      const inferredFromUser = isNavigationIntent(userInput)
        ? inferNavigationPathFromInput(userInput)
        : null;
      const inferredFromModel = modelPromisesNavigation(finalAnswer)
        ? inferNavigationPathFromInput(finalAnswer)
        : null;

      const inferredPath = inferredFromUser || inferredFromModel;

      if (providerNoAnswer || inferredPath) {
        console.log(
          `[AI][NavFallback] inferredFromUser=${inferredFromUser ?? "null"} | inferredFromModel=${inferredFromModel ?? "null"} | providerNoAnswer=${providerNoAnswer}`,
        );
        if (inferredPath) {
          console.warn(
            `[AI] Respuesta vacía/sin acción del proveedor. Navegación inferida por heurística: ${inferredPath}`,
          );
          finalAction = "NAVIGATE";
          finalData = { path: inferredPath, reason: "provider_empty_response_navigation_fallback" };
        }
      }
    }

    // En modo estricto de plantilla intentamos un segundo pase forzado antes de abortar.
    if (strictTemplateMode && finalAction !== "CREATE_TEMPLATE") {
      console.warn(
        `[AI][TemplateStrict] Intento 1 no logró CREATE_TEMPLATE. finalAnswer=${
          finalAnswer ? "present" : "empty"
        }. Iniciando reintento forzado.`,
      );

      const retryPrompt =
        `Reintento obligatorio: genera la plantilla solicitada por el usuario y llama create_template ahora.\n` +
        `Usuario: ${userInput}\n\n` +
        `Reglas estrictas:\n` +
        `- NO respondas texto normal.\n` +
        `- SOLO invoca create_template.\n` +
        `- fields debe tener entre 5 y 8 campos.\n` +
        `- Tipos permitidos: text, number, date, dropdown, price, boolean, url.\n` +
        `- En dropdown, options obligatorio con 3 a 6 opciones.`;

      const retryInitialMessages = adapter.buildInitialMessages(systemPrompt, retryPrompt);
      const retryMessages = retryInitialMessages.messages ?? retryInitialMessages;
      const retryClaudeSystemPrompt = retryInitialMessages.systemPrompt;

      let retryResult;
      try {
        retryResult = await adapter.runAgenticLoop({
          client,
          model,
          messages: retryMessages,
          toolDefinitions: TOOL_DEFINITIONS,
          onToolCall,
          systemPrompt: retryClaudeSystemPrompt ?? systemPrompt,
          forceToolName: "create_template",
          strictToolMode: true,
        });
      } catch (error) {
        if (isTransientProviderError(error)) {
          console.warn(
            `[AI][Provider] Error transitorio del proveedor (status=${error?.status ?? "n/a"}) en reintento estricto.`,
          );
          return {
            answer:
              "El proveedor de IA está con alta demanda en este momento. Te abro el creador para que no pierdas tiempo.",
            action: "NAVIGATE",
            data: { path: "/templates/create", reason: "provider_transient_error_retry" },
          };
        }
        throw error;
      }

      console.log(
        `[AI][TemplateStrict] Reintento completado. finalAction=${retryResult.finalAction ?? "null"}`,
      );

      if (retryResult.finalAction === "CREATE_TEMPLATE") {
        console.log("[AI][TemplateStrict] Reintento exitoso: plantilla creada por tool call.");
        finalAction = retryResult.finalAction;
        finalData = retryResult.finalData;
        finalAnswer = retryResult.finalAnswer;
      } else {
        console.warn(
          "[AI][TemplateStrict] Reintento fallido. Se navega al creador de plantillas.",
        );
        return {
          answer:
            "No pude construir una plantilla válida automáticamente. Te abro el creador para completarla con campos obligatorios.",
          action: "NAVIGATE",
          data: { path: "/templates/create", reason: "strict_template_mode_failed" },
        };
      }
    }

    // Limpiar el answer de artefactos que el modelo a veces incluye en el texto
    let answer = finalAnswer;
    if (answer) {
      // FALLBACK: El modelo a veces escribe la tool call como texto en lugar de invocarla.
      // Intentamos parsear cualquier JSON que contenga "name": "navigate" u otras tools.
      if (!finalAction) {
        // Buscar cualquier bloque JSON en el texto
        const jsonMatches = answer.match(/\{[\s\S]*?\}/g) || [];
        for (const jsonStr of jsonMatches) {
          try {
            const parsed = JSON.parse(jsonStr);
            const toolName = parsed.name;
            const args = parsed.arguments || parsed.args || parsed.input || parsed;

            if (toolName === "navigate" || toolName === "navigate_to") {
              finalAction = "NAVIGATE";
              // El path puede venir con distintos nombres de clave
              const p = args.path || args.route || args.target || args.location || args.destination || "/dashboard";
              finalData = { path: p.startsWith("/") ? p : "/" + p };
              answer = answer.replace(jsonStr, "").trim();
              break;
            }
            if (toolName === "open_scanner") {
              finalAction = "OPEN_SCANNER";
              finalData = {};
              answer = answer.replace(jsonStr, "").trim();
              break;
            }
          } catch (_) {
            // No era JSON válido — ignorar
          }
        }

        // Fallback para sintaxis de función: navigate(route="dashboard")
        if (!finalAction) {
          const navMatch = answer.match(/navigate\s*\(\s*(?:target|path|route|location)\s*=\s*["']([^"']+)["']/i)
                        || answer.match(/navigate\s*\(\s*["']([^"']+)["']/i);
          if (navMatch) {
            finalAction = "NAVIGATE";
            const p = navMatch[1];
            finalData = { path: p.startsWith("/") ? p : "/" + p };
            answer = answer.replace(/navigate\s*\([^)]*\)/gi, "").trim();
          }
        }

        if (!finalAction && /open_scanner\s*\(/.test(answer)) {
          finalAction = "OPEN_SCANNER";
          finalData = {};
          answer = answer.replace(/open_scanner\s*\([^)]*\)/gi, "").trim();
        }

      }

      // Eliminar cualquier resto de artefactos del modelo
      answer = answer.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
      answer = answer.replace(/\*\*Acción:\*\*[^]*/gi, "");
      // Eliminar líneas que solo contengan llaves o corchetes sueltos
      answer = answer.replace(/^[\s{}[\]]*$/gm, "").trim();

      if (strictTemplateMode && /create_template\s*\(/i.test(answer)) {
        answer = "";
      }
    }

    // Si la acción es de navegación y no hay respuesta de texto útil,
    // generamos un mensaje por defecto para que el chat no quede vacío.
    if (!answer && finalAction) {
      const actionMessages = {
        NAVIGATE:        "De acuerdo, te llevo ahí.",
        OPEN_SCANNER:    "Abriendo el escáner...",
        CREATE_TEMPLATE: "Aquí tienes la plantilla que he diseñado. Revísala antes de publicar.",
      };
      answer = actionMessages[finalAction] ?? "He completado la acción solicitada.";
    }

    if (finalAction === "CREATE_TEMPLATE") {
      const prefillToken = String(Temporal.Now.instant().epochMilliseconds);
      const normalizedFields = Array.isArray(finalData?.fieldDefinitions)
        ? finalData.fieldDefinitions
        : Array.isArray(finalData?.fields)
          ? finalData.fields
          : [];

      finalData = {
        name: finalData?.name ?? "",
        description: finalData?.description ?? "",
        category: finalData?.category ?? "",
        fields: normalizedFields,
        fieldDefinitions: normalizedFields,
        // Ruta con token para forzar refresco de prefill incluso si ya estás en /templates/create.
        path: `/templates/create?ai_prefill=${prefillToken}`,
        prefillToken,
        shouldNavigate: true,
        templateData: {
          name: finalData?.name ?? "",
          description: finalData?.description ?? "",
          category: finalData?.category ?? "",
          fields: normalizedFields,
          fieldDefinitions: normalizedFields,
        },
      };
    }

    console.log(
      `[AI][Summary] strictTemplateMode=${strictTemplateMode} | finalAction=${finalAction ?? "null"} | finalAnswerSnippet=${buildAnswerSnippet(answer)}`,
    );

    return {
      answer: answer || "He completado la acción solicitada.",
      action: finalAction,
      data: finalData,
    };
  }

  async extractInfoFromUrl(url, fields, userId) {
    const { getClient } = await getAdapter(userId);
    const { client, model, provider } = await getClient();

    const toolContext = {
      userId,
      geminiClient: provider === AI_PROVIDERS.GEMINI ? client : null,
      geminiModel:  provider === AI_PROVIDERS.GEMINI ? model  : null,
      aiClient: client, aiModel: model, aiProvider: provider,
    };

    const result = await executeTool("extract_product_from_url", { url }, toolContext);
    return result.data;
  }

  async getRecentHistory(userId) {
    const twentyFourHoursAgo = new Date(Temporal.Now.instant().epochMilliseconds - 24 * 60 * 60 * 1000);
    return await prisma.chatMessage.findMany({
      where: { userId, createdAt: { gte: twentyFourHoursAgo } },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
  }

  async saveMessage(userId, text, isUser) {
    return await prisma.chatMessage.create({
      data: { userId: parseInt(userId), text, isUser },
    });
  }
}

module.exports = new AIService();