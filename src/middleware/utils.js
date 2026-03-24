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
 * Genera el Prompt Universal optimizado para Mapeo y Enriquecimiento
 * @param {string} contextHint - Contexto de la fuente (ej: "un Pokémon")
 * @param {string} rawData - El JSON bruto de la API
 * @param {string} locale - Código de idioma (es, en, etc.)
 * @param {boolean} isNewStructure - Si es true, pide a la IA que genere las reglas de mapeo
 */
function generateUniversalPrompt(
  contextHint,
  rawData,
  locale = "es",
  isNewStructure = true,
) {
  const languageMap = {
    es: "Español",
    en: "Inglés",
    fr: "Francés",
    de: "Alemán",
    it: "Italiano",
    pt: "Portugués",
  };
  const targetLanguage = languageMap[locale] || "Español";

  // Si ya tenemos el mapeo, el prompt es mucho más corto y barato (ahorro de tokens)
  if (!isNewStructure) {
    return `
      Actúa como un Redactor Creativo. 
      Tu tarea es convertir estos datos técnicos ya filtrados en una ficha atractiva en **${targetLanguage}**.

      DATOS TÉCNICOS:
      ${rawData}

      REQUERIMIENTOS:
      1. Redacta una descripción narrativa de 2-3 párrafos basada en los datos.
      2. Asegúrate de que el nombre y los valores de los campos estén correctamente traducidos.
      3. Responde ÚNICAMENTE con un objeto JSON que siga esta estructura:
      {
        "name": "Nombre traducido",
        "description": "Descripción redactada",
        "images": [{"url": "URL original"}],
        "customFieldValues": { "Campo": "Valor traducido" }
      }
    `;
  }

  // Si la estructura es NUEVA, pedimos el "Mapeo de ADN" de la API
  return `
    Actúa como un Analista de Datos y Especialista en APIs. 
    Tu tarea es analizar un volcado de datos de ${contextHint} y crear un mapeo permanente.

    REGLAS DE PROCESAMIENTO:
    1. IDIOMA: Traduce toda la información al **${targetLanguage}**.
    2. DESCRIPCIÓN: Redacta una biografía o resumen profesional (2-3 párrafos). Si no hay datos, invéntalos con coherencia al contexto de ${contextHint}.
    3. ESTRUCTURA DINÁMICA: Identifica los 9-10 atributos más importantes.
    4. MAPEAMIENTO (CRÍTICO): Identifica la ruta exacta (JSON path / dot notation) de donde extraes cada dato del "ORIGEN" original.

    ESQUEMA DE RESPUESTA REQUERIDO:
    {
      "itemData": {
        "name": "Nombre principal",
        "description": "Resumen narrativo en ${targetLanguage}",
        "images": [{"url": "URL con mejor resolución encontrada"}],
        "customFieldValues": {
          "Atributo_1": "Valor_1",
          "Atributo_2": "Valor_2"
        }
      },
      "mappingRules": {
        "name": "ruta.al.nombre", 
        "image_url": "ruta.a.la.imagen",
        "fields": {
          "Atributo_1": "ruta.al.valor_1",
          "Atributo_2": "ruta.al.valor_2"
        }
      }
    }

    EJEMPLO DE MAPPING RULES:
    Si el nombre está en rawData.result.title, el valor debe ser "result.title". 
    Si está en una lista como rawData.abilities[0].name, usa "abilities[0].name".

    DATOS DE ORIGEN (${contextHint}):
    ${rawData}
  `;
}

module.exports = { getBase64FromUrl, generateUniversalPrompt };
