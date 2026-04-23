const prisma = require('../middleware/prisma');

module.exports = {
  createScraper: async ({ name, url, urlPattern }) =>
    prisma.scraper.create({ data: { name, url, urlPattern } }),

  getScraper: async (id) =>
    prisma.scraper.findUnique({ where: { id: Number(id) }, include: { fields: true, container: true } }),

  listScrapers: async () =>
    prisma.scraper.findMany({ include: { fields: true, container: true } }),

  createScraper: async ({ name, url, urlPattern, containerId }) =>
    prisma.scraper.create({ data: { name, url, urlPattern, containerId: containerId ? Number(containerId) : undefined } }),

  addField: async (scraperId, { name, xpath, order }) =>
    prisma.scraperField.create({
      data: { name, xpath, order: order || 0, scraperId: Number(scraperId) },
    }),
};
