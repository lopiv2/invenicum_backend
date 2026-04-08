const prisma = require("../middleware/prisma");
const alertService = require("./alertService");
const LoanDTO = require("../models/loanModel");
const { Temporal } = require('@js-temporal/polyfill');

class LoanService {
  /**
   * Maps Prisma results to DTOs
   */
  _mapToDTO(loan) {
    if (!loan) return null;
    return new LoanDTO(loan).toJSON();
  }

  /**
   * gets todos the loans de a container
   */
  async getLoans(containerId) {
    try {
      const loans = await prisma.loan.findMany({
        where: { containerId: parseInt(containerId) },
        orderBy: { loanDate: "desc" },
      });

      return loans.map(this._mapToDTO); // 👈 Simplified with DTO
    } catch (error) {
      console.error("Error in getLoans:", error);
      throw new Error(`Error getting loans: ${error.message}`);
    }
  }

  /**
   * Gets a specific loan
   */
  async getLoan(containerId, loanId) {
    try {
      const loan = await prisma.loan.findUnique({
        where: {
          id: parseInt(loanId),
        },
        include: {
          inventoryItem: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
          container: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!loan) {
        throw new Error("Loan not found");
      }

      // Verify that the loan belongs to the specified container
      if (loan.containerId !== parseInt(containerId)) {
        throw new Error("The loan does not belong to this container");
      }

      return loan;
    } catch (error) {
      console.error("Error in getLoan:", error);
      throw new Error(`Error getting the loan: ${error.message}`);
    }
  }

  /**
   * Gets all global loans filtered by userId
   * Now uses l.userId directly thanks to the new relationship
   */
  async getAllLoans(userId) {
    try {
      const loans = await prisma.loan.findMany({
        where: { userId: parseInt(userId) }, // 🔑 Seguridad directa
        orderBy: { loanDate: "desc" },
      });
      return loans.map(this._mapToDTO);
    } catch (error) {
      console.error("Error in getAllLoans:", error);
      throw new Error("Error fetching global loans");
    }
  }

  /**
   * Create a new loan with validación de stock and alertas
   */
  async createLoan(containerId, loanData, userId) {
    try {
      const { inventoryItemId, quantity, expectedReturnDate } = loanData;
      const containerId_int = parseInt(containerId);
      const inventoryItemId_int = parseInt(inventoryItemId);
      const quantityToLoan = parseInt(quantity || 1);

      // 1. Validar artículo and stock
      const inventoryItem = await prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId_int },
      });

      if (!inventoryItem || inventoryItem.containerId !== containerId_int) {
        throw new Error("Artículo no válido para este contenedor");
      }

      if (inventoryItem.quantity < quantityToLoan) {
        throw new Error(`Stock insuficiente (${inventoryItem.quantity} disp.)`);
      }

      // 2. Transacción Atómica
      const result = await prisma.$transaction(async (tx) => {
        // A. Create loan (DTO de entrada)
        const loan = await tx.loan.create({
          data: {
            userId: parseInt(userId), // 🔑 Asignación obligatoria
            containerId: containerId_int,
            inventoryItemId: inventoryItemId_int,
            quantity: quantityToLoan,
            itemName: inventoryItem.name,
            borrowerName: loanData.borrowerName || null,
            borrowerEmail: loanData.borrowerEmail || null,
            borrowerPhone: loanData.borrowerPhone || null,
            loanDate: new Date(Temporal.Now.instant().epochMilliseconds), // Fecha actual by default
            expectedReturnDate: expectedReturnDate
              ? new Date(expectedReturnDate)
              : null,
            notes: loanData.notes || null,
            status: "active",
          },
        });

        // B. Decrementar stock
        const updatedItem = await tx.inventoryItem.update({
          where: { id: inventoryItemId_int },
          data: { quantity: { decrement: quantityToLoan } },
        });

        // C. Alerta de Stock Bajo
        await alertService.checkAndNotifyLowStock(userId, updatedItem);

        return loan;
      });

      return this._mapToDTO(result);
    } catch (error) {
      throw new Error(error.message);
    }
  }

  /**
   * updates a loan existente
   */
  /**
   * updates a loan existente de forma segura
   */
  async updateLoan(containerId, loanId, loanData, userId) {
    try {
      const loanId_int = parseInt(loanId);
      const userId_int = parseInt(userId);

      // 1. We verify existencia and propiedad en a sola consulta
      const existingLoan = await prisma.loan.findFirst({
        where: {
          id: loanId_int,
          userId: userId_int, // 🔑 Seguridad: only el dueño puede editar
        },
      });

      if (!existingLoan)
        throw new Error("Préstamo no encontrado o acceso denegado");

      // 2. Limpieza de data (DTO de entrada "ad-hoc")
      // only extraemos the campos que permitimos editar
      const {
        borrowerName,
        borrowerEmail,
        borrowerPhone,
        expectedReturnDate,
        notes,
        status,
      } = loanData;

      // 3. Actualización directa
      const updatedLoan = await prisma.loan.update({
        where: { id: loanId_int },
        data: {
          borrowerName:
            borrowerName !== undefined
              ? borrowerName
              : existingLoan.borrowerName,
          borrowerEmail:
            borrowerEmail !== undefined
              ? borrowerEmail
              : existingLoan.borrowerEmail,
          borrowerPhone:
            borrowerPhone !== undefined
              ? borrowerPhone
              : existingLoan.borrowerPhone,
          notes: notes !== undefined ? notes : existingLoan.notes,
          status: status || existingLoan.status,
          // Manejo de fechas simplificado: Temporal.Now.zonedDateTimeISO() entiende ISO strings
          expectedReturnDate: expectedReturnDate
            ? new Date(expectedReturnDate)
            : existingLoan.expectedReturnDate,
        },
      });

      // 4. Retornamos mediante the DTO de salida
      return this._mapToDTO(updatedLoan);
    } catch (error) {
      console.error("Error in updateLoan:", error);
      throw new Error(error.message);
    }
  }

  /**
   * Marca como devuelto e incrementa stock
   */
  async returnLoan(containerId, loanId, userId) {
    try {
      const loan = await prisma.loan.findFirst({
        where: {
          id: parseInt(loanId),
          userId: parseInt(userId), // 🔑 only el dueño puede devolverlo
        },
      });

      if (!loan || loan.status === "returned") {
        throw new Error("Préstamo no encontrado o ya devuelto");
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.inventoryItem.update({
          where: { id: loan.inventoryItemId },
          data: { quantity: { increment: loan.quantity } },
        });

        return await tx.loan.update({
          where: { id: loan.id },
          data: {
            status: "returned",
            actualReturnDate: new Date(Temporal.Now.instant().epochMilliseconds),
          },
        });
      });

      return this._mapToDTO(result);
    } catch (error) {
      throw new Error(error.message);
    }
  }

  /**
   * deletes a loan (only if es the dueño)
   */
  async deleteLoan(loanId, userId) {
    try {
      await prisma.loan.deleteMany({
        where: {
          id: parseInt(loanId),
          userId: parseInt(userId),
        },
      });
      return { success: true };
    } catch (error) {
      throw new Error("No se pudo eliminar el préstamo");
    }
  }

  /**
   * gets estadísticas de loans
   */
  async getLoanStats(containerId, userId) {
    try {
      const containerId_int = parseInt(containerId);
      const userId_int = parseInt(userId);

      // 1. We verify que the container pertenezca al use (security)
      const container = await prisma.container.findFirst({
        where: { id: containerId_int, userId: userId_int },
      });
      if (!container)
        throw new Error("Contenedor no encontrado o acceso denegado");

      // 2. a sola consulta for agrupar todos the conteos por status
      const stats = await prisma.loan.groupBy({
        by: ["status"],
        where: { containerId: containerId_int },
        _count: { id: true },
      });

      // 3. Formateamos the resultado (DTO style)
      const counts = {
        active: 0,
        returned: 0,
        overdue: 0,
        total: 0,
      };

      stats.forEach((item) => {
        const status = item.status;
        const count = item._count.id;
        if (counts.hasOwnProperty(status)) {
          counts[status] = count;
        }
        counts.total += count;
      });

      return {
        totalLoans: counts.total,
        activeLoans: counts.active,
        returnedLoans: counts.returned,
        overdueLoans: counts.overdue,
      };
    } catch (error) {
      console.error("Error in getLoanStats:", error);
      throw new Error(error.message);
    }
  }
}

module.exports = new LoanService();
