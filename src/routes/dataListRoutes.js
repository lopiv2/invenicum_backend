const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const dataListService = require("../services/dataListService");
const { Temporal } = require('@js-temporal/polyfill');

// Middleware de logging
router.use((req, res, next) => {
    const timestamp = Temporal.Now.plainDateISO().toString();
    console.log(`[DataListRoutes - ${timestamp}] ${req.method} ${req.originalUrl}`);
    next();
});

// get todas the listas de data de a container
router.get("/containers/:containerId/datalists", verifyToken, async (req, res) => {
    try {
        const containerId = parseInt(req.params.containerId);
        const userId = req.user.id;

        if (isNaN(containerId)) {
            return res.status(400).json({
                success: false,
                message: "ID de contenedor inválido"
            });
        }

        const result = await dataListService.getDataListsByContainer(containerId, userId);

        if (result.success) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (error) {
        console.error("Error al obtener listas de datos:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Create a new lista de data
router.post("/containers/:containerId/datalists", verifyToken, async (req, res) => {
    try {
        const containerId = parseInt(req.params.containerId);
        const userId = req.user.id;

        if (isNaN(containerId)) {
            return res.status(400).json({
                success: false,
                message: "ID de contenedor inválido"
            });
        }

        const result = await dataListService.createDataList(containerId, userId, req.body);

        if (result.success) {
            res.status(201).json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (error) {
        console.error("Error al crear lista de datos:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// get a lista de data específica
router.get("/datalists/:id", verifyToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const userId = req.user.id;

        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: "ID de lista inválido"
            });
        }

        const result = await dataListService.getDataList(id, userId);

        if (result.success) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (error) {
        console.error("Error al obtener lista de datos:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// update a lista de data
router.put("/datalists/:id", verifyToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const userId = req.user.id;

        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: "ID de lista inválido"
            });
        }

        const result = await dataListService.updateDataList(id, userId, req.body);

        if (result.success) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (error) {
        console.error("Error al actualizar lista de datos:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// delete a lista de data
router.delete("/datalists/:id", verifyToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const userId = req.user.id;

        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: "ID de lista inválido"
            });
        }

        const result = await dataListService.deleteDataList(id, userId);

        if (result.success) {
            res.status(204).send();
        } else {
            res.status(404).json(result);
        }
    } catch (error) {
        console.error("Error al eliminar lista de datos:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
