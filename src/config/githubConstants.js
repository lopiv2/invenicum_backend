// config/githubConstants.js

class GitHubConstants {
  static DEFAULT_OWNER = "lopiv2";

  static DEFAULT_REPO = "invenicum-market-repository";

  static get owner() {
    return process.env.GITHUB_REPO_OWNER || this.DEFAULT_OWNER;
  }

  static get repo() {
    return process.env.GITHUB_REPO_NAME || this.DEFAULT_REPO;
  }

  static get pluginRepoUrl() {
    return (
      process.env.GITHUB_PLUGIN_REPO ||
      `https://raw.githubusercontent.com/${this.owner}/${this.repo}/main/repository_plugin.json`
    );
  }

  static get templateRepoUrl() {
    return (
      process.env.GITHUB_TEMPLATE_REPO ||
      `https://raw.githubusercontent.com/${this.owner}/${this.repo}/main/repository_template.json`
    );
  }

  static getConfig() {
    return {
      auth: process.env.GITHUB_TOKEN,
      owner: this.owner,
      repo: this.repo,
      pluginRepoUrl: this.pluginRepoUrl,
      templateRepoUrl: this.templateRepoUrl,
    };
  }
}

module.exports = { GitHubConstants };