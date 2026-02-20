// models/InventoryItemDTO.js
class InventoryItemDTO {
  constructor(prismaItem) {
    this.id = parseInt(prismaItem.id);
    this.name = prismaItem.name;
    this.description = prismaItem.description || null;
    this.barcode = prismaItem.barcode || null;

    // --- STOCK Y CANTIDADES ---
    this.quantity = parseInt(prismaItem.quantity || 1);
    this.minStock = parseInt(prismaItem.minStock || 0);
    this.isLowStock = this.quantity <= this.minStock;

    // --- VALORACIÓN DE MERCADO ---
    this.marketValue = parseFloat(prismaItem.marketValue || 0);
    this.currency = prismaItem.currency || "EUR";
    this.lastPriceUpdate = prismaItem.lastPriceUpdate
      ? prismaItem.lastPriceUpdate.toISOString()
      : null;

    // Valor total de este lote (cantidad * precio)
    this.totalMarketValue = parseFloat(
      (this.marketValue * this.quantity).toFixed(2),
    );
    this.priceHistory = (prismaItem.priceHistory || []).map(ph => ({
      price: ph.price,
      createdAt: ph.createdAt
    }));

    // --- RELACIONES E IDS ---
    this.locationId = prismaItem.locationId
      ? parseInt(prismaItem.locationId)
      : null;

    // 🔑 AQUÍ LA CORRECCIÓN: Capturar el objeto location completo
    this.location = prismaItem.location
      ? {
          id: parseInt(prismaItem.location.id),
          name: prismaItem.location.name,
          // añade otros campos de location si son necesarios
        }
      : null;
    this.assetTypeId = parseInt(prismaItem.assetTypeId);
    this.containerId = parseInt(prismaItem.containerId);
    this.assignedToUserId = prismaItem.assignedToUserId
      ? parseInt(prismaItem.assignedToUserId)
      : null;

    // --- METADATOS AGNÓSTICOS ---
    // Aseguramos que sea un objeto para que Flutter lo parsee como Map<String, dynamic>
    this.customFieldValues = prismaItem.customFieldValues || {};

    // --- FECHAS ---
    this.createdAt = prismaItem.createdAt.toISOString();
    this.updatedAt = prismaItem.updatedAt.toISOString();

    // --- ASSETS (Imágenes) ---
    // Si traes las imágenes en el include de Prisma
    this.imageUrl =
      prismaItem.images && prismaItem.images.length > 0
        ? prismaItem.images[0].url
        : null;
    // 2. AÑADIMOS EL ARRAY COMPLETO PARA LA GALERÍA 👈 ESTO ES LO QUE FALTA
    this.images = prismaItem.images
      ? prismaItem.images.map((img) => ({
          id: img.id,
          url: img.url,
          order: img.order,
        }))
      : [];
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      barcode: this.barcode,
      quantity: this.quantity,
      minStock: this.minStock,
      isLowStock: this.isLowStock,
      marketValue: this.marketValue,
      currency: this.currency,
      totalMarketValue: this.totalMarketValue,
      priceHistory: this.priceHistory,
      lastPriceUpdate: this.lastPriceUpdate,
      locationId: this.locationId,
      location: this.location,
      assetTypeId: this.assetTypeId,
      containerId: this.containerId,
      assignedToUserId: this.assignedToUserId,
      customFieldValues: this.customFieldValues,
      imageUrl: this.imageUrl,
      images: this.images,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = InventoryItemDTO;
