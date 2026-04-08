// services/adapters/geminiAdapter.js
const { GoogleGenAI } = require("@google/genai");
const integrationService = require("../services/integrationsService");
const { DEFAULT_MODELS, AI_PROVIDERS } = require("../config/aiConstants");

const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableGeminiError(error) {
  const status = error?.status;
  const msg = String(error?.message || "").toLowerCase();
  return RETRIABLE_STATUS.has(status) || msg.includes("unavailable") || msg.includes("high demand");
}

async function generateContentWithRetry(client, payload, label, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.models.generateContent(payload);
    } catch (error) {
      const retriable = isRetriableGeminiError(error);
      const shouldRetry = retriable && attempt < maxRetries;

      if (!shouldRetry) throw error;

      const backoffMs = 700 * (attempt + 1);
      console.warn(
        `[Gemini] ${label}: error transitorio (status=${error?.status ?? "n/a"}). Reintento ${attempt + 1}/${maxRetries} en ${backoffMs}ms.`,
      );
      await sleep(backoffMs);
    }
  }
}

/**
 * returns a cliente and modelo Gemini listos for use.
 * Lee the API key del sistema de integraciones del Use.
 */
async function getGeminiClient(userId, preferredModel) {
  const geminiData = await integrationService.getGeminiApiKey(userId);
  if (!geminiData?.apiKey) {
    throw new Error(
      "No tienes una API Key de Gemini configurada. Ve a Integraciones para añadirla.",
    );
  }
  const model = preferredModel || geminiData.model || DEFAULT_MODELS[AI_PROVIDERS.GEMINI];
  return {
    client: new GoogleGenAI({ apiKey: geminiData.apiKey }),
    model,
    provider: "gemini",
  };
}

/**
 * Ejecuta the agentic loop with Gemini using function calling nativas.
 */
async function runAgenticLoop({ client, model, messages, toolDefinitions, onToolCall, systemPrompt, forceToolName = null, strictToolMode = false }) {
  const MAX_ITERATIONS = 5;
  let finalAnswer = null;
  let finalAction = null;
  let finalData = {};

  const activeToolDefinitions = forceToolName
    ? toolDefinitions.filter((t) => t.name === forceToolName)
    : toolDefinitions;

  if (forceToolName) {
    console.log(
      `[Gemini] Modo forzado activo: tool=${forceToolName}, strictToolMode=${strictToolMode}`,
    );
    console.log(
      `[Gemini] Tools activas en modo forzado: ${activeToolDefinitions.map((t) => t.name).join(", ") || "<none>"}`,
    );
  }

  const toolNames = activeToolDefinitions.map((t) => t.name);

  const detectToolNamesInText = (text = "") => {
    const detected = [];
    for (const name of toolNames) {
      const re = new RegExp(`\\b${name}\\s*\\(`, "i");
      if (re.test(text)) detected.push(name);
    }
    return detected;
  };

  const joinTextParts = (parts = []) =>
    parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("");

  const forceSingleToolCall = async (historyMessages, toolName, baseSystemPrompt, label) => {
    const forcedResponse = await generateContentWithRetry(client, {
      model,
      contents: historyMessages,
      config: {
        tools: [{ functionDeclarations: activeToolDefinitions }],
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [toolName],
          },
        },
        systemInstruction: `${baseSystemPrompt}\n\nCRITICO: No respondas en texto. Debes invocar la función ${toolName} ahora con argumentos válidos.`,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }, label);

    const forcedCandidate = forcedResponse?.candidates?.[0];
    const forcedRawParts = forcedCandidate?.content?.parts ?? [];
    const forcedParts = forcedRawParts.filter(
      (p) => !p.thought || p.functionCall || p.functionResponse,
    );
    const forcedToolCalls = forcedParts.filter((p) => p.functionCall);
    const forcedTextParts = forcedParts.filter((p) => p.text);
    return { forcedCandidate, forcedParts, forcedToolCalls, forcedTextParts };
  };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const toolCallingConfig = forceToolName
      ? { mode: "ANY", allowedFunctionNames: [forceToolName] }
      : { mode: "AUTO" };

    const response = await generateContentWithRetry(client, {
      model,
      contents: messages,
      config: {
        tools: [{ functionDeclarations: activeToolDefinitions }],
        toolConfig: { functionCallingConfig: toolCallingConfig },
        systemInstruction: systemPrompt,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }, "main-loop");

    const candidate = response?.candidates?.[0];
    const allParts = candidate?.content?.parts ?? [];

    if (allParts.length === 0) {
      console.warn("[Gemini] Respuesta vacía:", JSON.stringify(response).substring(0, 300));
      finalAnswer = "Lo siento, no pude procesar la solicitud.";
      break;
    }

    // Filter thought parts, but always preserve functionCall/functionResponse.
    // Some models may mark functionCall with thought=true.
    let parts = allParts.filter((p) => !p.thought || p.functionCall || p.functionResponse);
    let toolCalls = parts.filter((p) => p.functionCall);
    let textParts = parts.filter((p) => p.text);
    console.log(`[Gemini] Iteración ${i+1}: ${toolCalls.length} tool calls, ${textParts.length} texto`);

    if (toolCalls.length === 0) {
      const textAnswer = joinTextParts(parts);
      if (strictToolMode && textAnswer) {
        console.warn(
          `[Gemini] Iteración ${i + 1}: texto en modo estricto (snippet): ${textAnswer.slice(0, 220).replace(/\s+/g, " ")}`,
        );
      }
      const detectedToolNames = detectToolNamesInText(textAnswer);

      // Si Gemini escribió la tool como texto (ej. create_template(...)),
      // hacemos un segundo intento forzando function-calling.
      if (detectedToolNames.length > 0) {
        console.warn(
          `[Gemini] Iteración ${i + 1}: detectado texto tipo tool-call (${detectedToolNames.join(", ")}). Reintentando en modo forzado.`,
        );

        const { forcedCandidate, forcedParts, forcedToolCalls, forcedTextParts } =
          await forceSingleToolCall(messages, detectedToolNames[0], systemPrompt, "forced-retry");
        console.log(
          `[Gemini] Reintento forzado ${i + 1}: ${forcedToolCalls.length} tool calls, ${forcedTextParts.length} texto`,
        );
        if (forcedToolCalls.length === 0 && forcedTextParts.length === 0) {
          console.warn(
            `[Gemini] Reintento forzado ${i + 1}: sin parts útiles. finishReason=${forcedCandidate?.finishReason ?? "unknown"}`,
          );
        }

        if (forcedToolCalls.length > 0) {
          parts = forcedParts;
          toolCalls = forcedToolCalls;
          textParts = forcedTextParts;
        } else {
          messages.push({ role: "model", parts });
          finalAnswer = strictToolMode ? null : textAnswer;
          console.warn(
            `[Gemini] Iteración ${i + 1}: reintento forzado sin tool call. strictToolMode=${strictToolMode}`,
          );
          break;
        }
      } else {
        if (strictToolMode && forceToolName) {
          console.warn(
            `[Gemini] Iteración ${i + 1}: modo estricto sin tool call y sin patrón textual. Forzando segundo intento directo a ${forceToolName}.`,
          );

          const { forcedCandidate, forcedParts, forcedToolCalls, forcedTextParts } =
            await forceSingleToolCall(messages, forceToolName, systemPrompt, "forced-strict-no-pattern");
          console.log(
            `[Gemini] Forzado estricto ${i + 1}: ${forcedToolCalls.length} tool calls, ${forcedTextParts.length} texto`,
          );

          if (forcedToolCalls.length > 0) {
            parts = forcedParts;
            toolCalls = forcedToolCalls;
            textParts = forcedTextParts;
          } else {
            messages.push({ role: "model", parts });
            finalAnswer = null;
            const forcedSnippet = forcedTextParts
              .map((p) => p.text)
              .join(" ")
              .replace(/\s+/g, " ")
              .slice(0, 220);
            console.warn(
              `[Gemini] Forzado estricto ${i + 1} sin tool call. finishReason=${forcedCandidate?.finishReason ?? "unknown"} | textSnippet=${forcedSnippet || "<empty>"}`,
            );
            break;
          }
        } else {
          messages.push({ role: "model", parts });
          finalAnswer = strictToolMode ? null : textAnswer;
          if (strictToolMode) {
            console.warn(
              `[Gemini] Iteración ${i + 1}: modo estricto sin tool call y sin patrón de tool en texto.`,
            );
          }
          break;
        }
      }
    }

    messages.push({ role: "model", parts });

    if (toolCalls.length === 0) {
      finalAnswer = parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("");
      break;
    }

    const toolResults = [];
    let shouldBreak = false;
    for (const part of toolCalls) {
      const { id, name, args } = part.functionCall || {};
      if (!name) {
        console.warn("[Gemini] functionCall inválido: falta name. Se omite part.");
        continue;
      }

      const safeArgs = args && typeof args === "object" ? args : {};
      const result = await onToolCall(name, safeArgs);
      console.log(result.action);
      if (result.action) {
        finalAction = result.action;
        finalData = result.data ?? {};
        console.log(
          `[Gemini] Tool ejecutada: ${name} -> action=${result.action}`,
        );
        // Acciones de navegación/UI no necesitan otra iteración del modelo
        if (["NAVIGATE", "OPEN_SCANNER", "CREATE_TEMPLATE"].includes(result.action)) {
          shouldBreak = true;
        }
      }

      toolResults.push({
        functionResponse: {
          ...(id ? { id } : {}),
          name,
          response: { result: result.toolResult ?? result.data ?? { ok: true } },
        },
      });
    }

    messages.push({ role: "user", parts: toolResults });
    if (shouldBreak) break;
  }

  console.log(
    `[Gemini] Loop finalizado. finalAction=${finalAction ?? "null"}, finalAnswer=${finalAnswer ? "present" : "empty"}`,
  );

  return { finalAnswer, finalAction, finalData };
}

/**
 * Formato de mensajes inicial for Gemini.
 */
function buildInitialMessages(systemPrompt, userInput) {
  return {
    messages: [{ role: "user", parts: [{ text: userInput }] }],
    systemPrompt,
  };
}

module.exports = { getGeminiClient, runAgenticLoop, buildInitialMessages };
