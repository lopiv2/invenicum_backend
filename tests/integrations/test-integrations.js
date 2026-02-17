const path = require('path');
// 1. CARGAR ENTORNO
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// IMPORTANTE: Importamos el prisma que tiene la extensión configurada
const prisma = require("../../src/middleware/prisma");
const IntegrationDTO = require('../../src/models/integrationModel');

async function runIntegrationTest() {
    console.log("🧪 Iniciando test de Integraciones (Modo Extensión Prisma)...\n");

    const TEST_USER_ID = 1; 
    const TEST_TYPE = "gemini_test";
    const MOCK_CONFIG_OBJECT = {
        apiKey: "AIza_TEST_SECRET_KEY_2026",
        model: "gemini-3-flash"
    };

    try {
        // --- PASO 1: GUARDADO ---
        console.log("💾 Paso 1: Guardando datos (Prisma debería cifrar automáticamente)...");
        
        // Enviamos el JSON como string. La extensión en prisma.js detectará 
        // config.data y aplicará encrypt() antes de tocar la MariaDB.
        const savedData = await prisma.userIntegration.upsert({
            where: {
                userId_type: { userId: TEST_USER_ID, type: TEST_TYPE }
            },
            update: {
                config: { data: JSON.stringify(MOCK_CONFIG_OBJECT) },
                isActive: true
            },
            create: {
                userId: TEST_USER_ID,
                type: TEST_TYPE,
                config: { data: JSON.stringify(MOCK_CONFIG_OBJECT) },
                isActive: true
            }
        });
        console.log("   [OK] Operación Upsert completada.");

        // --- PASO 2: RECUPERACIÓN ---
        console.log("🔍 Paso 2: Recuperando registro (Prisma debería descifrar automáticamente)...");
        const record = await prisma.userIntegration.findUnique({
            where: { userId_type: { userId: TEST_USER_ID, type: TEST_TYPE } }
        });

        if (!record || !record.config.data) {
            throw new Error("No se encontró el registro o el campo data está vacío.");
        }

        // --- PASO 3: VALIDACIÓN DE DESCIFRADO ---
        // Si la extensión funciona, record.config.data YA ES el JSON original, no el hash.
        console.log("🔓 Paso 3: Verificando datos descifrados por la extensión...");
        const finalConfig = JSON.parse(record.config.data);
        console.log("   [OK] Datos recuperados:", finalConfig);

        // --- PASO 4: MAPEADO A DTO ---
        console.log("📦 Paso 4: Mapeando a IntegrationDTO...");
        // Reasignamos para que el DTO reciba el objeto parseado
        record.config = finalConfig; 
        const dto = new IntegrationDTO(record);
        
        console.log("\n✅ RESULTADO FINAL PARA FLUTTER:");
        console.log(JSON.stringify(dto, null, 2));

        if (dto.config.apiKey === MOCK_CONFIG_OBJECT.apiKey) {
            console.log("\n✨ TEST EXITOSO: La extensión de Prisma cifra y descifra correctamente.");
        } else {
            throw new Error("La API Key no coincide. ¡Revisa la extensión en prisma.js!");
        }

    } catch (error) {
        console.error("\n❌ ERROR EN EL TEST:");
        console.error(error.message);
    } finally {
        await prisma.$disconnect();
    }
}

runIntegrationTest();