const express = require("express");
const router = express.Router();
const appVersionService = require("../services/appVersionService");

router.get("/version/check", async (req, res) => {
  try {
    const { currentVersion } = req.query;
    const data = await appVersionService.checkVersion(currentVersion);
    res.status(200).json({ success: true, data });
  } catch (error) {
    const statusCode = error.message === "currentVersion is required" || error.message === "Invalid currentVersion format"
      ? 400
      : 500;

    res.status(statusCode).json({
      success: false,
      message:
        statusCode === 400
          ? error.message
          : "Error checking app version",
      error: error.message,
    });
  }
});

module.exports = router;
