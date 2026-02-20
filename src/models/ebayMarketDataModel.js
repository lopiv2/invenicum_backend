// src/dtos/EbayMarketDataDTO.js

class EbayMarketDataDTO {
  constructor(rawEbayData) {
    const items = rawEbayData.itemSummaries || [];

    // 1. Calculamos el valor de mercado promedio
    this.marketValue = this._calculateAverage(items);
    
    // 2. Moneda (tomamos la del primer resultado)
    this.currency = items.length > 0 ? items[0].price.currency : 'EUR';

    // 3. Mapeamos solo los 10 productos para comprar
    this.listings = items.slice(0, 10).map(item => ({
      id: item.itemId,
      title: item.title,
      price: parseFloat(item.price.value),
      currency: item.price.currency,
      imageUrl: item.image?.imageUrl || null,
      ebayUrl: item.itemWebUrl, // 🔗 El link directo
      condition: item.condition || 'N/A',
      location: item.itemLocation?.country || 'Unknown'
    }));

    this.totalFound = items.length;
    this.timestamp = new Date().toISOString();
  }

  _calculateAverage(items) {
    if (items.length === 0) return 0;
    const total = items.reduce((sum, item) => sum + parseFloat(item.price.value), 0);
    return parseFloat((total / items.length).toFixed(2));
  }
}

module.exports = EbayMarketDataDTO;