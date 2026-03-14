  const axios = require("axios");

  async function getBase64FromUrl(imageUrl) {
    if (!imageUrl || !imageUrl.startsWith("http")) return imageUrl;

    try {
      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 5000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const contentType = response.headers["content-type"] || "image/jpeg";
      const base64 = Buffer.from(response.data, "binary").toString("base64");
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      console.error(
        "⚠️ No se pudo convertir la imagen a Base64:",
        error.message,
      );
      return imageUrl; // Si falla, devolvemos la URL original como respaldo
    }
  }

  module.exports = { getBase64FromUrl};