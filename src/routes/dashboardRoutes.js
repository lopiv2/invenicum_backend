const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware'); // Middleware de autenticación
const dashboardDataService = require('../services/dashboardDataService'); // 🔑 Importamos el servicio de data
const { Temporal } = require('@js-temporal/polyfill');

// Middleware de logging
router.use((req, res, next) => {
    const timestamp = Temporal.Now.plainDateISO().toString();
    console.log(`[DashboardRoutes - ${timestamp}] ${req.method} ${req.originalUrl}`);
    next();
});

// ------------------------------------------------------------------
// --- route: GET Estadísticas global ---
// GET /api/v1/dashboard/stats
// ------------------------------------------------------------------

router.get('/stats', verifyToken, async (req, res) => {
    try {
        // En tu ejemplo de dataListRoutes, no se Use req.Use.id for get todas the listas,
        // pero dado que the dashboard es información sensible, lo mantenemos accesible aquí
        // aunque the service actual no lo Use.
        const userId = req.user.id; 

        // 🔑 call DIRECTA AL service DE data
        const stats = await dashboardDataService.getGlobalStatsFromDb(userId);

        // Envía the Response en the formato esperado por Flutter (status 200 with 'data')
        res.status(200).json({
            success: true,
            message: "Estadísticas globales obtenidas con éxito.",
            data: stats, // Contiene { totalContainers: X, totalItems: Y, ... }
        });

    } catch (error) {
        console.error('Error al obtener estadísticas del dashboard:', error);
        
        // Manejo de errores basado en tu plantilla (500 Internal Server Error)
        // Puedes refinar esto for manejar errores 401/404 específicos if the service the lanza.
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor al cargar las estadísticas.',
            error: error.message,
        });
    }
});

module.exports = router;
