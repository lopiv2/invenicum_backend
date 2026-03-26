// models/InventoryItemDTO.js
class InventoryItemDTO {
  constructor(prismaItem) {
    this.id = parseInt(prismaItem.id);
    this.name = prismaItem.name;
    this.description = prismaItem.description || null;
    this.barcode = prismaItem.barcode || null;
    this.serialNumber= prismaItem.serialNumber || null;
    this.condition = prismaItem.condition || "loose";

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

    this.location = prismaItem.location
      ? {
          id: parseInt(prismaItem.location.id),
          name: prismaItem.location.name,
        }
      : null;
      
    this.assetTypeId = parseInt(prismaItem.assetTypeId);
    this.containerId = parseInt(prismaItem.containerId);
    this.assignedToUserId = prismaItem.assignedToUserId
      ? parseInt(prismaItem.assignedToUserId)
      : null;

    // --- METADATOS AGNÓSTICOS ---
    this.customFieldValues = prismaItem.customFieldValues || {};

    // --- FECHAS ---
    this.createdAt = prismaItem.createdAt.toISOString();
    this.updatedAt = prismaItem.updatedAt.toISOString();

    // --- ASSETS (Imágenes) ---
    this.imageUrl =
      prismaItem.images && prismaItem.images.length > 0
        ? prismaItem.images[0].url
        : null;
        
    this.images = prismaItem.images
      ? prismaItem.images.map((img) => ({
          id: img.id,
          url: img.url,
          order: img.order,
        }))
      : [];
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = InventoryItemDTO;