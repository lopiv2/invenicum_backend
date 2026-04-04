// config/githubConstants.js
const axios = require('axios');
const { verifyProxyJwt } = require('../lib/jwtValidator');

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
      owner: this.owner,
      repo: this.repo,
      pluginRepoUrl: this.pluginRepoUrl,
      templateRepoUrl: this.templateRepoUrl,
    };
  }

  static async getConfigWithProxyToken() {
    const response = await axios.get('https://api.invenicum.com/api/github-token', {
      timeout: 5000,
    });

    const jwt = response.data?.jwt;

    if (!jwt) {
      throw new Error('JWT not found in response from proxy');
    }

    // Verify JWT and extract GitHub token
    const githubToken = await verifyProxyJwt(jwt);

    return {
      auth: githubToken,
      owner: this.owner,
      repo: this.repo,
      pluginRepoUrl: this.pluginRepoUrl,
      templateRepoUrl: this.templateRepoUrl,
    };
  }
}

module.exports = { GitHubConstants };