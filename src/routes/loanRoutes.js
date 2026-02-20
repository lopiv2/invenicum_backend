const express = require("express");
const router = express.Router();
const loanService = require("../services/loanService");
const authMiddleware = require("../middleware/authMiddleware");

// 🔒 Aplicar middleware de autenticación a todas las rutas
router.use(authMiddleware);

// Nota: Eliminamos formatLoanResponse y formatLoansResponse porque 
// el service ahora devuelve .toJSON() del LoanDTO.

/**
 * GET /api/v1/loans
 * Dashboard: Obtiene todos los préstamos del usuario
 */
router.get("/loans", async (req, res) => {
  try {
    const userId = req.user.id;
    const loans = await loanService.getAllLoans(userId);
    res.status(200).json(loans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/containers/:containerId/loans
 */
router.get("/containers/:containerId/loans", async (req, res) => {
  try {
    const { containerId } = req.params;
    console.log("hola contenedor")
    const loans = await loanService.getLoans(containerId);
    res.status(200).json(loans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/containers/:containerId/loans
 */
router.post("/containers/:containerId/loans", async (req, res) => {
  try {
    const { containerId } = req.params;
    const userId = req.user.id; // 🔑 Extraemos el userId del token
    
    // Pasamos userId por separado para asegurar la propiedad
    const newLoan = await loanService.createLoan(containerId, req.body, userId);
    res.status(201).json(newLoan);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/containers/:containerId/loans/:loanId/return
 */
router.put("/containers/:containerId/loans/:loanId/return", async (req, res) => {
  try {
    const { containerId, loanId } = req.params;
    const userId = req.user.id;

    const returnedLoan = await loanService.returnLoan(containerId, loanId, userId);
    res.status(200).json(returnedLoan);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/containers/:containerId/loans/:loanId
 * Actualización general del préstamo
 */
router.put("/containers/:containerId/loans/:loanId", async (req, res) => {
  try {
    const { containerId, loanId } = req.params;
    const userId = req.user.id;

    const updatedLoan = await loanService.updateLoan(containerId, loanId, req.body, userId);
    res.status(200).json(updatedLoan);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/containers/:containerId/loans/:loanId
 */
router.delete("/containers/:containerId/loans/:loanId", async (req, res) => {
  try {
    const { loanId } = req.params;
    const userId = req.user.id;

    const result = await loanService.deleteLoan(loanId, userId);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/v1/containers/:containerId/loans-stats
 */
router.get("/containers/:containerId/loans-stats", async (req, res) => {
  try {
    const { containerId } = req.params;
    const userId = req.user.id;

    const stats = await loanService.getLoanStats(containerId, userId);
    res.status(200).json(stats);
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
});

module.exports = router;