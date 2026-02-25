// En tu backend: src/models/fieldDefinitionModel.js

class FieldDefinitionDTO {
  constructor(data) {
    this.id = data.id ? parseInt(data.id) : null;
    this.name = data.name || "";
    this.type = data.type || "text";
    
    // 🚩 CAMBIO: Usar camelCase para que coincida con tu Flutter factory
    this.isRequired = !!(data.isRequired || data.is_required);
    this.isSummable = !!(data.isSummable || data.is_summable);
    this.isCountable = !!(data.isCountable || data.is_countable);
    this.isMonetary = !!(data.isMonetary || data.is_monetary);
    
    this.dataListId = data.dataListId || data.data_list_id || null;
    this.options = data.options || null;
  }

  static fromList(list) {
    if (!list) return [];
    const safeList = Array.isArray(list) ? list : [list];
    return safeList.map(item => new FieldDefinitionDTO(item));
  }

  // Este método es el que genera el JSON que recibe Flutter
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      isRequired: this.isRequired, // 👈 Sincronizado
      isSummable: this.isSummable, // 👈 Sincronizado
      isCountable: this.isCountable,
      isMonetary: this.isMonetary,
      dataListId: this.dataListId,
      options: this.options
    };
  }
}

module.exports = FieldDefinitionDTO;