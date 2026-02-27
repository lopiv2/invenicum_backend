// src/dtos/alertDTO.js

class AlertDTO {
  constructor(data) {
    this.id = data.id;
    this.title = data.title || "";
    this.message = data.message || "";
    this.type = data.type || "info"; // 'info', 'warning', 'critical'
    this.isRead = !!data.isRead || !!data.is_read; // Soporta ambos formatos
    
    // Lógica de Calendario
    this.isEvent = !!data.isEvent || !!data.is_event;
    
    // Aseguramos que las fechas salgan como String ISO o null
    this.scheduledAt = data.scheduledAt || data.scheduled_at || null;
    this.createdAt = data.createdAt || data.created_at || new Date().toISOString();
    this.notifyAt = data.notifyAt || data.notify_at || null;
  }

  static fromList(list) {
    if (!list || !Array.isArray(list)) return [];
    return list.map(item => new AlertDTO(item).toJSON());
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      message: this.message,
      type: this.type,
      isRead: this.isRead,
      isEvent: this.isEvent,
      scheduledAt: this.scheduledAt,
      createdAt: this.createdAt,
      notifyAt: this.notifyAt
    };
  }
}

module.exports = AlertDTO;