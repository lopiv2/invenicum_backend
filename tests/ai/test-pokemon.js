const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const {
  getBase64FromUrl,
  generateUniversalPrompt,
} = require("../../src/middleware/utils");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

// Importaciones de tu infraestructura
const prisma = require("../../src/middleware/prisma");
const { decrypt } = require("../../src/middleware/cryptoUtils");

/// EJECUCION - node tests\ai\test-pokemon.js

async function runPokeApiTest() {
  console.log(
    "🧪 Iniciando Test E2E: PokeAPI + Gemini (Usando Función Universal)\n"
  );

  const TEST_USER_ID = 1;
  const POKEMON_NAME = "pikachu";

  try {
    // 1. Recuperar y Desencriptar API Key de Gemini
    const userIntegration = await prisma.userIntegration.findUnique({
      where: { userId_type: { userId: TEST_USER_ID, type: "gemini" } },
    });

    if (!userIntegration) throw new Error("No hay config de Gemini en la DB.");

    const decryptedData = JSON.parse(decrypt(userIntegration.config.data));
    
    // Ajustamos los nombres de variables para que coincidan con la llamada a la IA
    const apiKeyToUse = decryptedData.apiKey;
    const modelToUse = decryptedData.model || "gemini-1.5-flash"; 

    // 2. Obtener datos de PokeAPI
    console.log(`📡 Consultando PokeAPI para: ${POKEMON_NAME}...`);
    const { data } = await axios.get(
      `https://pokeapi.co/api/v2/pokemon/${POKEMON_NAME}`
    );

    const rawDataForIA = JSON.stringify({
      name: data.name,
      abilities: data.abilities,
      types: data.types,
      stats: data.stats,
      image: data.sprites.other["official-artwork"].front_default,
      height: data.height,
      weight: data.weight,
    });

    // 3. Llamada a Gemini usando tu Función Universal
    console.log("🧠 Generando prompt y llamando a la IA...");
    
    const promptText = generateUniversalPrompt(
      "un Pokémon de PokeAPI",
      rawDataForIA
    );

    // Usamos la variable apiKeyToUse que extrajimos de la DB
    const dynamicClient = new GoogleGenAI({ apiKey: apiKeyToUse });

    const response = await dynamicClient.models.generateContent({
      model: modelToUse,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: promptText,
            },
          ],
        },
      ],
      config: {
        generationConfig: {
          responseMimeType: "application/json",
        },
      },
    });

    // Extraemos el texto según tu estructura de candidates
    let rawText = response.candidates[0].content.parts[0].text;

    // --- 4. LIMPIEZA Y PARSEO ---
    const cleanJsonString = rawText
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    try {
      const finalResult = JSON.parse(cleanJsonString);
      console.log("\n✅ RESULTADO DEL TEST (Formato Universal):");
      console.log(JSON.stringify(finalResult, null, 2));
      
      // Opcional: Probar el Base64 si quieres ver si la imagen funciona
      if (finalResult.images && finalResult.images[0].url) {
          console.log("\n📸 Imagen detectada:", finalResult.images[0].url);
      }

    } catch (parseError) {
      console.error("❌ Error al parsear el JSON de la IA:", parseError.message);
      console.log("Contenido raw que falló:", rawText);
    }
    
  } catch (error) {
    console.error("\n❌ ERROR GENERAL EN EL TEST:");
    console.error(error.message);
  } finally {
    // Cerramos la conexión a la DB para que el proceso termine
    await prisma.$disconnect();
  }
}

runPokeApiTest();