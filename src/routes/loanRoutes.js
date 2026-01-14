const express = require("express");
const router = express.Router();
const LoanService = require("../services/loanService");
const authMiddleware = require("../middleware/authMiddleware");

const loanService = new LoanService();

// 🔒 Aplicar middleware de autenticación a todas las rutas
router.use(authMiddleware);

/**
 * Formatea un préstamo para la respuesta JSON
 * Convierte las fechas a ISO8601 string
 */
function formatLoanResponse(loan) {
  if (!loan) return null;
  
  return {
    ...loan,
    loanDate: loan.loanDate ? loan.loanDate.toISOString() : null,
    expectedReturnDate: loan.expectedReturnDate ? loan.expectedReturnDate.toISOString() : null,
    actualReturnDate: loan.actualReturnDate ? loan.actualReturnDate.toISOString() : null,
    createdAt: loan.createdAt ? loan.createdAt.toISOString() : null,
    updatedAt: loan.updatedAt ? loan.updatedAt.toISOString() : null,
  };
}

/**
 * Formatea una lista de préstamos
 */
function formatLoansResponse(loans) {
  return loans.map(loan => formatLoanResponse(loan));
}

/**
 * GET /api/v1/containers/:containerId/loans
 * Obtiene todos los préstamos de un contenedor
 */
router.get("/containers/:containerId/loans", async (req, res) => {
  try {
    const { containerId } = req.params;
    const loans = await loanService.getLoans(containerId);
    res.status(200).json(formatLoansResponse(loans));
  } catch (error) {
    console.error("Error fetching loans:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/containers/:containerId/loans/:loanId
 * Obtiene un préstamo específico
 */
router.get("/containers/:containerId/loans/:loanId", async (req, res) => {
  try {
    const { containerId, loanId } = req.params;
    const loan = await loanService.getLoan(containerId, loanId);
    res.status(200).json(formatLoanResponse(loan));
  } catch (error) {
    console.error("Error fetching loan:", error);
    res.status(404).json({ error: error.message });
  }
});

/**
 * POST /api/v1/containers/:containerId/loans
 * Crea un nuevo préstamo
 */
router.post("/containers/:containerId/loans", async (req, res) => {
  try {
    const { containerId } = req.params;
    const loanData = req.body;

    const newLoan = await loanService.createLoan(containerId, loanData);
    res.status(201).json(formatLoanResponse(newLoan));
  } catch (error) {
    console.error("Error creating loan:", error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/containers/:containerId/loans/:loanId/return
 * Marca un préstamo como devuelto
 */
router.put(
  "/containers/:containerId/loans/:loanId/return",
  async (req, res) => {
    try {
      const { containerId, loanId } = req.params;
      const returnedLoan = await loanService.returnLoan(containerId, loanId);
      res.status(200).json(formatLoanResponse(returnedLoan));
    } catch (error) {
      console.error("Error returning loan:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * DELETE /api/v1/containers/:containerId/loans/:loanId
 * Elimina un préstamo
 */
router.delete("/containers/:containerId/loans/:loanId", async (req, res) => {
  try {
    const { containerId, loanId } = req.params;
    const result = await loanService.deleteLoan(containerId, loanId);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error deleting loan:", error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/v1/containers/:containerId/loans/stats
 * Obtiene estadísticas de préstamos
 */
router.get("/containers/:containerId/loans-stats", async (req, res) => {
  try {
    const { containerId } = req.params;
    const stats = await loanService.getLoanStats(containerId);
    res.status(200).json(stats);
  } catch (error) {
    console.error("Error fetching loan stats:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
