const axios = require('axios');
const prisma = require("../middleware/prisma");
const IntegrationDTO = require('../models/integrationModel');
const EbayMarketDataDTO = require('../models/ebayMarketDataModel');

class EbayService {
  /**
   * MÉTODO PRINCIPAL: Coordina todo the flujo
   */
  async getMarketDataForUser(userId, keywords) {
    // 1. the service gestiona the BBDD
    const integrationRecord = await prisma.userIntegration.findUnique({
      where: { userId_type: { userId: parseInt(userId), type: 'ebay' } }
    });

    if (!integrationRecord || !integrationRecord.isActive) {
      throw new Error('Integración de eBay no configurada o inactiva');
    }

    // 2. Limpieza de config vía DTO
    const integration = new IntegrationDTO(integrationRecord);

    // 3. get Token de eBay
    const token = await this._getApplicationToken(integration.config);
    
    // 4. Consultar eBay
    const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
      params: { q: keywords, limit: 10 },
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_ES'
      }
    });

    // 5. Devolver the DTO procesado
    return new EbayMarketDataDTO({ ...response.data, _keywords: keywords });
  }

  /**
   * Lógica interna de autenticación (Privada)
   */
  async _getApplicationToken(config) {
    const { clientId, clientSecret } = config;
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await axios.post(
      'https://api.ebay.com/identity/v1/oauth2/token',
      'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${authHeader}`,
        },
      }
    );
    return response.data.access_token;
  }
}

module.exports = new EbayService();
