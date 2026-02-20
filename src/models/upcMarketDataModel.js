class UpcMarketDataDTO {
  constructor(data) {
    const item = data.items?.[0] || {};
    const offers = item.offers || [];

    // 1. Datos básicos del producto
    this.title = item.title || 'Producto no encontrado';
    this.description = item.description || '';
    this.category = item.category || 'General';
    this.imageUrl = item.images?.[0] || null;

    // 2. Cálculo de valor de mercado (Promedio de ofertas)
    const validPrices = offers.map(o => o.price).filter(p => p > 0);
    this.marketValue = validPrices.length > 0 
      ? parseFloat((validPrices.reduce((a, b) => a + b, 0) / validPrices.length).toFixed(2)) 
      : 0;

    this.currency = offers[0]?.currency || 'EUR';

    // 3. Listado de ofertas para comprar (Top 10)
    this.listings = offers.slice(0, 10).map(offer => ({
      store: offer.merchant,
      price: offer.price,
      currency: offer.currency,
      url: offer.link,
      condition: offer.condition || 'Nuevo',
      updatedAt: offer.updated_t ? new Date(offer.updated_t * 1000).toISOString() : null
    }));
  }
}

module.exports = UpcMarketDataDTO;