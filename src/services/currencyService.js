// backend/services/currencyService.js
const axios = require('axios');

class CurrencyService {
  constructor() {
    this.rates = null;
    this.lastUpdate = null;
    // Cache de 12 horas para no exceder límites de APIs gratuitas
    this.CACHE_DURATION = 12 * 60 * 60 * 1000; 
  }

  async getLatestRates() {
    const now = new Date();

    if (this.rates && (now - this.lastUpdate < this.CACHE_DURATION)) {
      return this.rates;
    }

    try {
      const response = await axios.get('https://open.er-api.com/v6/latest/USD');
      this.rates = response.data.rates;
      this.lastUpdate = now;
      return this.rates;
    } catch (error) {
      console.error("Error obteniendo divisas:", error.message);
      // Retornamos un fallback por si falla la API externa
      return this.rates || { "USD": 1, "EUR": 0.92, "GBP": 0.78 };
    }
  }
}

module.exports = new CurrencyService();