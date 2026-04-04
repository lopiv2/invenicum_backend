// lib/jwtValidator.js
const jwt = require('jsonwebtoken');
const axios = require('axios');

let cachedPublicKey = null;
let cacheTimestamp = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Obtiene la clave pública del proxy (cacheada por 24h)
 */
async function getProxyPublicKey() {
  const now = Date.now();
  
  if (cachedPublicKey && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedPublicKey;
  }

  try {
    const response = await axios.get('https://api.invenicum.com/api/jwt-public-key', {
      timeout: 5000,
    });

    cachedPublicKey = response.data?.publicKey;
    cacheTimestamp = now;

    if (!cachedPublicKey) {
      throw new Error('Public key not found in response');
    }

    return cachedPublicKey;
  } catch (error) {
    throw new Error(`Failed to fetch proxy public key: ${error.message}`);
  }
}

/**
 * Verifica y desencripta un JWT devuelto por el proxy
 */
async function verifyProxyJwt(token) {
  try {
    const publicKey = await getProxyPublicKey();

    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
    });

    if (decoded.type !== 'github-token') {
      throw new Error('Invalid JWT type');
    }

    return decoded.token;
  } catch (error) {
    throw new Error(`JWT verification failed: ${error.message}`);
  }
}

module.exports = { verifyProxyJwt, getProxyPublicKey };
