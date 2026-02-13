// models/UserModel.js
class UserDTO {
  constructor(prismaUser) {
    this.id = parseInt(prismaUser.id);
    this.email = prismaUser.email;
    this.name = prismaUser.name;
    this.username = prismaUser.username || null;
    
    // 🚩 CAMBIO: Guardamos el ID de GitHub para que llegue a Flutter
    this.githubId = prismaUser.githubId || null; 

    // --- LÓGICA DE EXPIRACIÓN ---
    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
    const githubLinkedAt = prismaUser.githubLinkedAt; 
    const now = new Date();

    // Comprobamos si es válido
    const isGithubValid = githubLinkedAt && (now - new Date(githubLinkedAt) < thirtyDaysInMs);

    // 🚩 CAMBIO SUGERIDO: 
    // Enviamos el handle y el avatar SIEMPRE si existen, 
    // pero añadimos un campo booleano para el "tick verde".
    // Así el avatar no desaparece de la UI aunque pasen 30 días.
    this.githubHandle = prismaUser.githubHandle || null;
    this.avatarUrl = prismaUser.avatarUrl || null;
    this.githubLinkedAt = githubLinkedAt || null;
    this.isGithubVerified = !!isGithubValid; // Nuevo campo booleano
    // ------------------------------------------------

    this.themeConfig = prismaUser.themeConfig ? {
      id: parseInt(prismaUser.themeConfig.id),
      themeColor: prismaUser.themeConfig.themeColor,
      themeBrightness: prismaUser.themeConfig.themeBrightness,
      userId: parseInt(prismaUser.themeConfig.userId)
    } : null;

    this.preferences = prismaUser.preferences ? {
      id: parseInt(prismaUser.preferences.id),
      language: prismaUser.preferences.language
    } : null;
  }

  toJSON() {
    return {
      id: this.id,
      email: this.email,
      name: this.name,
      username: this.username,
      githubId: this.githubId,       // 🚩 No olvides añadirlo aquí
      githubHandle: this.githubHandle,
      avatarUrl: this.avatarUrl,
      githubLinkedAt: this.githubLinkedAt,
      isGithubVerified: this.isGithubVerified, // 🚩 Útil para el frontend
      themeConfig: this.themeConfig,
      preferences: this.preferences,
    };
  }
}

module.exports = UserDTO;