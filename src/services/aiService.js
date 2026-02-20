const axios = require("axios");
const cheerio = require("cheerio");
const { GoogleGenAI } = require("@google/genai");
const { encrypt, decrypt } = require("../middleware/cryptoUtils");
const prisma = require("../middleware/prisma");
const integrationService = require("./integrationsService");

class AIService {
  async processChatConversation(userInput, context = {}) {
    const userId = parseInt(context.userId);
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

      const dynamicClient = new GoogleGenAI({ apiKey: geminiData.apiKey });

      // Buscamos los contenedores para que Veni conozca los IDs reales
      const containers = await prisma.container.findMany({
        where: { userId: userId }, // <--- AHORA SÍ ESTÁ FILTRADO
        select: { id: true, name: true },
      });

      // Convertimos la lista de Prisma a un formato que Gemini entienda bien
      const listaContenedores = containers
        .map((c) => `- ${c.name} (ID: ${c.id})`)
        .join("\n");

      const currentContainerId = context.containerId || "default";

      const systemPrompt = `Eres Veni, el asistente de Invenicum.
      
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

      IMPORTANTE: Responde SIEMPRE con un objeto JSON:
      {
        "answer": "Tu respuesta conversacional",
        "action": "PRODUCT_EXTRACT" | "NAVIGATE" | "OPEN_SCANNER" | null,
        "data": {}
      }`;

      const response = await dynamicClient.models.generateContent({
        model: geminiData.model || "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              { text: `${systemPrompt}\n\nMensaje del usuario: ${userInput}` },
            ],
          },
        ],
        config: { generationConfig: { responseMimeType: "application/json" } },
      });

      // Extraer texto y limpiar
      const rawText = response.candidates[0].content.parts[0].text;
      const result = JSON.parse(rawText.replace(/```json|```/g, "").trim());

      // LÓGICA DE EXTRACCIÓN (Tu función de scraping)
      // EXTRAER INFO (Pasando la misma clave)
      if (result.action === "PRODUCT_EXTRACT" && result.data.url) {
        result.data = await this.extractInfoFromUrl(
          result.data.url,
          ["Nombre", "Precio", "Descripción"],
          apiKeyToUse,
        );
        result.answer =
          "He analizado el enlace con tu propia clave de Gemini. ¿Quieres guardar los datos?";
      }

      return result;
    } catch (error) {
      console.error("❌ Error en AIService:", error.message);
      return {
        answer:
          "Lo siento, tuve un problema al consultar tus datos. Inténtalo de nuevo.",
        action: null,
        data: {},
      };
    }
  }

  async getBase64FromUrl(imageUrl) {
    if (!imageUrl || !imageUrl.startsWith("http")) return imageUrl;

    try {
      const axios = require("axios");
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
      console.error(
        "⚠️ No se pudo convertir la imagen a Base64:",
        error.message,
      );
      return imageUrl; // Si falla, devolvemos la URL original como respaldo
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
        result.imageUrl = await this.getBase64FromUrl(result.imageUrl);
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
