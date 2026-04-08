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
  const containerList =
    containers.map((c) => `- ${c.name} (ID: ${c.id})`).join("\n") ||
    "- (no containers yet)";

  return (
    `You are Veni, the inventory assistant for Invenicum. ` +
    `ALWAYS reply in the language "${locale}". ` +
    `\n\nUser containers:\n${containerList}` +
    `\n\nCRITICAL RULES:` +
    `\n- NEVER write XML, JSON, <tool_call> or code blocks in your response.` +
    `\n- NEVER describe what you are going to do with a tool — just INVOKE IT.` +
    `\n- To navigate, ALWAYS use the "navigate" function, never write the path in the text.` +
    `\n- Your response must be brief and conversational.` +
    `\n\nAvailable tools: navigate, open_scanner, search_assets, ` +
    `create_asset, list_containers, create_container, create_template, extract_product_from_url.`
  );
}

function isCreateTemplateIntent(input = "") {
  const text = String(input || "").toLowerCase();
  const mentionsTemplate = /(template)/.test(text);
  const createVerb = /(build|generate|design|create)/.test(text);
  return mentionsTemplate && createVerb;
}

function inferNavigationPathFromInput(input = "") {
  const text = String(input || "").toLowerCase();

  const directPath = text.match(/\/(dashboard|settings|integrations|templates|scanner|loans|inventory)\b/);
  if (directPath) return directPath[0];

  if (/integrations/.test(text)) return "/integrations";
  if (/dashboard|home/.test(text)) return "/dashboard";
  if (/settings|preferences/.test(text)) return "/settings";
  if (/templates/.test(text)) return "/templates";
  if (/scanner/.test(text)) return "/scanner";
  if (/loans/.test(text)) return "/loans";
  if (/inventory/.test(text)) return "/dashboard";

  return null;
}

function isNavigationIntent(input = "") {
  const text = String(input || "").toLowerCase();
  const hasVerb = /(open|go to|take me|navigate)/.test(text);
  return hasVerb && !!inferNavigationPathFromInput(text);
}

function modelPromisesNavigation(text = "") {
  const t = String(text || "").toLowerCase();
  return /(i'?ll take you|i will take you|navigat|go to)/.test(t);
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
    if (isNaN(userId)) throw new Error("userId required");

    const { adapter, getClient } = await getAdapter(userId);

    let clientData;
    try {
      clientData = await getClient();
    } catch (err) {
      return { answer: `⚠️ ${err.message}`, action: "NAVIGATE", data: { path: "/integrations" } };
    }

    const { client, model, provider } = clientData;
    console.log(`[AI] Provider: ${provider} | Model: ${model}`);

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
      console.log("[AI][TemplateStrict] Strict mode enabled for template request.");
    }
    if (userInput === "SAY_HELLO_INITIAL") {
      finalInput =
        `Act as Veni, Invenicum assistant. Briefly introduce yourself. ` +
        `Reply in "${locale}". Say you can help with inventory.`;
    } else if (strictTemplateMode) {
      finalInput =
        `User request: ${userInput}\n\n` +
        `Strict template mode: you must invoke create_template.` +
        ` Do not write create_template(...) as text.` +
        ` The payload must exactly comply with:` +
        ` name:string, description:string, category:string, fields:array(5-8).` +
        ` Each field requires name and type in [text, number, date, dropdown, price, boolean, url].` +
        ` If type='dropdown', options is mandatory with 3-6 strings.` +
        ` If information is missing, assume reasonable values and complete useful fields.`;
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
        console.error(`[MCP] Error invoking tool ${name}:`, err.message);
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
            `[AI][Provider] Transient provider error (status=${error?.status ?? "n/a"}) on attempt 1.`,
          );
        if (strictTemplateMode) {
          return {
            answer:
              "The AI provider is under high demand right now. Opening the template creator so you don't lose time.",
            action: "NAVIGATE",
            data: { path: "/templates/create", reason: "provider_transient_error" },
          };
        } else {
          return {
            answer:
              "The AI provider is temporarily busy. Please try again in a few seconds.",
            action: null,
            data: {},
          };
        }
      }
      throw error;
    }

    if (strictTemplateMode) {
      console.log(
        `[AI][TemplateStrict] Attempt 1 completed. finalAction=${finalAction ?? "null"}`,
      );
    }

    if (!strictTemplateMode && !finalAction) {
      const providerNoAnswer =
        !finalAnswer ||
        /could not process the request|empty response/i.test(String(finalAnswer));

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
              `[AI] Empty/no-action response from provider. Heuristic-inferred navigation: ${inferredPath}`,
            );
            finalAction = "NAVIGATE";
            finalData = { path: inferredPath, reason: "provider_empty_response_navigation_fallback" };
          }
      }
    }

      // In strict template mode we attempt a forced second pass before aborting.
      if (strictTemplateMode && finalAction !== "CREATE_TEMPLATE") {
        console.warn(
          `[AI][TemplateStrict] Attempt 1 did not achieve CREATE_TEMPLATE. finalAnswer=${
            finalAnswer ? "present" : "empty"
          }. Starting forced retry.`,
        );

        const retryPrompt =
          `Mandatory retry: generate the template requested by the user and call create_template now.\n` +
          `User: ${userInput}\n\n` +
          `Strict rules:\n` +
          `- DO NOT reply with normal text.\n` +
          `- ONLY invoke create_template.\n` +
          `- fields must contain between 5 and 8 fields.\n` +
          `- Allowed types: text, number, date, dropdown, price, boolean, url.\n` +
          `- For dropdown, options are mandatory with 3 to 6 options.`;

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
            `[AI][Provider] Transient provider error (status=${error?.status ?? "n/a"}) on strict retry.`,
          );
          return {
            answer:
              "The AI provider is under high demand right now. Opening the template creator so you don't lose time.",
            action: "NAVIGATE",
            data: { path: "/templates/create", reason: "provider_transient_error_retry" },
          };
        }
        throw error;
      }

      console.log(
        `[AI][TemplateStrict] Retry completed. finalAction=${retryResult.finalAction ?? "null"}`,
      );

      if (retryResult.finalAction === "CREATE_TEMPLATE") {
        console.log("[AI][TemplateStrict] Retry successful: template created via tool call.");
        finalAction = retryResult.finalAction;
        finalData = retryResult.finalData;
        finalAnswer = retryResult.finalAnswer;
      } else {
        console.warn(
          "[AI][TemplateStrict] Retry failed. Navigating to template creator.",
        );
        return {
          answer:
            "I could not build a valid template automatically. Opening the template creator so you can complete required fields.",
          action: "NAVIGATE",
          data: { path: "/templates/create", reason: "strict_template_mode_failed" },
        };
      }
    }

    // Clean the answer from artifacts that the model sometimes includes in the text
    let answer = finalAnswer;
    if (answer) {
      // Fallback: the model sometimes writes the tool call as text instead of invoking it.
      // We try to parse any JSON containing "name": "navigate" or other tools.
      if (!finalAction) {
        // Search for any JSON block in the text
        const jsonMatches = answer.match(/\{[\s\S]*?\}/g) || [];
        for (const jsonStr of jsonMatches) {
          try {
            const parsed = JSON.parse(jsonStr);
            const toolName = parsed.name;
            const args = parsed.arguments || parsed.args || parsed.input || parsed;

            if (toolName === "navigate" || toolName === "navigate_to") {
              finalAction = "NAVIGATE";
              // The path can come with different key names
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
            // Not valid JSON — ignore
          }
        }

        // Fallback alternative for function syntax: navigate(route="dashboard")
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

      // Delete any remaining artifacts from the model
      answer = answer.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
      answer = answer.replace(/\*\*Acción:\*\*[^]*/gi, "");
      // Delete lines that only contain loose braces or brackets
      answer = answer.replace(/^[\s{}[\]]*$/gm, "").trim();

      if (strictTemplateMode && /create_template\s*\(/i.test(answer)) {
        answer = "";
      }
    }

    // If the action is navigation and there is no useful text response,
    // generate a default message so the chat is not left empty.
    if (!answer && finalAction) {
      const actionMessages = {
        NAVIGATE:        "Alright, taking you there.",
        OPEN_SCANNER:    "Opening the scanner...",
        CREATE_TEMPLATE: "Here is the template I designed. Review it before publishing.",
      };
      answer = actionMessages[finalAction] ?? "I have completed the requested action.";
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
        // Path with token to force prefill refresh even if you're already on /templates/create.
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
      answer: answer || "I have completed the requested action.",
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

  async purgeHistory(userId) {
    await prisma.chatMessage.deleteMany({
      where: { userId: parseInt(userId, 10) },
    });
  }

  async saveMessage(userId, text, isUser) {
    return await prisma.chatMessage.create({
      data: { userId: parseInt(userId), text, isUser },
    });
  }
}

module.exports = new AIService();
