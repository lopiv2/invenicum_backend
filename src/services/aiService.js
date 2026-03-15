const axios = require("axios");
const cheerio = require("cheerio");
const { GoogleGenAI } = require("@google/genai");
const { encrypt, decrypt } = require("../middleware/cryptoUtils");
const prisma = require("../middleware/prisma");
const integrationService = require("./integrationsService");
const { getBase64FromUrl } = require("../middleware/utils");

class AIService {
  async processChatConversation(userInput, context = {}) {
    const userId = parseInt(context.userId);
    const locale = context.locale || "es"; // Extraemos el idioma del contexto

    if (isNaN(userId)) throw new Error("userId requerido");
    const geminiData = await integrationService.getGeminiApiKey(userId);

    try {
      if (!geminiData) {
        return {
          answer:
            "⚠️ Por favor, configura tu API Key de Gemini en Integraciones.",
          action: "NAVIGATE",
          data: { path: "/integrations" },
        };
      }

      // --- LÓGICA DE INTERCEPTACIÓN DE COMANDO ---
      let finalInput = userInput;
      if (userInput === "SAY_HELLO_INITIAL") {
        finalInput = `Actúa como Veni. Preséntate brevemente y salúdame amigablemente. 
                      REGLA DE ORO: Debes responder en el idioma "${locale}". 
                      Dime que estás listo para ayudarme a organizar mis contenedores e inventario.`;
      }

      const dynamicClient = new GoogleGenAI({ apiKey: geminiData.apiKey });

      // Buscamos los contenedores del usuario
      const containers = await prisma.container.findMany({
        where: { userId: userId },
        select: { id: true, name: true },
      });

      const listaContenedores = containers
        .map((c) => `- ${c.name} (ID: ${c.id})`)
        .join("\n");

      const systemPrompt = `Eres Veni, el asistente de Invenicum.

      REGLA DE IDIOMA CRÍTICA:
      - Debes responder EXCLUSIVAMENTE en el idioma: "${locale}".
      - Adapta tu tono y saludos a las normas culturales de ese idioma.
      
      INFORMACIÓN REAL DE LA BASE DE DATOS:
      - Contenedores actuales del usuario:
      ${listaContenedores}

      REGLAS DE NAVEGACIÓN:
      - Si el usuario menciona un contenedor por su nombre, busca su ID en la lista de arriba.
      - Para ir al inventario de un contenedor: usa "NAVIGATE" y data: {"path": "/container/ID/asset-types"}.
      - Para ir a préstamos: usa "NAVIGATE" y data: {"path": "/container/ID/loans"}.
      - Si pide "Panel de Control" o "Dashboard": usa "NAVIGATE" y data: {"path": "/dashboard"}.
      - Si pide "Preferencias": usa "NAVIGATE" y data: {"path": "/preferences"}.
      - Si pide escanear: usa "OPEN_SCANNER".

      ACCIONES DE PLANTILLAS:
      - Si el usuario quiere crear una plantilla (ej: "Ayúdame a organizar mis vinilos"):
        1. Identifica campos lógicos según el contexto.
        2. Establece "action": "CREATE_TEMPLATE".
        3. En "data", construye este objeto EXACTO:
           {
             "name": "Nombre de la plantilla",
             "description": "Breve descripción",
             "category": "Categoría",
             "fields": [
               { "name": "Nombre del campo", "type": "text" }
             ]
           }
        4. REGLA CRÍTICA: "type" SOLO puede ser: "text", "number", "date", "dropdown", "price", "boolean", "url".

      IMPORTANTE: Responde SIEMPRE con un objeto JSON:
      {
        "answer": "Tu respuesta conversacional",
        "action": "PRODUCT_EXTRACT" | "NAVIGATE" | "OPEN_SCANNER" | "CREATE_TEMPLATE" | null,
        "data": {}
      }`;

      const response = await dynamicClient.models.generateContent({
        model: geminiData.model || "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              { text: `${systemPrompt}\n\nMensaje del usuario: ${finalInput}` },
            ],
          },
        ],
        config: { generationConfig: { responseMimeType: "application/json" } },
      });

      const rawText = response.candidates[0].content.parts[0].text;
      const result = JSON.parse(rawText.replace(/```json|```/g, "").trim());

      // Si Gemini generó una plantilla con dropdowns sin opciones,
      // hacemos un segundo llamado específico para rellenarlas.
      if (result.action === "CREATE_TEMPLATE" && result.data?.fields) {
        const dropdownsWithoutOptions = result.data.fields.filter(
          (f) =>
            f.type === "dropdown" && (!f.options || f.options.length === 0),
        );

        if (dropdownsWithoutOptions.length > 0) {
          const fieldNames = dropdownsWithoutOptions
            .map((f) => `"${f.name}"`)
            .join(", ");
          const optionsPrompt = `Para una plantilla llamada "${result.data.name}" de categoría "${result.data.category}", 
sugiere entre 3 y 6 opciones realistas para cada uno de estos campos de tipo dropdown: ${fieldNames}.
Responde ÚNICAMENTE con un objeto JSON donde cada clave es el nombre exacto del campo y el valor es un array de strings.
Ejemplo: { "Estado": ["Nuevo", "Usado", "Dañado"] }`;

          try {
            const optionsResponse = await dynamicClient.models.generateContent({
              model: geminiData.model || "gemini-2.0-flash",
              contents: [{ role: "user", parts: [{ text: optionsPrompt }] }],
              config: {
                generationConfig: { responseMimeType: "application/json" },
              },
            });

            const optionsRaw =
              optionsResponse.candidates[0].content.parts[0].text;
            const optionsMap = JSON.parse(
              optionsRaw.replace(/```json|```/g, "").trim(),
            );

            // Inyectamos las opciones en los campos correspondientes
            result.data.fields = result.data.fields.map((f) => {
              if (f.type === "dropdown" && optionsMap[f.name]) {
                return { ...f, options: optionsMap[f.name] };
              }
              return f;
            });

            console.log(
              "[CREATE_TEMPLATE] Opciones inyectadas:",
              JSON.stringify(
                result.data.fields.filter((f) => f.type === "dropdown"),
                null,
                2,
              ),
            );
          } catch (e) {
            console.error(
              "[CREATE_TEMPLATE] Error obteniendo opciones:",
              e.message,
            );
          }
        }
      }

      // LÓGICA DE EXTRACCIÓN DE PRODUCTO (Tu función original)
      if (result.action === "PRODUCT_EXTRACT" && result.data.url) {
        result.data = await this.extractInfoFromUrl(
          result.data.url,
          ["Nombre", "Precio", "Descripción"],
          userId, // Usamos el userId para obtener la key dentro de la función
        );
        result.answer =
          locale === "es"
            ? "He analizado el enlace. ¿Quieres guardar los datos?"
            : "I've analyzed the link. Do you want to save the data?";
      }

      return result;
    } catch (error) {
      console.error("❌ Error en AIService:", error.message);
      return {
        answer: "Lo siento, tuve un problema al consultar tus datos.",
        action: null,
        data: {},
      };
    }
  }

  async extractInfoFromUrl(url, fields, userId) {
    const geminiData = await integrationService.getGeminiApiKey(userId);
    const apiKeyToUse = geminiData.apiKey;

    if (!apiKeyToUse) {
      throw new Error(
        "Se requiere una API Key de usuario para realizar la extracción.",
      );
    }

    try {
      const dynamicClient = new GoogleGenAI({ apiKey: apiKeyToUse });

      // 1. Obtener HTML con timeout y headers adecuados
      const { data: html } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000,
      });

      // 2. Procesamiento del HTML
      const $ = cheerio.load(html);
      const baseUrl = new URL(url);

      // --- NORMALIZACIÓN DE ogImage ---
      let ogImage = $('meta[property="og:image"]').attr("content");
      if (ogImage) {
        if (ogImage.startsWith("/")) {
          ogImage = `${baseUrl.origin}${ogImage}`;
        } else if (!ogImage.startsWith("http")) {
          ogImage =
            ogImage.includes("www.") || ogImage.includes(".")
              ? `https://${ogImage.replace(/^\/\//, "")}`
              : `${baseUrl.origin}/${ogImage}`;
        }
      }

      // Limpieza de etiquetas innecesarias para ahorrar tokens
      $("script, style, nav, footer, header, aside, noscript").remove();
      const cleanText = $("body")
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 25000); // Límite seguro de caracteres

      // 3. Configuración del modelo (Gemini 3 Flash)
      const response = await dynamicClient.models.generateContent({
        model: geminiData.model || "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Analiza el contenido de esta web: "${cleanText}". 
              URL de referencia: ${url}
              
              Extrae los siguientes campos en formato JSON:
              - name (nombre del producto)
              - description (breve descripción)
              - "imageUrl": usa prioritariamente esta URL: ${ogImage || "null"}.
              - ${fields.join(", ")}: campos adicionales.

              REGLAS CRÍTICAS:
              1. Si la imageUrl es relativa, complétala usando el dominio ${baseUrl.origin}.
              2. Si un campo no existe, devuelve null.
              3. Usa exactamente los nombres de campos proporcionados (case-sensitive).
              4. Responde ÚNICAMENTE el objeto JSON, sin bloques de código ni explicaciones.`,
              },
            ],
          },
        ],
        config: { generationConfig: { responseMimeType: "application/json" } },
      });

      // 4. Procesamiento de respuesta con Limpieza de Seguridad
      let rawText = response.candidates[0].content.parts[0].text;

      // Limpieza por si el modelo incluye Markdown a pesar de la instrucción
      const cleanJsonString = rawText
        .replace(/^```json\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();

      const result = JSON.parse(cleanJsonString);

      // Doble seguro para la URL de la imagen
      if (
        result.imageUrl &&
        typeof result.imageUrl === "string" &&
        !result.imageUrl.startsWith("http")
      ) {
        result.imageUrl = new URL(result.imageUrl, baseUrl.origin).href;
      }

      // --- NUEVA LÓGICA DE CONVERSIÓN ---
      if (result.imageUrl && result.imageUrl.startsWith("http")) {
        console.log("🔄 Convirtiendo imagen a Base64 para evitar CORS...");
        result.imageUrl = await getBase64FromUrl(result.imageUrl);
      }

      return result;
    } catch (error) {
      console.error("❌ Error en extractInfoFromUrl:", error.message);

      if (error.response?.status === 429 || error.message.includes("429")) {
        throw new Error(
          "Tu cuota de Gemini se ha agotado. Revisa tu panel de Google AI Studio.",
        );
      }
      if (error.message.includes("API_KEY_INVALID")) {
        throw new Error("Tu API Key de Gemini parece no ser válida.");
      }

      throw new Error(`Error en la extracción IA: ${error.message}`);
    }
  }

  async getRecentHistory(userId) {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return await prisma.chatMessage.findMany({
      where: {
        userId: userId,
        createdAt: { gte: twentyFourHoursAgo }, // Solo trae lo de las últimas 24h
      },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
  }

  async saveMessage(userId, text, isUser) {
    return await prisma.chatMessage.create({
      data: {
        userId: parseInt(userId), // <--- Forzamos que sea un número
        text: text,
        isUser: isUser,
      },
    });
  }
}

module.exports = new AIService();
