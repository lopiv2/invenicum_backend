const axios = require("axios");

async function getBase64FromUrl(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith("http")) return imageUrl;

  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 5000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const contentType = response.headers["content-type"] || "image/jpeg";
    const base64 = Buffer.from(response.data, "binary").toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error("⚠️ No se pudo convertir la imagen a Base64:", error.message);
    return imageUrl; // Si falla, devolvemos la URL original como respaldo
  }
}

/**
 * Genera el Prompt Universal para Gemini basado en la fuente
 */
function generateUniversalPrompt(contextHint, rawData, locale = "es") {
  // Mapeo amigable de códigos a nombres de idioma
  const languageMap = {
    es: "Español",
    en: "Inglés",
    fr: "Francés",
    de: "Alemán",
    it: "Italiano",
    pt: "Portugués",
  };
  const targetLanguage = languageMap[locale] || "Español";

  return `
    Actúa como un Analista de Datos Universal. Tu tarea es convertir un volcado de datos técnico en una ficha de inventario legible y estructurada.

    REGLAS DE PROCESAMIENTO:
    1. IDIOMA: Traduce TODA la información al **${targetLanguage}**.
    2. DESCRIPCIÓN: Redacta una biografía o resumen profesional basado en los datos (máximo 2-3 párrafos). Si no hay datos narrativos, invéntalos basándote en el contexto de ${contextHint}.
    3. IMÁGENES: Extrae la URL de la imagen con mejor resolución.
    4. CUSTOM FIELDS: Identifica los 9 o 10 atributos técnicos más importantes de la fuente (ej: tipos, habilidades, estadísticas, autores, dimensiones, peso, año, etc.) y lístalos en el objeto 'customFieldValues'.

    ESTRUCTURA DINÁMICA:
    - En 'customFieldValues', las CLAVES deben ser nombres descriptivos (ej: "Habilidades", "Jugadores", "Tipo", "Peso") y los VALORES deben ser los datos correspondientes traducidos.

    ESQUEMA REQUERIDO:
    {
      "name": "Nombre o Título principal",
      "description": "Resumen narrativo en ${targetLanguage}",
      "images": [{"url": "URL encontrada"}],
      "customFieldValues": {
        "external_id": "ID original",
        "clave_importante_1": "valor_1",
        "clave_importante_2": "valor_2",
        "clave_importante_3": "valor_3"
      }
    }

    DATOS DE ORIGEN (${contextHint}):
    ${rawData}
  `;
}

module.exports = { getBase64FromUrl, generateUniversalPrompt };
