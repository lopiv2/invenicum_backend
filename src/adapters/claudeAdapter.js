// services/adapters/claudeAdapter.js
// Requires: npm install @anthropic-ai/sdk
const Anthropic = require("@anthropic-ai/sdk");
const integrationService = require("../services/integrationsService");
const { DEFAULT_MODELS, AI_PROVIDERS } = require("../config/aiConstants");

/**
 * Returns a Claude client ready to use.
 * Reads the API key from the user's integrations (type = "claude").
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
 * Converts tool definitions from MCP format to Claude format.
 * Claude uses the same JSON schema as Gemini for parameters,
 * but the object structure is slightly different.
 */
function adaptToolDefinitions(toolDefinitions) {
  return toolDefinitions.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters, // Claude uses input_schema instead of parameters
  }));
}

/**
 * Runs the agentic loop with Claude using tool calls.
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
      system: systemPrompt, // Claude keeps the system prompt separate from the messages array
      messages,
      tools,
      ...(forceToolName
        ? { tool_choice: { type: "tool", name: forceToolName } }
        : {}),
    });

    // Add the response to the conversation history
    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      // Final text response
      const textBlock = response.content.find((b) => b.type === "text");
      finalAnswer = strictToolMode ? null : textBlock?.text ?? "He completado la acción.";
      break;
    }

    // Execute tools and push their results
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
 * Initial message format for Claude.
 * Claude separates the system prompt from the messages array.
 */
function buildInitialMessages(systemPrompt, userInput) {
  // Return the system prompt separately so runAgenticLoop can use it
  return {
    messages: [{ role: "user", content: userInput }],
    systemPrompt,
  };
}

module.exports = { getClaudeClient, runAgenticLoop, buildInitialMessages };
