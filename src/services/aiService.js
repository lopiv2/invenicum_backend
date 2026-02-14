const axios = require("axios");
const cheerio = require("cheerio");
const { GoogleGenAI } = require("@google/genai");
const prisma = require("../middleware/prisma");

class AIService {
  constructor() {
    this.client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async processChatConversation(userInput, context = {}) {
    const userId = parseInt(context.userId);
    if (isNaN(userId)) {
      throw new Error(
        "Se requiere userId para obtener contexto de la base de datos",
      );
    }
    try {
      // 1. OBTENER CONTEXTO DE LA BBDD CON PRISMA
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

      // 2. CONFIGURAR EL PROMPT CON LA INFORMACIÓN DE PRISMA
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

      // 3. LLAMADA A GEMINI (Sintaxis que ya te funciona)
      const response = await this.client.models.generateContent({
        model: process.env.GEMINI_AI_MODEL || "gemini-3-flash-preview",
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

      // 4. LÓGICA DE EXTRACCIÓN (Tu función de scraping)
      if (result.action === "PRODUCT_EXTRACT" && result.data.url) {
        const extractedData = await this.extractInfoFromUrl(result.data.url, [
          "Nombre",
          "Precio",
          "Descripción",
        ]);
        result.data = extractedData;
        result.answer =
          "He analizado el enlace y extraído los datos. ¿Quieres guardarlos?";
      }

      return result;
    } catch (error) {
      console.error("❌ Error en AIService (Prisma/Gemini):", error.message);
      return {
        answer:
          "Lo siento, tuve un problema al consultar tus datos. Inténtalo de nuevo.",
        action: null,
        data: {},
      };
    }
  }

  async extractInfoFromUrl(url, fields) {
    try {
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

      const response = await this.client.models.generateContent({
        model: process.env.GEMINI_AI_MODEL || "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Analiza: "${cleanText}". 
        Extrae exactamente estos campos: ${fields.join(", ")}.
        IMPORTANTE: Usa los nombres de los campos exactamente como se te proporcionan (case-sensitive).
        Responde solo JSON.`,
              },
            ],
          },
        ],
        config: { generationConfig: { responseMimeType: "application/json" } },
      });

      const rawText = response.candidates[0].content.parts[0].text;
      const cleanJson = rawText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error("❌ Error en extractInfoFromUrl:", error.message);
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
