// config/aiConstants.js

const AI_PROVIDERS = {
  GEMINI: "gemini",
  OPENAI: "openai", 
  CLAUDE: "claude",
};

const AI_MODELS = {
  gemini: [
    { id: "gemini-3-flash-preview",   label: "Gemini 3.0 Flash",          default: true  },
    { id: "gemini-2.0-flash",         label: "Gemini 2.0 Flash",          default: false  },
    { id: "gemini-2.0-flash-thinking", label: "Gemini 2.0 Flash Thinking", default: false },
    { id: "gemini-1.5-pro",            label: "Gemini 1.5 Pro",            default: false },
  ],
  openai: [
    { id: "gpt-4o",       label: "GPT-4o",       default: true  },
    { id: "gpt-4o-mini",  label: "GPT-4o Mini",  default: false },
    { id: "gpt-4-turbo",  label: "GPT-4 Turbo",  default: false },
  ],
  claude: [
    { id: "claude-sonnet-4-6",  label: "Claude Sonnet 4.6",  default: true  },
    { id: "claude-opus-4-6",    label: "Claude Opus 4.6",    default: false },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", default: false },
  ],
};

const DEFAULT_MODELS = Object.fromEntries(
  Object.entries(AI_MODELS).map(([provider, models]) => [
    provider,
    models.find((m) => m.default).id,
  ])
);
// → { gemini: "gemini-2.0-flash", openai: "gpt-4o", claude: "claude-sonnet-4-6" }

module.exports = { AI_PROVIDERS, AI_MODELS, DEFAULT_MODELS };