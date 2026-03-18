class DraftItemDTO {
  constructor(aiData) {
    // Campos básicos garantizados
    this.name = aiData.name || "";
    this.description = aiData.description || "";
    
    // Metadatos dinámicos de la IA (Map<String, String>)
    this.customFieldValues = aiData.customFieldValues || {};

    // Imagen principal (Base64 o URL)
    this.imageUrl = aiData.images?.[0]?.url || null;

    // Galería compatible con tu DTO de Inventario
    this.images = aiData.images ? aiData.images.map((img, index) => ({
      url: img.url,
      order: index
    })) : [];

    // Valores por defecto para inicializar controladores en el Front
    this.quantity = 1;
    this.minStock = 0;
    this.marketValue = 0;
    this.currency = "EUR";
    
    // IDs nulos porque aún no existen en DB
    this.locationId = null;
    this.assetTypeId = null;
    this.barcode = ""; 
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      customFieldValues: this.customFieldValues,
      imageUrl: this.imageUrl,
      images: this.images,
      quantity: this.quantity,
      minStock: this.minStock,
      marketValue: this.marketValue,
      currency: this.currency,
      locationId: this.locationId,
      assetTypeId: this.assetTypeId,
      barcode: this.barcode,
      isDraft: true // Flag útil para Flutter
    };
  }
}

module.exports = DraftItemDTO;