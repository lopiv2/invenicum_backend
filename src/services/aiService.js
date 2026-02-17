const axios = require("axios");
const cheerio = require("cheerio");
const { GoogleGenAI } = require("@google/genai");
const { encrypt, decrypt } = require("../middleware/cryptoUtils");
const prisma = require("../middleware/prisma");

class AIService {
  async processChatConversation(userInput, context = {}) {
    const userId = parseInt(context.userId);
    if (isNaN(userId)) throw new Error("userId requerido");
    try {
      // 1. BUSCAR LA INTEGRACIÓN OBLIGATORIA
      const userIntegration = await prisma.userIntegration.findUnique({
        where: { userId_type: { userId, type: "gemini" } },
      });
      // 2. VALIDAR QUE ESTÉ ACTIVA Y TENGA DATOS
      if (
        !userIntegration ||
        !userIntegration.isActive ||
        !userIntegration.config?.data
      ) {
        return {
          answer:
            "⚠️ Para hablar conmigo, primero debes configurar tu API Key de Gemini en el apartado de Integraciones.",
          action: "NAVIGATE", // Sugerimos ir a configurarlo
          data: { path: "/integrations" },
        };
      }
      // 3. DESCIFRAR LA CLAVE DEL USUARIO
      let apiKeyToUse;
      let defaultModel = "gemini-3-flash-preview";
      try {
        const decryptedConfig = JSON.parse(
          decrypt(userIntegration.config.data),
        );
        apiKeyToUse = decryptedConfig.apiKey;
        if (decryptedConfig.model) defaultModel = decryptedConfig.model;
      } catch (e) {
        throw new Error(
          "No se pudo descifrar la configuración de la integración",
        );
      }
      if (!apiKeyToUse)
        throw new Error("API Key no encontrada en la configuración");

      // 4. INICIALIZAR EL CLIENTE CON LA CLAVE DEL USUARIO
      const dynamicClient = new GoogleGenAI({ apiKey: apiKeyToUse });

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

      // 5. LLAMADA A GEMINI (Sintaxis que ya te funciona)
      const response = await dynamicClient.models.generateContent({
        model: defaultModel || "gemini-3-flash-preview",
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

      // 6. LÓGICA DE EXTRACCIÓN (Tu función de scraping)
      // 6. EXTRAER INFO (Pasando la misma clave)
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

  async extractInfoFromUrl(url, fields, apiKey) {
    // 1. Verificación de seguridad: si no hay clave de usuario, no hay servicio.
    if (!apiKey) {
      throw new Error(
        "Se requiere una API Key de usuario para realizar la extracción.",
      );
    }

    try {
      // 2. Inicializamos el cliente específico para esta petición
      const dynamicClient = new GoogleGenAI({ apiKey });

      const { data: html } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 15000,
      });

      const $ = cheerio.load(html);
      $("script, style, nav, footer, header, aside").remove();
      const cleanText = $("body")
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 25000);

      // 3. Usamos el cliente dinámico y un modelo optimizado (Gemini 1.5 Flash es ideal aquí)
      const model = dynamicClient.models.get("gemini-1.5-flash");

      const response = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Analiza este contenido extraído de una web: "${cleanText}". 
              Extrae exactamente estos campos en formato JSON: ${fields.join(", ")}.
              IMPORTANTE: Si no encuentras algún campo, devuélvelo como null. 
              Usa los nombres de los campos exactamente como se te proporcionan (case-sensitive).
              Responde únicamente el objeto JSON.`,
              },
            ],
          },
        ],
        // Forzamos respuesta JSON si el modelo lo soporta (en los SDKs de GoogleGenAI)
        generationConfig: { responseMimeType: "application/json" },
      });

      // 4. Limpieza y parseo de la respuesta
      const rawText = response.candidates[0].content.parts[0].text;
      const cleanJson = rawText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      return JSON.parse(cleanJson);
    } catch (error) {
      console.error(
        "❌ Error en extractInfoFromUrl (con clave de usuario):",
        error.message,
      );

      // Mapeo de errores de cuota/clave para el usuario
      if (error.message.includes("429")) {
        throw new Error(
          "Tu cuota de Gemini se ha agotado. Revisa tu panel de Google AI Studio.",
        );
      }
      if (error.message.includes("API_KEY_INVALID")) {
        throw new Error("Tu API Key de Gemini parece no ser válida.");
      }

      throw error;
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
