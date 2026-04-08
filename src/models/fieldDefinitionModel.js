// En tu backend: src/models/fieldDefinitionModel.js

class FieldDefinitionDTO {
  constructor(data) {
    this.id = data.id ? parseInt(data.id) : null;
    this.name = data.name || "";
    this.type = data.type || "text";
    
    // 🚩 Change: use camelCase so that coincida with tu Flutter factory
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

  // Este método es the que genera the JSON que recibe Flutter
  toJSON() {
    return { ...this };
  }
}

module.exports = FieldDefinitionDTO;
