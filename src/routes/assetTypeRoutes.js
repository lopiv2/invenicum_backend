// routes/assetTypeRoutes.js

const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const containerService = require('../services/containerService'); // Para verificar el contenedor
const assetTypeService = require('../services/assetTypeService'); // El nuevo servicio

// Middleware para logging (opcional)
router.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] AssetTypeRoutes - ${req.method} ${req.originalUrl}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('Body:', req.body);
    }
    next();
});

// --------------------------------------------------------------------
// C (Create) - Crear un nuevo Tipo de Activo (Anidado bajo contenedor)
// POST /containers/:containerId/asset-types
// --------------------------------------------------------------------
router.post('/containers/:containerId/asset-types', verifyToken, async (req, res) => {
    try {
        const containerId = parseInt(req.params.containerId);
        const userId = req.user.id;

        // 1. Verificación de propiedad del contenedor antes de crear
        const container = await containerService.getContainerById(containerId, userId);
        if (!container) {
            return res.status(404).json({ success: false, message: 'Contenedor no encontrado o acceso denegado.' });
        }

        // 2. Delegar la creación al servicio de AssetType
        const result = await assetTypeService.createAssetType(containerId, userId, req.body);
        
        if (result.success) {
            res.status(201).json(result);
        } else {
            res.status(400).json(result); 
        }

    } catch (error) {
        console.error("Error al crear Tipo de Activo:", error);
        res.status(500).json({ success: false, message: 'Error interno al crear el Tipo de Activo', error: error.message });
    }
});

// --------------------------------------------------------------------
// R (Read) - Obtener un único Tipo de Activo
// GET /asset-types/:id
// --------------------------------------------------------------------
router.get('/asset-types/:id', verifyToken, async (req, res) => {
    try {
        const assetTypeId = parseInt(req.params.id);
        const userId = req.user.id;

        // El servicio verifica la propiedad internamente
        const result = await assetTypeService.getAssetTypeById(assetTypeId, userId);

        if (result.success) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (error) {
        console.error("Error al obtener Tipo de Activo:", error);
        res.status(500).json({ success: false, message: 'Error interno al obtener el Tipo de Activo', error: error.message });
    }
});

// --------------------------------------------------------------------
// U (Update) - Actualizar un Tipo de Activo
// PUT /asset-types/:id
// --------------------------------------------------------------------
router.put('/asset-types/:id', verifyToken, async (req, res) => {
    try {
        const assetTypeId = parseInt(req.params.id);
        const userId = req.user.id;

        const result = await assetTypeService.updateAssetType(assetTypeId, userId, req.body);

        if (result.success) {
            res.json(result);
        } else {
            res.status(404).json(result); 
        }

    } catch (error) {
        console.error("Error al actualizar Tipo de Activo:", error);
        res.status(500).json({ success: false, message: 'Error interno al actualizar el Tipo de Activo', error: error.message });
    }
});

// --------------------------------------------------------------------
// D (Delete) - Eliminar un Tipo de Activo
// DELETE /asset-types/:id
// --------------------------------------------------------------------
router.delete('/asset-types/:id', verifyToken, async (req, res) => {
    try {
        const assetTypeId = parseInt(req.params.id);
        const userId = req.user.id;

        const result = await assetTypeService.deleteAssetType(assetTypeId, userId);

        if (result.success) {
            res.status(204).send(); // 204 No Content
        } else {
            res.status(404).json(result);
        }

    } catch (error) {
        console.error("Error al eliminar Tipo de Activo:", error);
        res.status(500).json({ success: false, message: 'Error interno al eliminar el Tipo de Activo', error: error.message });
    }
});


module.exports = router;