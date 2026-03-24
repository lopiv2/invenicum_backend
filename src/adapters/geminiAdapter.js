// services/adapters/geminiAdapter.js
const { GoogleGenAI } = require("@google/genai");
const integrationService = require("../services/integrationsService");
const { DEFAULT_MODELS, AI_PROVIDERS } = require("../config/aiConstants");

/**
 * Devuelve un cliente y modelo Gemini listos para usar.
 * Lee la API key del sistema de integraciones del usuario.
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
 * Ejecuta el agentic loop con Gemini usando function calling nativo.
 */
async function runAgenticLoop({ client, model, messages, toolDefinitions, onToolCall }) {
  const MAX_ITERATIONS = 5;
  let finalAnswer = null;
  let finalAction = null;
  let finalData = {};

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.models.generateContent({
      model,
      contents: messages,
      tools: [{ functionDeclarations: toolDefinitions }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      config: {
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const candidate = response?.candidates?.[0];
    const allParts = candidate?.content?.parts ?? [];

    if (allParts.length === 0) {
      console.warn("[Gemini] Respuesta vacía:", JSON.stringify(response).substring(0, 300));
      finalAnswer = "Lo siento, no pude procesar la solicitud.";
      break;
    }

    // Filtramos partes de pensamiento (thought=true) — no forman parte del historial útil
    const parts = allParts.filter(p => !p.thought);
    messages.push({ role: "model", parts });

    const toolCalls = parts.filter((p) => p.functionCall);
    const textParts = parts.filter(p => p.text);
    console.log(`[Gemini] Iteración ${i+1}: ${toolCalls.length} tool calls, ${textParts.length} texto`);

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
      const { name, args } = part.functionCall;
      const result = await onToolCall(name, args);
      console.log(result.action);
      if (result.action) {
        finalAction = result.action;
        finalData = result.data ?? {};
        // Acciones de navegación/UI no necesitan otra iteración del modelo
        if (["NAVIGATE", "OPEN_SCANNER", "CREATE_TEMPLATE"].includes(result.action)) {
          shouldBreak = true;
        }
      }

      toolResults.push({
        functionResponse: {
          name,
          response: { result: result.toolResult ?? result.data ?? { ok: true } },
        },
      });
    }

    messages.push({ role: "user", parts: toolResults });
    if (shouldBreak) break;
  }

  return { finalAnswer, finalAction, finalData };
}

/**
 * Formato de mensajes inicial para Gemini.
 */
function buildInitialMessages(systemPrompt, userInput) {
  return [
    { role: "user", parts: [{ text: `${systemPrompt}\n\nUsuario: ${userInput}` }] },
  ];
}

module.exports = { getGeminiClient, runAgenticLoop, buildInitialMessages };