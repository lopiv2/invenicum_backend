const FieldDefinitionDTO = require('./fieldDefinitionModel');

class AssetTypeDTO {
  constructor(prismaAssetType) {
    this.id = parseInt(prismaAssetType.id);
    this.name = prismaAssetType.name;
    this.containerId = parseInt(prismaAssetType.containerId);
    this.isSerialized = !!prismaAssetType.isSerialized;
    this.possessionFieldId = prismaAssetType.possessionFieldId ? parseInt(prismaAssetType.possessionFieldId) : null;
    this.desiredFieldId = prismaAssetType.desiredFieldId ? parseInt(prismaAssetType.desiredFieldId) : null;

    // 🚀 Usamos el DTO especializado
    this.fieldDefinitions = FieldDefinitionDTO.fromList(prismaAssetType.fieldDefinitions);

    this.images = (prismaAssetType.images || []).map(img => ({
      id: parseInt(img.id),
      url: img.url,
      order: img.order
    }));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      containerId: this.containerId,
      isSerialized: this.isSerialized,
      possessionFieldId: this.possessionFieldId,
      desiredFieldId: this.desiredFieldId,
      fieldDefinitions: this.fieldDefinitions,
      images: this.images,
    };
  }
}

module.exports = AssetTypeDTO;