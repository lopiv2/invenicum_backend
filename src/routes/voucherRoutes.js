const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const voucherService = require("../services/voucherService");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Temporal } = require('@js-temporal/polyfill');

// process.cwd() en lugar de __dirname for coincidir with upload.js
const UPLOAD_DIR = path.resolve(process.cwd(),
    process.env.UPLOAD_FOLDER || "uploads/inventory", "vouchers");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Temporal.Now.instant().epochMilliseconds + "-" + Math.round(Math.random() * 1e9);
    cb(null, "global-logo-" + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// POST: Guardar configuración global
router.post("/voucher-config", verifyToken, upload.single("logo"), async (req, res) => {
  try {
    const { template } = req.body;
    const result = await voucherService.saveGlobalConfig(template, req.file);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET: get configuración global
router.get("/voucher-config", verifyToken, async (req, res) => {
  try {
    const result = await voucherService.getGlobalConfig();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
