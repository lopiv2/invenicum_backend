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
    if (userInput === "SAY_HELLO_INITIAL") {
      finalInput =
        `Actúa como Veni, asistente de Invenicum. Preséntate brevemente. ` +
        `Responde en "${locale}". Dime que puedes ayudar con el inventario.`;
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

    let { finalAnswer, finalAction, finalData } = await adapter.runAgenticLoop({
      client, model, messages,
      toolDefinitions: TOOL_DEFINITIONS,
      onToolCall,
      systemPrompt: claudeSystemPrompt ?? systemPrompt,
    });

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

        // Fallback para create_template escrito como texto
        // Ejemplo: create_template(name="Joyería", fields=[...])
        if (!finalAction) {
          const ctMatch = answer.match(/create_template\s*\(([\s\S]*?)\)(?:\s*$|\n)/);
          if (ctMatch) {
            try {
              // Intentar extraer name y fields del texto
              const nameMatch = ctMatch[1].match(/name\s*=\s*["']([^"']+)["']/);
              const fieldsMatch = ctMatch[1].match(/fields\s*=\s*(\[.*?\])/s);
              if (nameMatch) {
                finalAction = "CREATE_TEMPLATE";
                let parsedFields = [];
                if (fieldsMatch) {
                  try {
                    parsedFields = JSON.parse(fieldsMatch[1].replace(/'/g, '"'));
                  } catch (_) {}
                }
                finalData = {
                  name: nameMatch[1],
                  description: "",
                  category: "",
                  fields: parsedFields,
                };
                answer = answer.replace(ctMatch[0], "").trim();
              }
            } catch (_) {}
          }
        }
      }

      // Eliminar cualquier resto de artefactos del modelo
      answer = answer.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
      answer = answer.replace(/\*\*Acción:\*\*[^]*/gi, "");
      // Eliminar líneas que solo contengan llaves o corchetes sueltos
      answer = answer.replace(/^[\s{}[\]]*$/gm, "").trim();
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