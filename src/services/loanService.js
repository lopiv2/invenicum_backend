const prisma = require("../middleware/prisma");
const alertService = require("./alertService");

/**
 * Convierte una fecha string ISO8601 a un objeto Date
 * Maneja correctamente las fechas sin hora (YYYY-MM-DD)
 */
function parseDate(dateString) {
  if (!dateString) return null;

  // Si ya es un objeto Date, devolverlo
  if (dateString instanceof Date) {
    return dateString;
  }

  // Convertir string a Date
  const date = new Date(dateString);

  // Validar que es una fecha válida
  if (isNaN(date.getTime())) {
    throw new Error(`Formato de fecha inválido: ${dateString}`);
  }

  return date;
}

class LoanService {
  /**
   * Obtiene todos los préstamos de un contenedor
   */
  async getLoans(containerId) {
    try {
      const loans = await prisma.loan.findMany({
        where: {
          containerId: parseInt(containerId),
        },
        include: {
          inventoryItem: {
            select: {
              id: true,
              name: true,
            },
          },
          container: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          loanDate: "desc",
        },
      });

      return loans;
    } catch (error) {
      console.error("Error in getLoans:", error);
      throw new Error(`Error al obtener préstamos: ${error.message}`);
    }
  }

  /**
   * Obtiene un préstamo específico
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
        throw new Error("Préstamo no encontrado");
      }

      // Verificar que el préstamo pertenece al contenedor especificado
      if (loan.containerId !== parseInt(containerId)) {
        throw new Error("El préstamo no pertenece a este contenedor");
      }

      return loan;
    } catch (error) {
      console.error("Error in getLoan:", error);
      throw new Error(`Error al obtener el préstamo: ${error.message}`);
    }
  }

  /**
   * Obtiene todos los préstamos de forma global para un usuario
   * Útil para el Dashboard
   */
  async getAllLoans(userId) {
    try {
      const loans = await prisma.loan.findMany({
        where: {
          // Filtramos para que solo vea préstamos de sus contenedores
          container: {
            userId: parseInt(userId),
          },
        },
        include: {
          inventoryItem: { select: { id: true, name: true } },
          container: { select: { id: true, name: true } },
        },
        orderBy: {
          loanDate: "desc",
        },
      });
      return loans;
    } catch (error) {
      console.error("Error in getAllLoans:", error);
      throw new Error(`Error al obtener préstamos globales: ${error.message}`);
    }
  }

  /**
   * Crea un nuevo préstamo
   */
  async createLoan(containerId, loanData) {
    try {
      const {
        inventoryItemId,
        itemName,
        borrowerName,
        borrowerEmail,
        borrowerPhone,
        loanDate,
        expectedReturnDate,
        notes,
        quantity, // 👈 Ahora recibimos la cantidad desde el frontend
        userId, // 👈 Necesitamos el userId para crear la alerta
      } = loanData;

      const containerId_int = parseInt(containerId);
      const inventoryItemId_int = parseInt(inventoryItemId);
      const quantityToLoan = parseInt(quantity || 1); // Por defecto 1 si no viene

      // 1. Buscamos el artículo para validar stock y pertenencia
      const inventoryItem = await prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId_int },
        include: {
          assetType: {
            select: { id: true, isSerialized: true },
          },
        },
      });

      if (!inventoryItem)
        throw new Error("Artículo de inventario no encontrado");
      if (inventoryItem.containerId !== containerId_int) {
        throw new Error("El artículo no pertenece a este contenedor");
      }

      // 2. Validar si hay stock suficiente
      if (inventoryItem.quantity < quantityToLoan) {
        throw new Error(
          `Stock insuficiente. Disponible: ${inventoryItem.quantity}`,
        );
      }

      // 3. Ejecutar todo en una Transacción Atómica
      return await prisma.$transaction(async (tx) => {
        // A. Crear el registro del Préstamo
        const loan = await tx.loan.create({
          data: {
            containerId: containerId_int,
            inventoryItemId: inventoryItemId_int,
            quantity: quantityToLoan, // 👈 Guardamos la cantidad prestada
            itemName: itemName || inventoryItem.name,
            borrowerName: borrowerName || null,
            borrowerEmail: borrowerEmail || null,
            borrowerPhone: borrowerPhone || null,
            loanDate: parseDate(loanDate) || new Date(),
            expectedReturnDate: expectedReturnDate
              ? parseDate(expectedReturnDate)
              : null,
            notes: notes || null,
            status: "active",
          },
          include: {
            inventoryItem: { select: { id: true, name: true } },
            container: { select: { id: true, name: true } },
          },
        });

        // B. Actualizar stock en el inventario
        const updatedItem = await tx.inventoryItem.update({
          where: { id: inventoryItemId_int },
          data: {
            quantity: {
              decrement: quantityToLoan, // 👈 Resta automáticamente la cantidad
            },
          },
        });

        // C. 🚨 Lógica de Alerta de Stock Bajo
        // Comparamos el nuevo stock con el mínimo definido en el artículo
        const minAllowed = updatedItem.minStock || 1; // Por defecto 1 si no tiene definido

        if (updatedItem.quantity <= minAllowed && userId) {
          await alertService.createAlert(parseInt(userId), {
            title: "⚠️ Stock Bajo Detectado",
            message: `El artículo "${updatedItem.name}" ha bajado a ${updatedItem.quantity} unidades tras el último préstamo.`,
            type: "warning",
          });
          console.log(
            `[ALERT] Generada alerta de stock bajo para Item ID: ${updatedItem.id}`,
          );
        }

        console.log(
          `[DEBUG] Préstamo ID ${loan.id} creado. Cantidad prestada: ${quantityToLoan}. Stock restante: ${updatedItem.quantity}`,
        );

        return loan;
      });
    } catch (error) {
      console.error("Error in createLoan:", error);
      throw new Error(error.message);
    }
  }

  /**
   * Actualiza un préstamo existente
   */
  async updateLoan(containerId, loanId, loanData) {
    try {
      const loanId_int = parseInt(loanId);
      const containerId_int = parseInt(containerId);

      // Verificar que el préstamo existe y pertenece al contenedor
      const existingLoan = await prisma.loan.findUnique({
        where: {
          id: loanId_int,
        },
      });

      if (!existingLoan) {
        throw new Error("Préstamo no encontrado");
      }

      if (existingLoan.containerId !== containerId_int) {
        throw new Error("El préstamo no pertenece a este contenedor");
      }

      // Si se proporciona un inventoryItemId diferente, validar que existe y pertenece al contenedor
      if (
        loanData.inventoryItemId &&
        loanData.inventoryItemId !== existingLoan.inventoryItemId
      ) {
        const newItem = await prisma.inventoryItem.findUnique({
          where: {
            id: parseInt(loanData.inventoryItemId),
          },
        });

        if (!newItem) {
          throw new Error("Nuevo artículo de inventario no encontrado");
        }

        if (newItem.containerId !== containerId_int) {
          throw new Error("El nuevo artículo no pertenece a este contenedor");
        }
      }

      // Preparar datos para actualizar
      const updateData = { ...loanData };

      // Procesar fechas correctamente
      if (loanData.loanDate !== undefined && loanData.loanDate !== null) {
        updateData.loanDate = parseDate(loanData.loanDate);
      }

      if (loanData.expectedReturnDate !== undefined) {
        if (loanData.expectedReturnDate === null) {
          updateData.expectedReturnDate = null;
        } else {
          updateData.expectedReturnDate = parseDate(
            loanData.expectedReturnDate,
          );
        }
      }

      if (loanData.actualReturnDate !== undefined) {
        if (loanData.actualReturnDate === null) {
          updateData.actualReturnDate = null;
        } else {
          updateData.actualReturnDate = parseDate(loanData.actualReturnDate);
        }
      }

      // Si se proporciona inventoryItemId, actualizar también itemName si no se proporciona explícitamente
      if (
        loanData.inventoryItemId &&
        !loanData.itemName &&
        loanData.inventoryItemId !== existingLoan.inventoryItemId
      ) {
        const newItem = await prisma.inventoryItem.findUnique({
          where: {
            id: parseInt(loanData.inventoryItemId),
          },
        });
        updateData.itemName = newItem.name;
      }

      const updatedLoan = await prisma.loan.update({
        where: {
          id: loanId_int,
        },
        data: updateData,
        include: {
          inventoryItem: {
            select: {
              id: true,
              name: true,
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

      return updatedLoan;
    } catch (error) {
      console.error("Error in updateLoan:", error);
      throw new Error(`Error al actualizar préstamo: ${error.message}`);
    }
  }

  /**
   * Marca un préstamo como devuelto
   */
  async returnLoan(containerId, loanId) {
    try {
      const loanId_int = parseInt(loanId);
      const containerId_int = parseInt(containerId);

      // 1. Buscar el préstamo y su ítem asociado
      const existingLoan = await prisma.loan.findUnique({
        where: { id: loanId_int },
        include: {
          inventoryItem: true,
        },
      });

      if (!existingLoan) throw new Error("Préstamo no encontrado");
      if (existingLoan.containerId !== containerId_int) {
        throw new Error("El préstamo no pertenece a este contenedor");
      }
      if (existingLoan.status === "returned") {
        throw new Error("Este préstamo ya fue devuelto anteriormente");
      }

      // 2. Ejecutar actualización en una transacción para asegurar integridad
      const result = await prisma.$transaction(async (tx) => {
        // A. Actualizar el stock del ítem: Sumamos la cantidad exacta que se prestó
        const updatedItem = await tx.inventoryItem.update({
          where: { id: existingLoan.inventoryItemId },
          data: {
            quantity: {
              increment: existingLoan.quantity, // 🔑 Incremento automático atómico
            },
          },
        });

        // B. Marcar el préstamo como devuelto
        const returnedLoan = await tx.loan.update({
          where: { id: loanId_int },
          data: {
            status: "returned",
            actualReturnDate: new Date(),
          },
          include: {
            inventoryItem: {
              select: { id: true, name: true },
            },
            container: {
              select: { id: true, name: true },
            },
          },
        });

        console.log(
          `[STOCK] Item ${existingLoan.inventoryItemId} incrementado en ${existingLoan.quantity}. Nuevo stock: ${updatedItem.quantity}`,
        );

        return returnedLoan;
      });

      return result;
    } catch (error) {
      console.error("Error in returnLoan:", error);
      throw new Error(`Error al devolver préstamo: ${error.message}`);
    }
  }

  /**
   * Elimina un préstamo
   */
  async deleteLoan(containerId, loanId) {
    try {
      const loanId_int = parseInt(loanId);
      const containerId_int = parseInt(containerId);

      // Verificar que el préstamo existe y pertenece al contenedor
      const existingLoan = await prisma.loan.findUnique({
        where: {
          id: loanId_int,
        },
      });

      if (!existingLoan) {
        throw new Error("Préstamo no encontrado");
      }

      if (existingLoan.containerId !== containerId_int) {
        throw new Error("El préstamo no pertenece a este contenedor");
      }

      await prisma.loan.delete({
        where: {
          id: loanId_int,
        },
      });

      return { success: true, message: "Préstamo eliminado correctamente" };
    } catch (error) {
      console.error("Error in deleteLoan:", error);
      throw new Error(`Error al eliminar préstamo: ${error.message}`);
    }
  }

  /**
   * Obtiene estadísticas de préstamos
   */
  async getLoanStats(containerId) {
    try {
      const containerId_int = parseInt(containerId);

      const totalLoans = await prisma.loan.count({
        where: {
          containerId: containerId_int,
        },
      });

      const activeLoans = await prisma.loan.count({
        where: {
          containerId: containerId_int,
          status: "active",
        },
      });

      const returnedLoans = await prisma.loan.count({
        where: {
          containerId: containerId_int,
          status: "returned",
        },
      });

      const overdueLoans = await prisma.loan.count({
        where: {
          containerId: containerId_int,
          status: "overdue",
        },
      });

      return {
        totalLoans,
        activeLoans,
        returnedLoans,
        overdueLoans,
      };
    } catch (error) {
      console.error("Error in getLoanStats:", error);
      throw new Error(`Error al obtener estadísticas: ${error.message}`);
    }
  }
}

module.exports = LoanService;
