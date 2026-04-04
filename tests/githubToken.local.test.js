/**
 * Test LOCAL (sin depender de la red)
 * Simula el flujo JWT de forma local para validar la lógica
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

console.log('\n');
console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║     TESTS LOCAL: JWT GITHUB TOKEN (sin red)               ║');
console.log('╚═══════════════════════════════════════════════════════════╝');

// 1. Generar par de claves
console.log('\n📋 TEST 1: Generar claves RSA');
console.log('━'.repeat(50));

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

console.log('✅ Claves generadas correctamente');
console.log(`🔐 Clave privada: ${privateKey.length} caracteres`);
console.log(`🔑 Clave pública: ${publicKey.length} caracteres`);

// 2. Generar JWT con token de GitHub simulado
console.log('\n📋 TEST 2: Generar JWT con token simulado');
console.log('━'.repeat(50));

const mockGithubToken = 'github_pat_11AAABBBCCCDDDEEEFFF1234567890GHIJK';
const payload = {
  token: mockGithubToken,
  type: 'github-token',
  iat: Math.floor(Date.now() / 1000),
};

const generatedJwt = jwt.sign(payload, privateKey, {
  algorithm: 'RS256',
  expiresIn: '10m',
});

console.log('✅ JWT generado correctamente');
console.log(`📏 Longitud: ${generatedJwt.length} caracteres`);
console.log(`🔐 JWT (primeros 50 chars): ${generatedJwt.substring(0, 50)}...`);

// 3. Validar JWT
console.log('\n📋 TEST 3: Validar JWT con clave pública');
console.log('━'.repeat(50));

try {
  const decoded = jwt.verify(generatedJwt, publicKey, {
    algorithms: ['RS256'],
  });

  console.log('✅ JWT validado exitosamente');
  console.log(`🔐 Tipo: ${decoded.type}`);
  console.log(`📅 Emitido hace: ${Math.floor((Date.now() / 1000) - decoded.iat)} segundos`);
} catch (error) {
  console.error(`❌ Error validando JWT:`, error.message);
  process.exit(1);
}

// 4. Extraer token de GitHub
console.log('\n📋 TEST 4: Extraer token de GitHub del JWT');
console.log('━'.repeat(50));

try {
  const decoded = jwt.verify(generatedJwt, publicKey, {
    algorithms: ['RS256'],
  });

  if (decoded.type !== 'github-token') {
    throw new Error('JWT type es incorrecto');
  }

  const extractedToken = decoded.token;

  console.log('✅ Token extraído correctamente');
  console.log(`🔑 Token: ${extractedToken}`);
  console.log(`🔐 Coincide con original: ${extractedToken === mockGithubToken ? 'SI ✓' : 'NO ✗'}`);

  if (extractedToken !== mockGithubToken) {
    throw new Error('Token no coincide');
  }
} catch (error) {
  console.error(`❌ Error:`, error.message);
  process.exit(1);
}

// 5. Intentar validar JWT modificado (debe fallar)
console.log('\n📋 TEST 5: Validar que JWT modificado falla');
console.log('━'.repeat(50));

const manipulatedJwt = generatedJwt.slice(0, -10) + '0000000000';

try {
  jwt.verify(manipulatedJwt, publicKey, {
    algorithms: ['RS256'],
  });
  console.error('❌ ERROR: JWT manipulado fue validado (no debería)');
  process.exit(1);
} catch (error) {
  if (error.name === 'JsonWebTokenError') {
    console.log('✅ JWT manipulado rechazado correctamente');
    console.log(`📌 Error esperado: ${error.message}`);
  } else {
    throw error;
  }
}

// 6. Intentar validar JWT expirado (debe fallar)
console.log('\n📋 TEST 6: Validar que JWT expirado falla');
console.log('━'.repeat(50));

const expiredJwt = jwt.sign(payload, privateKey, {
  algorithm: 'RS256',
  expiresIn: '0s', // Expira inmediatamente
});

// Esperar un bit para que expire
setTimeout(() => {
  try {
    jwt.verify(expiredJwt, publicKey, {
      algorithms: ['RS256'],
    });
    console.error('❌ ERROR: JWT expirado fue validado (no debería)');
    process.exit(1);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      console.log('✅ JWT expirado rechazado correctamente');
      console.log(`📌 Error esperado: Token expirado en ${error.expiredAt}`);
    } else {
      throw error;
    }
  }

  // 7. Resumen final
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   ✅ TODOS LOS TESTS LOCALES PASARON CORRECTAMENTE       ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  console.log('\n📋 RESUMEN DE VALIDACIONES:');
  console.log('  ✓ Claves RSA generadas');
  console.log('  ✓ JWT firmado y válido');
  console.log('  ✓ Token de GitHub extraído correctamente');
  console.log('  ✓ JWT modificado rechazado (no manipulable)');
  console.log('  ✓ JWT expirado rechazado (expiration funciona)');

  console.log('\n✨ La seguridad JWT está implementada correctamente\n');
  process.exit(0);
}, 100);
