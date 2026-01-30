const axios = require("axios");
const cheerio = require("cheerio");
const { GoogleGenAI } = require("@google/genai");

class AIService {
  constructor() {
    this.client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async extractInfoFromUrl(url, fields) {
    try {
      const { data: html } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 15000, // Un poco más de tiempo para webs pesadas
      });

      const $ = cheerio.load(html);
      $("script, style, nav, footer, header, aside").remove();
      const cleanText = $("body")
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 25000);

      const response = await this.client.models.generateContent({
        model: "gemini-3-flash-preview",
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
      console.error("❌ Error en AIService:", error.message);
      throw error;
    }
  }
}

module.exports = new AIService();
