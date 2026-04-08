// services/adapters/openaiAdapter.js
// Requiere: npm install openai
const OpenAI = require("openai");
const integrationService = require("../services/integrationsService");
const { DEFAULT_MODELS, AI_PROVIDERS } = require("../config/aiConstants");

/**
 * returns a cliente OpenAI listo for use.
 * Lee the API key de the integraciones del Use (type = "openai").
 */
async function getOpenAIClient(userId, preferredModel) {
  const openaiData = await integrationService.getOpenAIApiKey(userId);
  if (!openaiData?.apiKey) {
    throw new Error(
      "No tienes una API Key de OpenAI configurada. Ve a Integraciones para añadirla.",
    );
  }
  return {
    client: new OpenAI({ apiKey: openaiData.apiKey }),
    model: preferredModel || openaiData.model || DEFAULT_MODELS[AI_PROVIDERS.OPENAI],
    provider: "openai",
  };
}

/**
 * Convierte the definiciones de tools del formato MCP (compatible with Gemini)
 * al formato que espera OpenAI.
 */
function adaptToolDefinitions(toolDefinitions) {
  return toolDefinitions.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Ejecuta the agentic loop with OpenAI using function calling.
 */
async function runAgenticLoop({ client, model, messages, toolDefinitions, onToolCall, forceToolName = null, strictToolMode = false }) {
  const MAX_ITERATIONS = 5;
  let finalAnswer = null;
  let finalAction = null;
  let finalData = {};

  const tools = adaptToolDefinitions(toolDefinitions);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: forceToolName ? { type: "function", function: { name: forceToolName } } : "auto",
    });

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      finalAnswer = strictToolMode ? null : message.content;
      break;
    }

    let shouldBreak = false;
    for (const toolCall of message.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      const result = await onToolCall(name, args);

      if (result.action) {
        finalAction = result.action;
        finalData = result.data ?? {};
        if (["NAVIGATE", "OPEN_SCANNER", "CREATE_TEMPLATE"].includes(result.action)) {
          shouldBreak = true;
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result.toolResult ?? result.data ?? { ok: true }),
      });
    }
    if (shouldBreak) break;
  }

  return { finalAnswer, finalAction, finalData };
}

/**
 * Formato de mensajes inicial for OpenAI.
 */
function buildInitialMessages(systemPrompt, userInput) {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ];
}

module.exports = { getOpenAIClient, runAgenticLoop, buildInitialMessages };
