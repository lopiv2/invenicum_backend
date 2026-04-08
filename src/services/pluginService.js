const prisma = require("../middleware/prisma");
const axios = require("axios");
const { Octokit } = require("@octokit/rest");
require("dotenv").config();
const semver = require("semver");
const { Temporal } = require('@js-temporal/polyfill');
const { GitHubConstants } = require("../config/githubConstants");

class PluginService {
  // Centralize GitHub configuration to avoid code repetition
  get _githubConfig() {
    return GitHubConstants.getConfig();
  }

  async _getGithubConfigAsync() {
    return await GitHubConstants.getConfigWithProxyToken();
  }

  async _incrementPluginDownloadCount(pluginId) {
    const { auth, owner, repo, pluginRepoUrl } = await this._getGithubConfigAsync();
    const octokit = new Octokit({ auth });

    // Extract the file name from the index URL (e.g., repository_plugin.json)
    const path = "repository_plugin.json";

    try {
      // 1. Get the current index file from GitHub
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      const content = JSON.parse(
        Buffer.from(fileData.content, "base64").toString(),
      );

      // 2. Search for the plugin and add 1
      let found = false;
      if (content.plugins && Array.isArray(content.plugins)) {
        content.plugins = content.plugins.map((p) => {
          if (p.id === pluginId) {
            p.downloadCount = (p.downloadCount || 0) + 1;
            found = true;
          }
          return p;
        });
      }

      if (!found) return; // If not in the index, do nothing

      // 3. Upload the updated file
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `📈 Analytics: Plugin ${pluginId} installed`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString(
          "base64",
        ),
        sha: fileData.sha,
      });
    } catch (error) {
      console.error(
        "❌ Error updating downloadCount in GitHub:",
        error.message,
      );
    }
  }

  /**
   * Private: gets plugins from GitHub and "hydrates" each one with its real UI and Avatar
   */
  async _getGitHubPlugins() {
    try {
      const { pluginRepoUrl } = this._githubConfig;
      const response = await axios.get(pluginRepoUrl);

      if (response.data && Array.isArray(response.data.plugins)) {
        const basePlugins = response.data.plugins;

        // 🚩 HYDRATION: Download the content of each download_url in parallel
        const hydratedPlugins = await Promise.all(
          basePlugins.map(async (plugin) => {
            try {
              // If it has a download URL, we fetch the full data (UI and Avatar)
              if (plugin.download_url) {
                const res = await axios.get(plugin.download_url);
                const fullData = res.data;

                return {
                  ...plugin,
                  // 🚩 Extract the full JSON avatar from plugin
                  downloadCount: plugin.downloadCount || 0,
                  authorAvatar:
                    fullData.authorAvatar ||
                    fullData.avatarUrl ||
                    plugin.authorAvatar,
                  // Extract the 'ui' property
                  ui: fullData.ui || fullData,
                };
              }
              return plugin;
            } catch (e) {
              console.error(
                `❌ Error hidratando plugin ${plugin.id}:`,
                e.message,
              );
              return plugin;
            }
          }),
        );

        return hydratedPlugins.map((p) => ({
          ...p,
          isOfficial: true,
          isPublic: true,
        }));
      }

      return [];
    } catch (error) {
      console.error("❌ Error loading GitHub plugin catalog:", error.message);
      return [];
    }
  }

  /**
   * Create or updates a plugin locally and synchronize with GitHub
   */
  async createPlugin(pluginData, userId) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({
      where: { id: uId },
      select: { githubHandle: true, avatarUrl: true },
    });

    if (!user || !user.githubHandle)
      throw new Error("User not found or GitHub not linked");

    // Security check: if the plugin already exists, am I the owner?
    const existing = await prisma.plugin.findUnique({
      where: { id: pluginData.id },
    });
    if (existing && existing.author !== user.githubHandle) {
      throw new Error("Not authorized: This plugin belongs to another author");
    }

    // 3. Call the method that handles the GitHub interaction
    try {
      const prData = await this.uploadPluginJson(
        pluginData,
        user.githubHandle,
        user.avatarUrl,
      );

      return {
        success: true,
        message: "Proposal submitted to GitHub successfully",
        prUrl: prData.html_url,
      };
    } catch (error) {
      console.error("❌ Error proposing plugin:", error.message);
      throw new Error("Error processing the proposal on GitHub");
    }
  }

  async getPluginPreview(url) {
    try {
      if (!url.startsWith("https://raw.githubusercontent.com")) {
        throw new Error("URL not allowed for preview");
      }
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error("❌ Error in getPluginPreview:", error.message);
      throw new Error("Could not fetch plugin preview.");
    }
  }

  async uploadPluginJson(plugin, authorName, authorAvatar) {
    const { auth, owner, repo } = await this._getGithubConfigAsync();
    if (!semver.valid(plugin.version)) {
      throw new Error(
        `The version '${plugin.version}' is not a valid SemVer (e.g., 1.0.0)`,
      );
    }
    const octokit = new Octokit({ auth });

    const branchName = `plugin-submission-${plugin.id}-${Temporal.Now.instant().epochMilliseconds}`;
    const path = `plugins/${plugin.id}.json`;

    try {
      const { data: mainRef } = await octokit.git.getRef({
        owner,
        repo,
        ref: "heads/main",
      });

      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: mainRef.object.sha,
      });

      const pluginFileContent = {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        author: authorName,
        authorAvatar: authorAvatar,
        slot: plugin.slot,
        ui: plugin.ui,
      };

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch: branchName,
        message: `🚀 Propose plugin: ${plugin.name} by ${authorName}`,
        content: Buffer.from(
          JSON.stringify(pluginFileContent, null, 2),
        ).toString("base64"),
      });

      const pr = await octokit.pulls.create({
        owner,
        repo,
        title: `🆕 Plugin Submission: ${plugin.name}`,
        head: branchName,
        base: "main",
        body: `User: ${authorName}\nID: ${plugin.id}\nVersion: ${plugin.version}`,
      });

      return pr.data;
    } catch (error) {
      console.error("❌ Error in GitHub PR flow:", error.message);
      throw error;
    }
  }

  /**
   * Mixes local and remote plugins
   */
  async getAllCommunityPlugins(userId) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({
      where: { id: uId },
      select: { githubHandle: true },
    });

    const installedPlugins = await prisma.userPlugin.findMany({
      where: { userId: uId },
      select: { pluginId: true },
    });
    const installedIds = installedPlugins.map((up) => up.pluginId);

    const dbPlugins = await prisma.plugin.findMany({
      where: { isPublic: true, id: { notIn: installedIds } },
    });

    const allGithubPlugins = await this._getGitHubPlugins();
    const githubPlugins = allGithubPlugins.filter(
      (p) => !installedIds.includes(p.id),
    );

    const communityMap = new Map();

    githubPlugins.forEach((p) => {
      communityMap.set(p.id, {
        ...p,
        isOfficial: true,
        isMine: false,
      });
    });

    dbPlugins.forEach((p) => {
      communityMap.set(p.id, {
        ...p,
        isOfficial: false,
        isMine: p.author === user?.githubHandle,
      });
    });

    return Array.from(communityMap.values());
  }

  /**
   * Installs a plugin by automatically detecting the UI structure
   */
  async installPlugin(userId, pluginData) {
    const uId = parseInt(userId);
    if (!pluginData || !pluginData.id)
      throw new Error("Incomplete plugin data");

    let uiData = pluginData.ui;

    if (!uiData) {
      const url =
        pluginData.download_url || pluginData.downloadUrl || pluginData.url;
      if (url) {
        const response = await axios.get(url);
        uiData = response.data.ui ? response.data.ui : response.data;
      }
    } else if (uiData.ui) {
      uiData = uiData.ui;
    }

    // Upsert the plugin without authorId (Use the text fields author and authorAvatar)
    await prisma.plugin.upsert({
      where: { id: pluginData.id },
      update: {
        name: pluginData.name,
        description: pluginData.description,
        version: pluginData.version || "1.0.0",
        ui: uiData,
        authorAvatar: pluginData.authorAvatar,
      },
      create: {
        id: pluginData.id,
        name: pluginData.name || "No name",
        version: pluginData.version || "1.0.0",
        description: pluginData.description || "",
        slot: pluginData.slot || "dashboard_top",
        ui: uiData || {},
        isPublic: true,
        author: pluginData.author,
        authorAvatar: pluginData.authorAvatar,
      },
    });

    const result = await prisma.userPlugin.upsert({
      where: { userId_pluginId: { userId: uId, pluginId: pluginData.id } },
      update: { isActive: true },
      create: { userId: uId, pluginId: pluginData.id, isActive: true },
    });

    // 2. 🚀 Synchronize with GitHub (without blocking the Response to the User)
    // Do not use 'await' here so that the user does not have to wait for GitHub to see their plugin installed  
    this._incrementPluginDownloadCount(pluginData.id).catch(console.error);

    return result;
  }

  /**
   * Lists installed plugins by comparing GitHub handle to determine isMine
   */
  async getUserPlugins(userId) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({
      where: { id: uId },
      select: { githubHandle: true },
    });

    const userPlugins = await prisma.userPlugin.findMany({
      where: { userId: uId },
      include: { plugin: true },
    });

    const githubPlugins = await this._getGitHubPlugins();

    return userPlugins.map((up) => {
      const installed = up.plugin;
      const remote = githubPlugins.find((p) => p.id === installed.id);
      const hasUpdate =
        remote &&
        semver.gt(
          semver.clean(remote.version) || remote.version,
          semver.clean(installed.version) || installed.version,
        );

      return {
        ...installed,
        isActive: up.isActive,
        isMine: installed.author === user?.githubHandle,
        hasUpdate: !!hasUpdate,
        latestVersion: remote ? remote.version : installed.version,
      };
    });
  }

  /**
   * Updates a plugin by validating the GitHub handle and creating a PR if it's public, or updating directly if it's private
   * Only the author can update their plugin, whether it's public or private
   */
  async updatePlugin(id, data, uId) {
    // 1. get data del Use from the DB for the autor/avatar
    const user = await prisma.user.findUnique({
      where: { id: parseInt(uId) },
      select: { githubHandle: true, avatarUrl: true, name: true },
    });

    const { auth, owner, repo } = await this._getGithubConfigAsync();
    const octokit = new Octokit({ auth });

    // 2. Definir nombres de rama and route del archivo
    const branchName = `plugin-update-${id}-${Temporal.Now.instant().epochMilliseconds}`;
    const path = `plugins/${id}.json`;

    try {
      // A. get reference of main (for creating the branch)
      const { data: mainRef } = await octokit.git.getRef({
        owner,
        repo,
        ref: "heads/main",
      });

      // B. get the current file to get its SHA (Required for update)
      const { data: currentFile } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      // C. Create the new branch from main using the SHA of the current file (important for concurrency control in updates)
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: mainRef.object.sha,
      });

      // D. Prepare the content of the JSON (same as in uploadPluginJson)
      const pluginFileContent = {
        id: id,
        name: data.name,
        description: data.description,
        version: data.version || "1.0.0",
        author: user.githubHandle || user.name,
        authorAvatar: user.avatarUrl,
        slot: data.slot,
        ui: data.ui,
      };

      // E. Upload the modified file to the new branch using the SHA
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch: branchName,
        sha: currentFile.sha, // 🚩 This is what differentiates the update from the creation
        message: `🆙 Update plugin: ${data.name} by ${user.githubHandle}`,
        content: Buffer.from(
          JSON.stringify(pluginFileContent, null, 2),
        ).toString("base64"),
      });

      // F. Create the Pull Request
      const pr = await octokit.pulls.create({
        owner,
        repo,
        title: `🆙 Plugin Update: ${data.name}`,
        head: branchName,
        base: "main",
        body: `Update request submitted by @${user.githubHandle}\nID: ${id}\nVersion: ${data.version}`,
      });

      // Once the PR is created successfully:
      await prisma.plugin.update({
        where: { id: id },
        data: {
          hasPendingPR: true,
          pendingVersion: parseFloat(data.version),
        },
      });

      return pr.data;
    } catch (error) {
      console.error("❌ Error in update PR flow:", error.message);
      throw new Error(
        "Failed to process the update on GitHub: " + error.message,
      );
    }
  }

  /**
   * Deletes a plugin by validating the GitHub handle and deleting the file from GitHub if it's public, or deleting directly if it's private
   * Only the author can delete their plugin, whether it's public or private
   */
  async deletePlugin(id, userId, deleteFromGitHub = false) {
    const uId = parseInt(userId);
    const user = await prisma.user.findUnique({
      where: { id: uId },
      select: { githubHandle: true },
    });
    const plugin = await prisma.plugin.findUnique({ where: { id } });

    if (!plugin || plugin.author !== user?.githubHandle) {
      throw new Error(
        "Unauthorized: Only the author can delete this plugin",
      );
    }

    if (deleteFromGitHub && plugin.isPublic) {
      const { auth, owner, repo } = await this._getGithubConfigAsync();
      const octokit = new Octokit({ auth });

      try {
        const { data: fData } = await octokit.repos.getContent({
          owner,
          repo,
          path: `plugins/${id}.json`,
        });

        await octokit.repos.deleteFile({
          owner,
          repo,
          path: `plugins/${id}.json`,
          message: `🗑️ Remove plugin: ${id}`,
          sha: fData.sha,
        });
      } catch (e) {
        console.warn("Failed to delete from GitHub:", e.message);
      }
    }

    return await prisma.plugin.delete({ where: { id } });
  }

  async toggleUserPlugin(userId, pluginId, isActive) {
    return await prisma.userPlugin.update({
      where: { userId_pluginId: { userId: parseInt(userId), pluginId } },
      data: { isActive },
    });
  }

  async uninstallPlugin(userId, pluginId) {
    return await prisma.userPlugin.delete({
      where: { userId_pluginId: { userId: parseInt(userId), pluginId } },
    });
  }
}

module.exports = new PluginService();
