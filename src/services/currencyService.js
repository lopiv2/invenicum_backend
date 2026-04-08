// backend/services/currencyService.js
const axios = require('axios');
const { Temporal } = require('@js-temporal/polyfill');

class CurrencyService {
  constructor() {
    this.rates = null;
    this.lastUpdate = null;
    // 12-hour cache
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
      // We also apply the interpolation rule here for security
      console.error(`Error getting currencies: ${error.message}`);
      return this.rates || { "USD": 1, "EUR": 0.92, "GBP": 0.78 };
    }
  }
}

module.exports = new CurrencyService();
