const axios = require('axios');
const prisma = require("../middleware/prisma");
const IntegrationDTO = require('../models/integrationModel');
const UpcMarketDataDTO = require('../models/upcMarketDataModel');
const integrationService = require('../services/integrationsService');


class UpcService {
  /**
   * Obtiene datos de mercado y extrae el valor de precio sugerido
   */
  async getMarketDataByBarcode(userId, barcode) {
    if (!barcode) return null;

    // 1. Intentamos obtener la configuración (si existe y está activa)
    const upcConfig = await integrationService.getUpcApiKey(userId);
    
    // 2. Definir configuración dinámica según el plan
    const isPro = !!(upcConfig && upcConfig.apiKey);
    const baseURL = isPro 
      ? 'https://api.upcitemdb.com/prod/v1/lookup' // Plan PRO/Comercial
      : 'https://api.upcitemdb.com/prod/trial/lookup'; // Plan FREE

    const headers = {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate', // Activamos compresión como pide la doc
    };

    if (isPro) {
      headers['user_key'] = upcConfig.apiKey;
      headers['key_type'] = 'free'; // O 'commercial' según tu integración
    }

    try {
      const response = await axios.get(baseURL, {
        params: { upc: barcode },
        headers: headers
      });

      // La respuesta de UPCitemdb viene en response.data
      const data = response.data;
      if (!data.items || data.items.length === 0) return null;

      const item = data.items[0];
      return {
        title: item.title,
        suggestedPrice: item.highest_recorded_price || item.lowest_recorded_price || 0,
        currency: 'USD',
        brand: item.brand,
        images: item.images || []
      };

    } catch (error) {
      console.error('Error en UPC Service:', error.response?.data || error.message);
      return null;
    }
  }
}

module.exports = new UpcService();