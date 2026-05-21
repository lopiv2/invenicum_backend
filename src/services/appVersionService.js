const axios = require("axios");
const semver = require("semver");
const { GitHubConstants } = require("../config/githubConstants");
class AppVersionService {
  _normalizeVersion(version) {
    const raw = String(version || "")
      .trim()
      .replace(/^v/i, "");
    const valid = semver.valid(raw);
    if (valid) return valid;

    const coerced = semver.coerce(raw);
    if (coerced?.version) return coerced.version;

    // If we cannot coerce to a semver, fallback to a safe default '0.0.0'
    // instead of throwing. This prevents the whole version check endpoint
    // from failing when the frontend was built with a non-semver APP_VERSION
    // (for example a short git SHA). The backend will then compare against
    // the latest release normally and indicate an update is available.
    return "0.0.0";
  }

  async checkVersion(currentVersion) {
    if (!currentVersion) {
      throw new Error("currentVersion is required");
    }

    const normalizedCurrent = this._normalizeVersion(currentVersion);

    const response = await axios.get(
      `https://api.github.com/repos/${GitHubConstants.owner}/${GitHubConstants.mainRepo}/releases`,
      {
        timeout: 8000,
        params: { per_page: 10 }, // las 10 más recientes es suficiente
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Invenicum-App-Server",
        },
      },
    );

    const releases = response.data || [];

    // La primera release (índice 0) es siempre la más reciente publicada,
    // incluyendo prereleases, ya que GitHub las ordena por fecha desc.
    const latestRelease = releases[0];

    if (!latestRelease) {
      throw new Error("No releases found");
    }

    const latestTag = String(latestRelease?.tag_name || "");
    const latestVersion = this._normalizeVersion(latestTag);

    const minSupportedRaw =
      process.env.MIN_SUPPORTED_APP_VERSION || latestVersion;
    const minSupportedVersion = this._normalizeVersion(minSupportedRaw);

    const updateAvailable = semver.lt(normalizedCurrent, latestVersion);
    const forceUpdate = semver.lt(normalizedCurrent, minSupportedVersion);

    const releaseUrl = latestRelease?.html_url || null;

    return {
      currentVersion: normalizedCurrent,
      latestVersion,
      minSupportedVersion,
      updateAvailable,
      hasUpdate: updateAvailable,
      forceUpdate,
      isSupported: !forceUpdate,
      releaseUrl,
      releasesUrl: releaseUrl,
      publishedAt: latestRelease?.published_at || null,
      notes: latestRelease?.body || "",
    };
  }
}

module.exports = new AppVersionService();
