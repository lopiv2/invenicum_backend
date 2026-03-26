const axios = require("axios");
const integrationService = require("../services/integrationsService");

class UpcService {
  /**
   * Obtiene datos de mercado y extrae el valor de precio sugerido
   */

  async getMarketDataByBarcode(userId, barcode) {
    if (!barcode) return null;

    // 1. Obtener configuración de la API Key
    const upcConfig = await integrationService.getUpcApiKey(userId);
    const isPro = !!(upcConfig && upcConfig.apiKey);

    const baseURL = isPro
      ? "https://api.upcitemdb.com/prod/v1/lookup"
      : "https://api.upcitemdb.com/prod/trial/lookup";

    const headers = {
      Accept: "application/json",
      user_key: isPro ? upcConfig.apiKey : undefined,
      key_type: isPro ? "free" : undefined, // Ajustar según el tipo de cuenta
    };

    try {
      const response = await axios.get(baseURL, {
        params: { upc: barcode },
        headers: headers,
      });

      const data = response.data;
      if (!data.items || data.items.length === 0) return null;

      const item = data.items[0];

      // --- CÁLCULO DEL PRECIO MEDIO BASADO EN UPC ---
      const high = item.highest_recorded_price || 0;
      const low = item.lowest_recorded_price || 0;

      // Calculamos la media entre el máximo y el mínimo histórico registrado por UPC
      let averagePrice = 0;
      if (high > 0 && low > 0) {
        averagePrice = (high + low) / 2;
      } else {
        // Si uno de los dos es 0, usamos el que esté disponible
        averagePrice = high || low || 0;
      }

      return {
        title: item.title,
        suggestedPrice: averagePrice, // Media aritmética de los registros históricos
        marketRangeLow: low, // Mínimo histórico para la UI
        marketRangeHigh: high, // Máximo histórico para la UI
        currency: "USD",
        brand: item.brand,
        images: item.images || [],
      };
    } catch (error) {
      console.error(
        "Error en Servicio UPC:",
        error.response?.data || error.message,
      );
      return null;
    }
  }
}

module.exports = new UpcService();
