const axios = require("axios");
const integrationService = require("../services/integrationsService");

class UpcService {
  /**
   * Gets market data and extracts the suggested price value
   */

  async getMarketDataByBarcode(userId, barcode) {
    if (!barcode) return null;

    // 1. Get API Key configuration
    const upcConfig = await integrationService.getUpcApiKey(userId);
    const isPro = !!(upcConfig && upcConfig.apiKey);

    const baseURL = isPro
      ? "https://api.upcitemdb.com/prod/v1/lookup"
      : "https://api.upcitemdb.com/prod/trial/lookup";

    const headers = {
      Accept: "application/json",
      user_key: isPro ? upcConfig.apiKey : undefined,
      key_type: isPro ? "free" : undefined, // Adjust according to account type
    };

    try {
      const response = await axios.get(baseURL, {
        params: { upc: barcode },
        headers: headers,
      });

      const data = response.data;
      if (!data.items || data.items.length === 0) return null;

      const item = data.items[0];

      // --- CALCULATION OF THE AVERAGE PRICE BASED ON UPC ---
      const high = item.highest_recorded_price || 0;
      const low = item.lowest_recorded_price || 0;

      // Calculate the average between the highest and lowest historical price recorded by UPC
      let averagePrice = 0;
      if (high > 0 && low > 0) {
        averagePrice = (high + low) / 2;
      } else {
        // If one of the two is 0, use the one that is available
        averagePrice = high || low || 0;
      }

      return {
        title: item.title,
        suggestedPrice: averagePrice, // Arithmetic mean of historical records
        marketRangeLow: low, // Historical minimum for the UI
        marketRangeHigh: high, // Historical maximum for the UI
        currency: "USD",
        brand: item.brand,
        images: item.images || [],
      };
    } catch (error) {
      console.error(
        "Error in UPC Service:",
        error.response?.data || error.message,
      );
      return null;
    }
  }
}

module.exports = new UpcService();
