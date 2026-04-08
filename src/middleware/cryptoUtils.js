const crypto = require("crypto");
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const ALGORITHM = "aes-256-cbc";
// Ensure que the KEY tenga 32 bytes exactos
const KEY_STRING =
  process.env.ENCRYPTION_KEY || "tu_clave_de_32_chars_exactos_012";
const KEY = Buffer.from(KEY_STRING).slice(0, 32);
const IV_LENGTH = 16;

/**
 * Genera a hash seguro using the método nativo scrypt de Node.js
 */
async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await scrypt(password, salt, 64);
    return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedPassword) {
    const [salt, key] = storedPassword.split(':');
    const derivedKey = await scrypt(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey);
}

const encrypt = (text) => {
  // 🚩 Change: Eliminamos "text.includes(':')"
  if (!text) return text;

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

    let encrypted = cipher.update(text, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return iv.toString("hex") + ":" + encrypted.toString("hex");
  } catch (e) {
    console.error("❌ Error en cifrado:", e.message);
    return text;
  }
};

const decrypt = (text) => {
  // Aquí sí mantenemos the check de ':', porque nuestro formato encrypted es 'iv:data'
  if (!text || typeof text !== "string" || !text.includes(":")) return text;

  try {
    const textParts = text.split(":");
    const iv = Buffer.from(textParts.shift(), "hex");
    const encryptedText = Buffer.from(textParts.join(":"), "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString("utf8");
  } catch (e) {
    console.error("❌ Error en descifrado:", e.message);
    return text;
  }
};

module.exports = { encrypt, decrypt, hashPassword, verifyPassword };
