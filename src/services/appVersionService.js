const axios = require("axios");
const semver = require("semver");
const { GitHubConstants } = require("../config/githubConstants");

class AppVersionService {
  get _owner() {
    return GitHubConstants.owner;
  }

  get _repo() {
    return GitHubConstants.repo;
  }

  _normalizeVersion(version) {
    const raw = String(version || "").trim().replace(/^v/i, "");
    const valid = semver.valid(raw);
    if (valid) return valid;

    const coerced = semver.coerce(raw);
    if (coerced?.version) return coerced.version;

    throw new Error("Invalid currentVersion format");
  }

  async checkVersion(currentVersion) {
    if (!currentVersion) {
      throw new Error("currentVersion is required");
    }

    const normalizedCurrent = this._normalizeVersion(currentVersion);

    const response = await axios.get(
      `https://api.github.com/repos/${this._owner}/${this._repo}/releases/latest`,
      {
        timeout: 8000,
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );

    const latestTag = String(response.data?.tag_name || "");
    const latestVersion = this._normalizeVersion(latestTag);

    const minSupportedRaw = process.env.MIN_SUPPORTED_APP_VERSION || latestVersion;
    const minSupportedVersion = this._normalizeVersion(minSupportedRaw);

    const updateAvailable = semver.lt(normalizedCurrent, latestVersion);
    const forceUpdate = semver.lt(normalizedCurrent, minSupportedVersion);

    return {
      currentVersion: normalizedCurrent,
      latestVersion,
      minSupportedVersion,
      updateAvailable,
      forceUpdate,
      isSupported: !forceUpdate,
      releaseUrl: response.data?.html_url || null,
      publishedAt: response.data?.published_at || null,
      notes: response.data?.body || "",
    };
  }
}

module.exports = new AppVersionService();
