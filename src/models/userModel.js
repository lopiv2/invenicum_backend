const { Temporal } = require("@js-temporal/polyfill");

class UserDTO {
  constructor(prismaUser) {
    this.id = Number(prismaUser.id);
    this.email = String(prismaUser.email || "");
    this.name = String(prismaUser.name || "");
    this.username = prismaUser.username || null;
    this.githubId = prismaUser.githubId || null;

    // --- LÓGICA DE EXPIRACIÓN (Versión Ultra-Segura) ---
    const rawDate = prismaUser.githubLinkedAt;
    let isGithubValid = false;

    if (rawDate) {
      try {
        // 1. Convertimos CUALQUIER cosa (String o Date) a un String ISO
        // Esto es lo más seguro para que Temporal lo entienda siempre.
        const isoString =
          rawDate instanceof Date
            ? rawDate.toISOString()
            : new Date(rawDate).toISOString();

        // 2. Creamos el instante desde el string (esto no falla nunca)
        const linkedInstant = Temporal.Instant.from(isoString);

        const now = Temporal.Now.instant();
        const thirtyDays = Temporal.Duration.from({ days: 30 });

        // 3. Calculamos el límite y comparamos
        const expiryLimit = linkedInstant.add(thirtyDays);

        // Si el resultado es < 0, significa que 'now' es ANTERIOR al límite (Válido)
        isGithubValid = Temporal.Instant.compare(now, expiryLimit) < 0;
      } catch (e) {
        console.error("[DTO DATE ERROR]: Error procesando fecha GitHub", e);
        isGithubValid = false;
      }
    }

    this.githubHandle = prismaUser.githubHandle || null;
    this.avatarUrl = prismaUser.avatarUrl || null;

    // Nos aseguramos de enviar un string ISO a Flutter
    this.githubLinkedAt = rawDate
      ? typeof rawDate === "string"
        ? rawDate
        : rawDate.toISOString()
      : null;

    this.isGithubVerified = Boolean(isGithubValid);

    // --- CONFIGURACIONES (con Number() para evitar líos) ---
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
