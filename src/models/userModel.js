class UserDTO {
  constructor(prismaUser) {
    this.id = Number(prismaUser.id);
    this.email = String(prismaUser.email || "");
    this.name = String(prismaUser.name || "");
    this.username = prismaUser.username || null;
    this.githubId = prismaUser.githubId || null;

    // --- LÓGICA DE EXPIRACIÓN ---
    const rawDate = prismaUser.githubLinkedAt;
    let isGithubValid = false;
    let parsedLinkedDate = null;

    if (rawDate) {
      try {
        parsedLinkedDate = rawDate instanceof Date ? rawDate : new Date(rawDate);

        if (!Number.isNaN(parsedLinkedDate.getTime())) {
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          isGithubValid = Date.now() - parsedLinkedDate.getTime() < thirtyDaysMs;
        }
      } catch (e) {
        console.error("[DTO DATE ERROR]: Error procesando fecha GitHub", e);
        isGithubValid = false;
      }
    }

    this.githubHandle = prismaUser.githubHandle || null;
    this.avatarUrl = prismaUser.avatarUrl || null;

    // Enviamos una fecha ISO consistente hacia Flutter.
    this.githubLinkedAt = parsedLinkedDate
      ? parsedLinkedDate.toISOString()
      : rawDate
        ? String(rawDate)
        : null;

    this.isGithubVerified = Boolean(isGithubValid);

    // --- CONFIGURACIONES (with Number() for evitar líos) ---
    this.themeConfig = prismaUser.themeConfig
      ? {
          id: Number(prismaUser.themeConfig.id),
          themeColor: String(prismaUser.themeConfig.themeColor),
          themeBrightness: String(prismaUser.themeConfig.themeBrightness),
          userId: Number(prismaUser.themeConfig.userId),
        }
      : null;

    this.preferences = prismaUser.preferences
      ? {
          id: Number(prismaUser.preferences.id),
          language: String(prismaUser.preferences.language),
        }
      : null;
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = UserDTO;
