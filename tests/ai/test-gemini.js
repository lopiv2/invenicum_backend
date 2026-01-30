const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenAI } = require('@google/genai');

// 1. CARGAR VARIABLES DE ENTORNO (Debe ir antes de usar process.env)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

async function runStandaloneTest() {
    const apiKey = process.env.GEMINI_API_KEY;

    // VALIDACIÓN INICIAL
    if (!apiKey) {
        console.error("❌ Error: No se encontró la API Key en process.env. Revisa el archivo .env");
        return;
    }

    try {
        console.log("🛠️ Iniciando test autónomo con Gemini 3...");
        
        // 2. CONFIGURACIÓN DEL CLIENTE
        const client = new GoogleGenAI({ apiKey });
        
        const url = "https://www.apple.com/es/iphone-15/specs/";
        const fields = ["Modelo", "Procesador", "Cámara principal", "Peso"];

        // 3. SCRAPING INTEGRADO
        console.log(`📡 Obteniendo datos de: ${url}...`);
        const { data: html } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000
        });

        const $ = cheerio.load(html);
        $('script, style, nav, footer, header, aside, noscript').remove();
        const cleanText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 20000);

        console.log(`✨ Texto limpio (${cleanText.length} chars). Enviando a Gemini 3...`);

        // 4. LLAMADA A LA IA
        const response = await client.models.generateContent({
            model: 'gemini-3-flash-preview', // O 'gemini-3-flash'
            contents: [{
                role: 'user',
                parts: [{
                    text: `Analiza este texto: "${cleanText}". Extrae estos campos: ${fields.join(', ')}. Responde solo JSON.`
                }]
            }],
            config: {
                generationConfig: {
                    responseMimeType: 'application/json'
                }
            }
        });

        // 5. PROCESAR RESULTADO
        let resultText = response.candidates[0].content.parts[0].text;
        // Limpieza de Markdown: Eliminamos los bloques ```json y ``` si existen
        const cleanJsonString = resultText
            .replace(/```json/g, '') // Quita el inicio del bloque
            .replace(/```/g, '')     // Quita el cierre del bloque
            .trim();                 // Quita espacios sobrantes

        try {
            const finalJson = JSON.parse(cleanJsonString);
            console.log("✅ RESULTADO EXITOSO:");
            console.log(JSON.stringify(finalJson, null, 2));
        } catch (parseError) {
            console.error("❌ Error al parsear JSON. Texto recibido:");
            console.log(resultText); // Esto te permite ver qué devolvió exactamente la IA
            throw new Error("La respuesta de la IA no tiene un formato JSON válido.");
        }

    } catch (error) {
        console.error("❌ Fallo en el proceso:");
        if (error.status === 429) {
            console.error("Límite de velocidad (429). Espera 60 segundos.");
        } else {
            console.error(error.message);
        }
    }
}

// Ejecutar el test
runStandaloneTest();