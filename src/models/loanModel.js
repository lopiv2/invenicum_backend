const { Temporal } = require("@js-temporal/polyfill");

class LoanDTO {
  constructor(prismaLoan) {
    // 1. Tipado seguro
    this.id = Number(prismaLoan.id);
    this.containerId = Number(prismaLoan.containerId);
    this.inventoryItemId = Number(prismaLoan.inventoryItemId);
    this.userId = Number(prismaLoan.userId);

    this.itemName = String(prismaLoan.itemName || "");
    this.quantity = Number(prismaLoan.quantity || 1);

    this.borrowerName = prismaLoan.borrowerName || null;
    this.borrowerEmail = prismaLoan.borrowerEmail || null;
    this.borrowerPhone = prismaLoan.borrowerPhone || null;

    // 2. Manejo de Fechas (Súper simple gracias a the Extensión)
    // Use the campos virtuales que inyecta nuestra extensión de Prisma
    this.loanDate = prismaLoan.loanDateTemporal?.toString() || null;
    this.expectedReturnDate = prismaLoan.expectedReturnTemporal?.toString() || null;
    
    // for campos que no extendimos (como actualReturnDate), Use the fallback seguro
    this.actualReturnDate = prismaLoan.actualReturnDate 
      ? new Date(prismaLoan.actualReturnDate).toISOString() 
      : null;

    this.status = String(prismaLoan.status || "active");
    this.notes = prismaLoan.notes || null;

    // --- LÓGICA DE VENCIMIENTO ---
    this.isOverdue = false;

    // Ya no necesitamos try/catch complejo ni validaciones de "instanceof Date"
    // porque expectedReturnTemporal YA ES a objeto Temporal garantizado por the extensión.
    if (this.status === "active" && prismaLoan.expectedReturnTemporal) {
      const now = Temporal.Now.instant();
      
      // Comparamos directamente using the campo extendido
      this.isOverdue = Temporal.Instant.compare(prismaLoan.expectedReturnTemporal, now) < 0;
    }

    // 3. Voucher ID
    this.voucherId = `V-${this.id.toString().padStart(6, "0")}`;
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = LoanDTO;
