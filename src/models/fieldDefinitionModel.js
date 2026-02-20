class FieldDefinitionDTO {
  constructor(prismaField) {
    this.id = parseInt(prismaField.id);
    this.name = prismaField.name;
    this.type = prismaField.type;
    this.isRequired = !!prismaField.isRequired;
    this.isSummable = !!prismaField.isSummable;
    this.isCountable = !!prismaField.isCountable;
    this.isMonetary = !!prismaField.isMonetary;
    this.dataListId = prismaField.dataListId ? parseInt(prismaField.dataListId) : null;
    
    // Si tienes un ID del AssetType al que pertenece
    if (prismaField.assetTypeId) {
      this.assetTypeId = parseInt(prismaField.assetTypeId);
    }
  }

  static fromList(list) {
    return (list || []).map(item => new FieldDefinitionDTO(item));
  }
}

module.exports = FieldDefinitionDTO;