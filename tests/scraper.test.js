require('dotenv').config();
const prisma = require('../src/middleware/prisma');
const scraperService = require('../src/services/scraperService');

async function main() {
  try {
    // Create or update a test scraper pointing to example.com
    let up = await prisma.scraper.findFirst({ where: { name: 'test-scraper' } });
    if (up) {
      up = await prisma.scraper.update({ where: { id: up.id }, data: { url: 'https://www.actionfigure411.com/masters-of-the-universe/mattel-classics/' } });
    } else {
      up = await prisma.scraper.create({ data: { name: 'test-scraper', url: 'https://www.actionfigure411.com/masters-of-the-universe/mattel-classics/' } });
    }

    // Remove existing fields and add an XPath field using substring-after on the item's page
    await prisma.scraperField.deleteMany({ where: { scraperId: up.id } });
    const xpathExpr = "normalize-space(substring-after(//h2[b='Year'], ':'))";
    await prisma.scraperField.create({ data: { name: 'year', xpath: xpathExpr, order: 0, scraperId: up.id } });

    // Run scrape by passing the specific item URL; service will fetch it if it belongs to the root
    const itemUrl = 'https://www.actionfigure411.com/masters-of-the-universe/mattel-classics/heroic-warriors/he-man-3992.php';
    console.log('Running scrape against item URL:', itemUrl);
    const result = await scraperService.runScrape(up.id, itemUrl);
    console.log('Scrape result:', result);
  } catch (e) {
    console.error('Test failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
