// models/LoanDTO.js
class LoanDTO {
  constructor(prismaLoan) {
    this.id = parseInt(prismaLoan.id);
    this.containerId = parseInt(prismaLoan.containerId);
    this.inventoryItemId = parseInt(prismaLoan.inventoryItemId);
    this.userId = parseInt(prismaLoan.userId);
    
    // Datos informativos del artículo
    this.itemName = prismaLoan.itemName;
    this.quantity = parseInt(prismaLoan.quantity || 1);
    
    // Datos del prestatario
    this.borrowerName = prismaLoan.borrowerName || null;
    this.borrowerEmail = prismaLoan.borrowerEmail || null;
    this.borrowerPhone = prismaLoan.borrowerPhone || null;
    
    // --- LÓGICA DE FECHAS ---
    // ISOString es más fácil de parsear en Flutter con DateTime.parse()
    this.loanDate = prismaLoan.loanDate ? prismaLoan.loanDate.toISOString() : null;
    this.expectedReturnDate = prismaLoan.expectedReturnDate ? prismaLoan.expectedReturnDate.toISOString() : null;
    this.actualReturnDate = prismaLoan.actualReturnDate ? prismaLoan.actualReturnDate.toISOString() : null;
    
    // Estado y Notas
    this.status = prismaLoan.status || 'active';
    this.notes = prismaLoan.notes || null;

    // --- LÓGICA DE VENCIMIENTO (Calculada) ---
    const now = new Date();
    this.isOverdue = this.status === 'active' && 
                     prismaLoan.expectedReturnDate && 
                     new Date(prismaLoan.expectedReturnDate) < now;
    
    // Identificador visual formateado (opcional, útil para UI)
    this.voucherId = `V-${this.id.toString().padEnd(6, '0')}`;
  }

  toJSON() {
    return {
      id: this.id,
      containerId: this.containerId,
      inventoryItemId: this.inventoryItemId,
      userId: this.userId,
      itemName: this.itemName,
      quantity: this.quantity,
      borrowerName: this.borrowerName,
      borrowerEmail: this.borrowerEmail,
      borrowerPhone: this.borrowerPhone,
      loanDate: this.loanDate,
      expectedReturnDate: this.expectedReturnDate,
      actualReturnDate: this.actualReturnDate,
      status: this.status,
      notes: this.notes,
      isOverdue: this.isOverdue, // 🚩 Muy útil para poner el texto en rojo en Flutter
      voucherId: this.voucherId
    };
  }
}

module.exports = LoanDTO;