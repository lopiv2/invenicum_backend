const prisma = require('../middleware/prisma');

//npm run seed:achievements

const achievements = [
  // --- COLLECTION ---
  { id: 'firstItem',      title: 'Welcome to the Mansion', description: 'Add your first item',           icon: 'home_repair_service_outlined', category: 'collection', eventType: 'ITEM_CREATED',        requiredValue: 1  },
  { id: 'catalogerSmall', title: 'Small Warehouse',        description: 'Register 10 items',             icon: 'inventory_2_outlined',         category: 'collection', eventType: 'ITEM_CREATED',        requiredValue: 10 },
  { id: 'catalogerMedium',title: 'Museum Curator',         description: 'Register 50 items',             icon: 'account_balance_outlined',     category: 'collection', eventType: 'ITEM_CREATED',        requiredValue: 50 },
  { id: 'catalogerLarge', title: 'Owner of an Empire',     description: 'Register 200 items',            icon: 'fort_outlined',                category: 'collection', eventType: 'ITEM_CREATED',        requiredValue: 200, isLegendary: true },
  { id: 'orderMaster',    title: 'Absolute Order',         description: 'Assign location to 20 items',   icon: 'shelves',                      category: 'collection', eventType: 'ITEM_WITH_LOCATION',  requiredValue: 20 },

  // --- MARKET ---
  { id: 'eyeForValue',    title: 'Eye for Value',          description: 'Register price of 5 items',     icon: 'visibility_outlined',          category: 'market',     eventType: 'PRICE_REGISTERED',    requiredValue: 5  },
  { id: 'firstGrail',     title: 'First Grail',            description: 'Item worth more than 100€',     icon: 'workspace_premium_outlined',   category: 'market',     eventType: 'ITEM_VALUE_HIGH',     requiredValue: 100,  extraConfig: { mode: 'threshold' } },
  { id: 'museumPiece',    title: 'Museum Piece',           description: 'Item worth more than 500€',     icon: 'diamond_outlined',             category: 'market',     eventType: 'ITEM_VALUE_HIGH',     requiredValue: 500,  extraConfig: { mode: 'threshold' }, isLegendary: true },
  { id: 'growingWealth',  title: 'Growing Wealth',         description: 'Inventory exceeds 1,000€',      icon: 'trending_up_rounded',          category: 'market',     eventType: 'INVENTORY_VALUE',     requiredValue: 1000, extraConfig: { mode: 'marketValue' } },
  { id: 'wallStreetWolf', title: 'Wall Street Wolf',       description: 'Inventory exceeds 10,000€',     icon: 'query_stats_rounded',          category: 'market',     eventType: 'INVENTORY_VALUE',     requiredValue: 10000,extraConfig: { mode: 'marketValue' }, isLegendary: true },
  { id: 'bargainHunter',  title: 'Bargain Hunter',         description: 'Item worth double purchase',    icon: 'auto_graph_rounded',           category: 'market',     eventType: 'ITEM_VALUE_DOUBLED',  requiredValue: 1  },

  // --- LOANS ---
  { id: 'blindTrust',     title: 'Blind Trust',            description: 'Make your first loan',          icon: 'handshake_outlined',           category: 'loans',      eventType: 'LOAN_CREATED',        requiredValue: 1  },
  { id: 'librarian',      title: 'Librarian',              description: '3 active loans simultaneously', icon: 'menu_book_rounded',            category: 'loans',      eventType: 'ACTIVE_LOANS_COUNT',  requiredValue: 3,    extraConfig: { mode: 'snapshot' } },
  { id: 'allInOrder',     title: 'All in Order',           description: 'Return a loaned item',          icon: 'assignment_turned_in_outlined',category: 'loans',      eventType: 'LOAN_RETURNED',       requiredValue: 1  },
  { id: 'legendaryLender',title: 'Legendary Lender',       description: 'Complete 20 loans',             icon: 'verified_user_outlined',       category: 'loans',      eventType: 'LOAN_RETURNED',       requiredValue: 20, isLegendary: true },

  // --- TOOLS ---
  { id: 'cyberCollector', title: 'Cyber Collector',        description: 'Use AI for the first time',     icon: 'psychology_outlined',          category: 'tools',      eventType: 'AI_USED',             requiredValue: 1  },
  { id: 'hawkEye',        title: 'Hawk Eye',               description: 'Use AI to identify 15 items',  icon: 'camera_enhance_outlined',      category: 'tools',      eventType: 'AI_USED',             requiredValue: 15 },
  { id: 'polyglot',       title: 'Polyglot',               description: 'Change global currency',        icon: 'currency_exchange_rounded',    category: 'tools',      eventType: 'CURRENCY_CHANGED',    requiredValue: 1  },
  { id: 'forecaster',     title: 'Forecaster',             description: 'Activate 3 maintenance alerts', icon: 'fmd_bad_outlined',             category: 'tools',      eventType: 'MAINTENANCE_ACTIVATED',requiredValue: 3 },
  { id: 'masterUser',     title: 'Master User',            description: 'Customize notification order',  icon: 'reorder_rounded',              category: 'tools',      eventType: 'NOTIFICATION_REORDERED',requiredValue: 1 },
];

async function seed() {
  for (const a of achievements) {
    await prisma.achievement.upsert({
      where: { id: a.id },
      update: a,
      create: a,
    });
  }
  console.log(`Seeded ${achievements.length} achievements`);
}

seed().catch(console.error).finally(() => prisma.$disconnect());