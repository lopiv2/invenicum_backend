const crypto = require("crypto");
const ALGORITHM = "aes-256-cbc";
// Aseguramos que la KEY tenga 32 bytes exactos
const KEY_STRING =
  process.env.ENCRYPTION_KEY || "tu_clave_de_32_chars_exactos_012";
const KEY = Buffer.from(KEY_STRING).slice(0, 32);
const IV_LENGTH = 16;

const encrypt = (text) => {
  // 🚩 CAMBIO: Eliminamos "text.includes(':')"
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
  // Aquí sí mantenemos el check de ':', porque nuestro formato cifrado es 'iv:data'
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

module.exports = { encrypt, decrypt };
