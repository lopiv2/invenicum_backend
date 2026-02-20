const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const axios = require("axios");
const cheerio = require("cheerio");
const { GoogleGenAI } = require("@google/genai");

// Importamos tus herramientas de base de datos y crypto
const prisma = require("../../src/middleware/prisma");
const { decrypt } = require("../../src/middleware/cryptoUtils"); // Importante: tu función de descifrado

async function runFullIntegrationTest() {
  console.log(
    "🧪 Iniciando test: Recuperación -> Desencriptado Manual -> Extracción IA...\n",
  );

  const TEST_USER_ID = 1;
  const URL_TO_TEST = "https://www.apple.com/es/iphone-15/specs/";

  try {
    // --- PASO 1: RECUPERAR DE LA DB ---
    console.log(`🔍 Paso 1: Buscando integración en MariaDB...`);
    const userIntegration = await prisma.userIntegration.findUnique({
      where: { userId_type: { userId: TEST_USER_ID, type: "gemini" } },
    });

    if (!userIntegration || !userIntegration.config?.data) {
      throw new Error("No existe configuración guardada para este usuario.");
    }

    // --- PASO 2: DESENCRIPTADO MANUAL (Igual que en tu AIService) ---
    console.log("🔓 Paso 2: Desencriptando datos manualmente...");
    let apiKeyToUse;
    let modelToUse = "gemini-3-flash-preview";

    try {
      // Desencriptamos el string que viene de config.data
      const decryptedString = decrypt(userIntegration.config.data);
      const configObj = JSON.parse(decryptedString);

      apiKeyToUse = configObj.apiKey;
      if (configObj.model) modelToUse = configObj.model;
    } catch (e) {
      throw new Error(
        "Fallo al desencriptar: La clave ENCRYPTION_KEY no coincide o los datos están corruptos.",
      );
    }

    if (!apiKeyToUse)
      throw new Error("La API Key no está presente en la configuración.");
    console.log(`   [OK] API Key lista para usar.`);

    // --- PASO 3: SCRAPING ---
    console.log(`📡 Paso 3: Scrapeando web...`);
    const { data: html } = await axios.get(URL_TO_TEST, {
      headers: { "User-Agent": "Mozilla/5.0..." },
      timeout: 10000,
    });
    const $ = cheerio.load(html);
    const ogImage = $('meta[property="og:image"]').attr("content");
    if (ogImage) {
      // CASO 1: Es una ruta relativa (ej: "/img/foto.jpg")
      if (ogImage.startsWith("/")) {
        ogImage = `${baseUrl.origin}${ogImage}`;
      }
      // CASO 2: No tiene protocolo (ej: "www.apple.com/foto.jpg" o "apple.com/foto.jpg")
      else if (!ogImage.startsWith("http")) {
        // Si empieza por 'www', le ponemos el https://
        // Si es una ruta relativa sin barra (ej: "media/foto.jpg"), la unimos al origen
        ogImage =
          ogImage.includes("www.") || ogImage.includes(".")
            ? `https://${ogImage.replace(/^\/\//, "")}` // Limpia dobles barras si existen
            : `${baseUrl.origin}/${ogImage}`;
      }
    }
    $("script, style").remove();
    const cleanText = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 20000);

    // --- PASO 4: LLAMADA A IA ---
    console.log(`🧠 Paso 4: Llamando a Gemini con clave del usuario...`);
    const dynamicClient = new GoogleGenAI({ apiKey: apiKeyToUse });
    const response = await dynamicClient.models.generateContent({
      model: modelToUse,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Analiza: "${cleanText}". Extrae JSON: name, description, imageUrl (usa: ${ogImage})`,
            },
          ],
        },
      ],
      config: { generationConfig: { responseMimeType: "application/json" } },
    });
    let rawText = response.candidates[0].content.parts[0].text;

    // 1. Limpieza de bloques Markdown (el error que te dio)
    const cleanJsonString = rawText
      .replace(/^```json\s*/i, "") // Quita el inicio ```json
      .replace(/```\s*$/, "") // Quita el cierre ```
      .trim();

    const result = JSON.parse(cleanJsonString);
    console.log("\n✅ RESULTADO DEL TEST:");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("\n❌ ERROR EN EL TEST:");
    console.error(error.message);
  } finally {
    await prisma.$disconnect();
  }
}

runFullIntegrationTest();
