// services/adapters/claudeAdapter.js
// Requiere: npm install @anthropic-ai/sdk
const Anthropic = require("@anthropic-ai/sdk");
const integrationService = require("../services/integrationsService");
const { DEFAULT_MODELS, AI_PROVIDERS } = require("../config/aiConstants");

/**
 * Devuelve un cliente Claude listo para usar.
 * Lee la API key de las integraciones del usuario (type = "claude").
 */
async function getClaudeClient(userId, preferredModel) {
  const claudeData = await integrationService.getClaudeApiKey(userId);
  if (!claudeData?.apiKey) {
    throw new Error(
      "No tienes una API Key de Anthropic configurada. Ve a Integraciones para añadirla.",
    );
  }
  return {
    client: new Anthropic({ apiKey: claudeData.apiKey }),
    model: preferredModel || claudeData.model || DEFAULT_MODELS[AI_PROVIDERS.CLAUDE],
    provider: "claude",
  };
}

/**
 * Convierte las tool definitions del formato MCP al formato de Claude.
 * Claude usa el mismo esquema JSON que Gemini para los parámetros,
 * pero la estructura del objeto es ligeramente diferente.
 */
function adaptToolDefinitions(toolDefinitions) {
  return toolDefinitions.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters, // Claude usa input_schema en lugar de parameters
  }));
}

/**
 * Ejecuta el agentic loop con Claude usando tool use.
 */
async function runAgenticLoop({ client, model, messages, toolDefinitions, onToolCall, systemPrompt, forceToolName = null, strictToolMode = false }) {
  const MAX_ITERATIONS = 5;
  let finalAnswer = null;
  let finalAction = null;
  let finalData = {};

  const tools = adaptToolDefinitions(toolDefinitions);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt, // Claude separa el system del array de mensajes
      messages,
      tools,
      ...(forceToolName
        ? { tool_choice: { type: "tool", name: forceToolName } }
        : {}),
    });

    // Añadimos la respuesta al historial
    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      // Respuesta final de texto
      const textBlock = response.content.find((b) => b.type === "text");
      finalAnswer = strictToolMode ? null : textBlock?.text ?? "He completado la acción.";
      break;
    }

    // Ejecutar tools y devolver resultados
    const toolResults = [];
    let shouldBreak = false;
    for (const block of toolUseBlocks) {
      const result = await onToolCall(block.name, block.input);

      if (result.action) {
        finalAction = result.action;
        finalData = result.data ?? {};
        if (["NAVIGATE", "OPEN_SCANNER", "CREATE_TEMPLATE"].includes(result.action)) {
          shouldBreak = true;
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result.toolResult ?? result.data ?? { ok: true }),
      });
    }

    messages.push({ role: "user", content: toolResults });
    if (shouldBreak) break;
  }

  return { finalAnswer, finalAction, finalData };
}

/**
 * Formato de mensajes inicial para Claude.
 * Claude separa el system prompt del array de mensajes.
 */
function buildInitialMessages(systemPrompt, userInput) {
  // Devolvemos el system por separado para que runAgenticLoop lo use
  return {
    messages: [{ role: "user", content: userInput }],
    systemPrompt,
  };
}

module.exports = { getClaudeClient, runAgenticLoop, buildInitialMessages };