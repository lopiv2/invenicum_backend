const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware'); // Middleware de autenticación
const dashboardDataService = require('../services/dashboardDataService'); // 🔑 Importamos el servicio de datos
const { Temporal } = require('@js-temporal/polyfill');

// Middleware de logging
router.use((req, res, next) => {
    const timestamp = Temporal.Now.plainDateISO().toString();
    console.log(`[DashboardRoutes - ${timestamp}] ${req.method} ${req.originalUrl}`);
    next();
});

// ------------------------------------------------------------------
// --- RUTA: GET Estadísticas Globales ---
// GET /api/v1/dashboard/stats
// ------------------------------------------------------------------

router.get('/stats', verifyToken, async (req, res) => {
    try {
        // En tu ejemplo de dataListRoutes, no se usa req.user.id para obtener todas las listas,
        // pero dado que el dashboard es información sensible, lo mantenemos accesible aquí
        // aunque el servicio actual no lo use.
        const userId = req.user.id; 

        // 🔑 LLAMADA DIRECTA AL SERVICIO DE DATOS
        const stats = await dashboardDataService.getGlobalStatsFromDb(userId);

        // Envía la respuesta en el formato esperado por Flutter (status 200 con 'data')
        res.status(200).json({
            success: true,
            message: "Estadísticas globales obtenidas con éxito.",
            data: stats, // Contiene { totalContainers: X, totalItems: Y, ... }
        });

    } catch (error) {
        console.error('Error al obtener estadísticas del dashboard:', error);
        
        // Manejo de errores basado en tu plantilla (500 Internal Server Error)
        // Puedes refinar esto para manejar errores 401/404 específicos si el servicio los lanza.
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor al cargar las estadísticas.',
            error: error.message,
        });
    }
});

module.exports = router;