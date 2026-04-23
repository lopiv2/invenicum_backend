const express = require('express');
const router = express.Router();
const scraperModel = require('../models/scraperModel');
const scraperService = require('../services/scraperService');

router.post('/', async (req, res) => {
  try {
    // Use service to create scraper and nested fields atomically
    const { name, url, urlPattern, containerId, fields } = req.body;
    const s = await scraperService.createScraperWithFields({ name, url, urlPattern, containerId, fields });
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const list = await scraperModel.listScrapers();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id/fields', async (req, res) => {
  try {
    const { name, xpath, order } = req.body;
    const f = await scraperModel.addField(req.params.id, { name, xpath, order });
    res.json(f);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/run', async (req, res) => {
  try {
    const { url } = req.query;
    const data = await scraperService.runScrape(req.params.id, url);
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/run-ad-hoc', async (req, res) => {
  try {
    const { name, url, urlPattern, fields } = req.body;
    // fields: [{ name, xpath, order }, ...]
    const data = await scraperService.runAdHoc({ name, url, urlPattern, fields });
    return res.json({ data });
  } catch (e) {
    console.error('run-ad-hoc error', e);
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
});

// Update scraper and optionally replace its fields
router.put('/:id', async (req, res) => {
  try {
    const payload = req.body || {};
    const updated = await scraperService.updateScraperWithFields(req.params.id, payload);
    res.json({ data: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a scraper and its fields
router.delete('/:id', async (req, res) => {
  try {
    await scraperService.deleteScraper(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
