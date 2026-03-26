const { Temporal } = require('@js-temporal/polyfill');

class AlertDTO {
  constructor(data) {
    this.id = Number(data.id);
    this.title = String(data.title || "");
    this.message = String(data.message || "");
    this.type = String(data.type || "info"); 
    
    // Normalización de booleanos
    this.isRead = Boolean(data.isRead || data.is_read);
    this.isEvent = Boolean(data.isEvent || data.is_event);
    
    // --- MANEJO DE FECHAS CON TEMPORAL ---
    // 1. Usamos el campo de la extensión si existe, si no, fallback seguro a String
    this.createdAt = data.createdAtTemporal 
      ? data.createdAtTemporal.toString() 
      : (data.createdAt ? new Date(data.createdAt).toISOString() : Temporal.Now.instant().toString());

    this.scheduledAt = data.scheduledAtTemporal 
      ? data.scheduledAtTemporal.toString() 
      : (data.scheduledAt ? new Date(data.scheduledAt).toISOString() : null);

    this.notifyAt = data.notifyAt 
      ? new Date(data.notifyAt).toISOString() 
      : null;
  }

  static fromList(list) {
    if (!list || !Array.isArray(list)) return [];
    return list.map(item => new AlertDTO(item)); 
  }

  toJSON() {
    // Al usar esparcimiento (...this), ya incluimos todo lo del constructor
    return { ...this };
  }
}

module.exports = AlertDTO;