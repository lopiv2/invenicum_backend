
const axios = require("axios");
const semver = require("semver");
const { GitHubConstants } = require("../config/githubConstants");
class AppVersionService {

  _normalizeVersion(version) {
    const raw = String(version || "").trim().replace(/^v/i, "");
    const valid = semver.valid(raw);
    if (valid) return valid;

    const coerced = semver.coerce(raw);
    if (coerced?.version) return coerced.version;

    // If we cannot coerce to a semver, fallback to a safe default '0.0.0'
    // instead of throwing. This prevents the whole version check endpoint
    // from failing when the frontend was built with a non-semver APP_VERSION
    // (for example a short git SHA). The backend will then compare against
    // the latest release normally and indicate an update is available.
    return '0.0.0';
  }

  async checkVersion(currentVersion) {
    if (!currentVersion) {
      throw new Error("currentVersion is required");
    }

    const normalizedCurrent = this._normalizeVersion(currentVersion);

    const response = await axios.get(
      `https://api.github.com/repos/${GitHubConstants.owner}/${GitHubConstants.mainRepo}/releases/latest`,
      {
        timeout: 8000,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Invenicum-App-Server",
        },
      },
    );

    const latestTag = String(response.data?.tag_name || "");
    const latestVersion = this._normalizeVersion(latestTag);

    const minSupportedRaw = process.env.MIN_SUPPORTED_APP_VERSION || latestVersion;
    const minSupportedVersion = this._normalizeVersion(minSupportedRaw);

    const updateAvailable = semver.lt(normalizedCurrent, latestVersion);
    const forceUpdate = semver.lt(normalizedCurrent, minSupportedVersion);

    const releaseUrl = response.data?.html_url || null;

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
      publishedAt: response.data?.published_at || null,
      notes: response.data?.body || "",
    };
  }
}

module.exports = new AppVersionService();
