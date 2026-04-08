const { Temporal } = require('@js-temporal/polyfill');

class UpcMarketDataDTO {
  constructor(data) {
    const item = data.items?.[0] || {};
    const offers = item.offers || [];

    // 1. data básicos del producto
    this.title = String(item.title || 'Producto no encontrado');
    this.description = String(item.description || '');
    this.category = String(item.category || 'General');
    this.imageUrl = item.images?.[0] || null;

    // 2. Cálculo de valor de mercado
    const validPrices = offers
      .map(o => parseFloat(o.price))
      .filter(p => !isNaN(p) && p > 0);

    this.marketValue = validPrices.length > 0 
      ? Number((validPrices.reduce((a, b) => a + b, 0) / validPrices.length).toFixed(2)) 
      : 0;

    this.currency = String(offers[0]?.currency || 'EUR');

    // 3. Listado de ofertas (Top 10)
    this.listings = offers.slice(0, 10).map(offer => {
      let updatedAtISO = null;

      if (offer.updated_t) {
        try {
          // Temporal nos permite Create a instante directamente from segundos de Unix
          // .fromEpochSeconds es mucho más legible que multiplicar por 1000
          updatedAtISO = Temporal.Instant.fromEpochSeconds(Number(offer.updated_t)).toString();
        } catch (e) {
          // fallback por if the timestamp viene mal
          updatedAtISO = null;
        }
      }

      return {
        store: String(offer.merchant || 'Desconocido'),
        price: Number(offer.price || 0),
        currency: String(offer.currency || this.currency),
        url: String(offer.link || ''),
        condition: String(offer.condition || 'Nuevo'),
        updatedAt: updatedAtISO
      };
    });
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = UpcMarketDataDTO;
