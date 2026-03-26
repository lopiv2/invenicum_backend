// backend/services/currencyService.js
const axios = require('axios');
const { Temporal } = require('@js-temporal/polyfill');

class CurrencyService {
  constructor() {
    this.rates = null;
    this.lastUpdate = null;
    // Cache de 12 horas
    this.CACHE_DURATION_HOURS = 12; 
  }

  async getLatestRates() {
    const now = Temporal.Now.zonedDateTimeISO();
    if (this.rates && this.lastUpdate) {
      const durationSinceUpdate = now.since(this.lastUpdate);
      
      if (durationSinceUpdate.hours < this.CACHE_DURATION_HOURS) {
        return this.rates;
      }
    }

    try {
      const response = await axios.get('https://open.er-api.com/v6/latest/USD');
      this.rates = response.data.rates;
      this.lastUpdate = now;
      return this.rates;
    } catch (error) {
      // También aplicamos la regla de interpolación aquí por seguridad
      console.error(`Error obteniendo divisas: ${error.message}`);
      return this.rates || { "USD": 1, "EUR": 0.92, "GBP": 0.78 };
    }
  }
}

module.exports = new CurrencyService();