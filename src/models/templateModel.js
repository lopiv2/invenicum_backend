const FieldDefinitionDTO = require('./fieldDefinitionModel');

class AssetTemplateDTO {
  constructor(data) {
    this.id = data.id?.toString() || "";
    this.name = data.name || "";
    this.description = data.description || "";
    this.category = data.category || "General";
    
    this.tags = Array.isArray(data.tags) ? data.tags : [];
    
    // Normalización de autoría
    this.author = data.authorName || data.author_name || data.author || "Invenicum User";
    this.authorAvatarUrl = data.authorAvatarUrl || data.author_avatar_url || null;
    this.downloadUrl = data.downloadUrl || data.download_url || null;

    // Campos procesados por su propio DTO
    this.fields = FieldDefinitionDTO.fromList(data.fields || []);

    this.downloadCount = data.downloadCount || 0;
    this.isOfficial = !!(data.isOfficial === true || data.is_official === true);
    this.isPublic = !!(data.isPublic === true || data.is_public === true);

    this.createdAt = data.createdAt || data.created_at || new Date().toISOString();
    this.updatedAt = data.updatedAt || data.updated_at || new Date().toISOString();
  }

  static fromList(list) {
    if (!list) return [];
    return list.map(item => new AssetTemplateDTO(item));
  }

  /**
   * Solo exportamos las llaves en camelCase para Flutter
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      downloadUrl: this.downloadUrl,
      category: this.category,
      tags: this.tags,
      author: this.author, 
      authorAvatarUrl: this.authorAvatarUrl,
      fields: this.fields, 
      isOfficial: this.isOfficial, // 👈 Única versión que saldrá
      isPublic: this.isPublic,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      downloadCount: this.downloadCount,
    };
  }
}

module.exports = AssetTemplateDTO;