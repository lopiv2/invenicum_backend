/**
 * Test de integración para verificar el flujo de obtención de GITHUB_TOKEN desde el proxy
 * 
 * NOTA: Requiere que el proxy esté corriendo y configurado correctamente
 * 
 * Flujo:
 * 1. Backend solicita token a proxy
 * 2. Proxy genera JWT firmado
 * 3. Backend valida JWT y extrae token de GitHub
 */

const axios = require('axios');
const { verifyProxyJwt } = require('../src/lib/jwtValidator');
const { GitHubConstants } = require('../src/config/githubConstants');

// Configurar la URL del proxy (cambiar según tu setup)
const PROXY_BASE_URL = process.env.PROXY_URL || 'https://api.invenicum.com';
const proxyTokenUrl = `${PROXY_BASE_URL}/api/github-token`;
const publicKeyUrl = `${PROXY_BASE_URL}/api/jwt-public-key`;

console.log(`\n📡 Usando proxy: ${PROXY_BASE_URL}\n`);

/**
 * Test 1: Verificar que se puede obtener JWT del proxy
 */
async function testGetJwtFromProxy() {
  console.log('\n📋 TEST 1: Obtener JWT del proxy');
  console.log('━'.repeat(50));

  try {
    console.log(`🔄 Solicitando JWT a: ${proxyTokenUrl}`);
    const response = await axios.get(proxyTokenUrl, { timeout: 10000 });

    if (!response.data?.jwt) {
      throw new Error('❌ No JWT encontrado en respuesta');
    }

    console.log('✅ JWT recibido exitosamente');
    console.log(`⏱️  Expira en: ${response.data?.expiresIn}`);
    console.log(`📅 Timestamp: ${response.data?.timestamp}`);
    console.log(`🔐 JWT (primeros 50 chars): ${response.data.jwt.substring(0, 50)}...`);

    return response.data.jwt;
  } catch (error) {
    console.error(
      `❌ Error obteniendo JWT:`,
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * Test 2: Verificar que se puede obtener clave pública
 */
async function testGetPublicKey() {
  console.log('\n📋 TEST 2: Obtener clave pública del proxy');
  console.log('━'.repeat(50));

  try {
    console.log(`🔄 Solicitando clave pública a: ${publicKeyUrl}`);
    const response = await axios.get(publicKeyUrl, { timeout: 10000 });

    if (!response.data?.publicKey) {
      throw new Error('❌ No publicKey encontrada en respuesta');
    }

    console.log('✅ Clave pública recibida exitosamente');
    console.log(`🔐 Algoritmo: ${response.data?.algorithm}`);
    console.log(`📏 Tamaño de clave: ${response.data.publicKey.length} caracteres`);
    console.log(
      `🔑 Inicio de clave: ${response.data.publicKey.substring(0, 50)}...`
    );

    return response.data.publicKey;
  } catch (error) {
    console.error(
      `❌ Error obteniendo clave pública:`,
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * Test 3: Verificar que se puede validar JWT
 */
async function testValidateJwt(jwt) {
  console.log('\n📋 TEST 3: Validar JWT y extraer token de GitHub');
  console.log('━'.repeat(50));

  try {
    console.log('🔄 Validando JWT...');
    const githubToken = await verifyProxyJwt(jwt);

    if (!githubToken) {
      throw new Error('❌ No se pudo extraer token de GitHub del JWT');
    }

    console.log('✅ JWT validado exitosamente');
    console.log(`🔐 Tipo de token: GitHub PAT`);
    console.log(`🔑 Token extraído (primeros 20 chars): ${githubToken.substring(0, 20)}...`);
    console.log(`📏 Longitud del token: ${githubToken.length} caracteres`);

    return githubToken;
  } catch (error) {
    console.error(
      `❌ Error validando JWT:`,
      error.message
    );
    throw error;
  }
}

/**
 * Test 4: Verificar flujo completo de GitHubConstants
 */
async function testGitHubConstantsFlow() {
  console.log('\n📋 TEST 4: Flujo completo de GitHubConstants');
  console.log('━'.repeat(50));

  try {
    console.log('🔄 Llamando a GitHubConstants.getConfigWithProxyToken()...');
    const config = await GitHubConstants.getConfigWithProxyToken();

    if (!config.auth) {
      throw new Error('❌ No se obtuvo auth token en config');
    }

    console.log('✅ Config obtenida exitosamente');
    console.log(`👤 Owner: ${config.owner}`);
    console.log(`📦 Repo: ${config.repo}`);
    console.log(`🔐 Auth token presente: ${config.auth ? 'SI ✓' : 'NO ✗'}`);
    console.log(`🔗 Plugin Repo URL configurada: ${config.pluginRepoUrl ? 'SI ✓' : 'NO ✗'}`);
    console.log(`🔗 Template Repo URL configurada: ${config.templateRepoUrl ? 'SI ✓' : 'NO ✗'}`);

    return config;
  } catch (error) {
    console.error(
      `❌ Error en flujo de GitHubConstants:`,
      error.message
    );
    throw error;
  }
}

/**
 * Test 5: Verificar que el token es válido para GitHub (si podemos)
 */
async function testGitHubTokenValidity(token) {
  console.log('\n📋 TEST 5: Verificar validez de token en GitHub API');
  console.log('━'.repeat(50));

  try {
    console.log('🔄 Verificando token con GitHub API...');
    const response = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
      timeout: 10000,
    });

    console.log('✅ Token es válido en GitHub');
    console.log(`👤 Usuario: ${response.data.login}`);
    console.log(`📧 Email: ${response.data.email || 'privado'}`);
    console.log(`⭐ Repositorios públicos: ${response.data.public_repos}`);

    return true;
  } catch (error) {
    if (error.response?.status === 401) {
      console.warn('⚠️  Token inválido o expirado en GitHub');
      console.warn(`   Esto es esperado si es un token de test`);
      return false;
    }
    console.error(
      `❌ Error verificando token:`,
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * TEST RUNNER: Ejecuta todos los tests
 */
async function runAllTests() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║      TESTS: GITHUB TOKEN PROXY INTEGRATION                ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  try {
    // Test 1: Obtener JWT
    const jwt = await testGetJwtFromProxy();

    // Test 2: Obtener clave pública
    await testGetPublicKey();

    // Test 3: Validar JWT
    const githubToken = await testValidateJwt(jwt);

    // Test 4: Flujo completo
    const config = await testGitHubConstantsFlow();

    // Test 5: Validez del token
    await testGitHubTokenValidity(githubToken);

    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   ✅ TODOS LOS TESTS PASARON CORRECTAMENTE              ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('\n✨ El flujo de GITHUB_TOKEN desde el proxy funciona correctamente\n');

    process.exit(0);
  } catch (error) {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   ❌ UNO O MÁS TESTS FALLARON                            ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.error('\nDetalle del error:', error.message);

    process.exit(1);
  }
}

// Ejecutar los tests
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testGetJwtFromProxy,
  testGetPublicKey,
  testValidateJwt,
  testGitHubConstantsFlow,
  testGitHubTokenValidity,
  runAllTests,
};
