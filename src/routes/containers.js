const express = require('express');
const router = express.Router();
const containerService = require('../services/containerService');
const inventoryItemService = require('../services/inventoryItemService');

// Middleware para verificar que el usuario está autenticado
const authenticateUser = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
};

// Rutas para contenedores
router.get('/containers', authenticateUser, async (req, res) => {
    try {
        const containers = await containerService.getContainers(req.user.id);
        res.json(containers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/containers', authenticateUser, async (req, res) => {
    try {
        const container = await containerService.createContainer(req.user.id, req.body);
        res.status(201).json(container);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/containers/:id', authenticateUser, async (req, res) => {
    try {
        const container = await containerService.getContainerById(parseInt(req.params.id), req.user.id);
        if (!container) {
            return res.status(404).json({ error: 'Container not found' });
        }
        res.json(container);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/containers/:id', authenticateUser, async (req, res) => {
    try {
        const container = await containerService.updateContainer(parseInt(req.params.id), req.user.id, req.body);
        res.json(container);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/containers/:id', authenticateUser, async (req, res) => {
    try {
        await containerService.deleteContainer(parseInt(req.params.id), req.user.id);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rutas para elementos del inventario
router.get('/containers/:containerId/items', authenticateUser, async (req, res) => {
    try {
        // Verificar que el contenedor pertenece al usuario
        const container = await containerService.getContainerById(parseInt(req.params.containerId), req.user.id);
        if (!container) {
            return res.status(404).json({ error: 'Container not found' });
        }
        
        const items = await inventoryItemService.getItems(parseInt(req.params.containerId));
        res.json(items);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/containers/:containerId/items', authenticateUser, async (req, res) => {
    try {
        // Verificar que el contenedor pertenece al usuario
        const container = await containerService.getContainerById(parseInt(req.params.containerId), req.user.id);
        if (!container) {
            return res.status(404).json({ error: 'Container not found' });
        }

        const item = await inventoryItemService.createItem(parseInt(req.params.containerId), req.body);
        res.status(201).json(item);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/containers/:containerId/items/:id', authenticateUser, async (req, res) => {
    try {
        // Verificar que el contenedor pertenece al usuario
        const container = await containerService.getContainerById(parseInt(req.params.containerId), req.user.id);
        if (!container) {
            return res.status(404).json({ error: 'Container not found' });
        }

        const item = await inventoryItemService.updateItem(
            parseInt(req.params.id),
            parseInt(req.params.containerId),
            req.body
        );
        res.json(item);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/containers/:containerId/items/:id', authenticateUser, async (req, res) => {
    try {
        // Verificar que el contenedor pertenece al usuario
        const container = await containerService.getContainerById(parseInt(req.params.containerId), req.user.id);
        if (!container) {
            return res.status(404).json({ error: 'Container not found' });
        }

        await inventoryItemService.deleteItem(parseInt(req.params.id), parseInt(req.params.containerId));
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/containers/:containerId/items/:id/options', authenticateUser, async (req, res) => {
    try {
        // Verificar que el contenedor pertenece al usuario
        const container = await containerService.getContainerById(parseInt(req.params.containerId), req.user.id);
        if (!container) {
            return res.status(404).json({ error: 'Container not found' });
        }

        const item = await inventoryItemService.updateItemOptions(
            parseInt(req.params.id),
            parseInt(req.params.containerId),
            req.body
        );
        res.json(item);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;