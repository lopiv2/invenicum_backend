const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

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
      } = loanData;

      const containerId_int = parseInt(containerId);
      const inventoryItemId_int = parseInt(inventoryItemId);

      // Verificar que el artículo existe y pertenece al contenedor
      const inventoryItem = await prisma.inventoryItem.findUnique({
        where: {
          id: inventoryItemId_int,
        },
        include: {
          assetType: {
            select: {
              id: true,
              isSerialized: true,
            },
          },
        },
      });

      if (!inventoryItem) {
        throw new Error("Artículo de inventario no encontrado");
      }

      if (inventoryItem.containerId !== containerId_int) {
        throw new Error("El artículo no pertenece a este contenedor");
      }

      // 🔑 LÓGICA DE CANTIDAD: Si el artículo es NO seriado, restar 1 de la cantidad
      let quantityUpdate = {};
      if (!inventoryItem.assetType.isSerialized) {
        // Si es NO seriado y la cantidad es mayor a 1, restar 1
        if (inventoryItem.quantity > 1) {
          quantityUpdate = {
            quantity: inventoryItem.quantity - 1,
          };
          console.log(`[DEBUG] Préstamo creado: Restando 1 de cantidad. Antes: ${inventoryItem.quantity}, Después: ${inventoryItem.quantity - 1}`);
        } else if (inventoryItem.quantity === 1) {
          // Si es 1, dejaría en 0, pero podríamos validar esto
          quantityUpdate = {
            quantity: 0,
          };
          console.log(`[DEBUG] Préstamo creado: Cantidad reducida a 0`);
        }
      }

      // Crear el préstamo y actualizar la cantidad en una transacción
      const loan = await prisma.loan.create({
        data: {
          containerId: containerId_int,
          inventoryItemId: inventoryItemId_int,
          itemName: itemName || inventoryItem.name,
          borrowerName: borrowerName || null,
          borrowerEmail: borrowerEmail || null,
          borrowerPhone: borrowerPhone || null,
          loanDate: parseDate(loanDate) || new Date(),
          expectedReturnDate: expectedReturnDate ? parseDate(expectedReturnDate) : null,
          notes: notes || null,
          status: "active",
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
      });

      // 🔑 Actualizar cantidad del inventoryItem si es necesario
      if (Object.keys(quantityUpdate).length > 0) {
        await prisma.inventoryItem.update({
          where: {
            id: inventoryItemId_int,
          },
          data: quantityUpdate,
        });
        console.log(`[DEBUG] InventoryItem ${inventoryItemId_int} actualizado: cantidad modificada`);
      }

      return loan;
    } catch (error) {
      console.error("Error in createLoan:", error);
      throw new Error(`Error al crear préstamo: ${error.message}`);
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
          updateData.expectedReturnDate = parseDate(loanData.expectedReturnDate);
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

      // Verificar que el préstamo existe y pertenece al contenedor
      const existingLoan = await prisma.loan.findUnique({
        where: {
          id: loanId_int,
        },
        include: {
          inventoryItem: {
            select: {
              id: true,
              quantity: true,
              assetType: {
                select: {
                  isSerialized: true,
                },
              },
            },
          },
        },
      });

      if (!existingLoan) {
        throw new Error("Préstamo no encontrado");
      }

      if (existingLoan.containerId !== containerId_int) {
        throw new Error("El préstamo no pertenece a este contenedor");
      }

      // 🔑 LÓGICA DE CANTIDAD: Si el artículo es NO seriado, sumar 1 a la cantidad
      let quantityUpdate = {};
      if (!existingLoan.inventoryItem.assetType.isSerialized) {
        const newQuantity = existingLoan.inventoryItem.quantity + 1;
        quantityUpdate = {
          quantity: newQuantity,
        };
        console.log(`[DEBUG] Préstamo devuelto: Sumando 1 de cantidad. Antes: ${existingLoan.inventoryItem.quantity}, Después: ${newQuantity}`);
      }

      const returnedLoan = await prisma.loan.update({
        where: {
          id: loanId_int,
        },
        data: {
          status: "returned",
          actualReturnDate: new Date(),
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
      });

      // 🔑 Actualizar cantidad del inventoryItem si es necesario
      if (Object.keys(quantityUpdate).length > 0) {
        await prisma.inventoryItem.update({
          where: {
            id: existingLoan.inventoryItem.id,
          },
          data: quantityUpdate,
        });
        console.log(`[DEBUG] InventoryItem ${existingLoan.inventoryItem.id} actualizado: cantidad incrementada`);
      }

      return returnedLoan;
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
