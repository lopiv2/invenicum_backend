const prisma = require("../middleware/prisma");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

class ReportService {
  constructor() {
    // Crear directorio temporal de reportes
    this.reportsDir = path.join(__dirname, "../uploads/reports");
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * Genera un reporte del inventario, préstamos o activos al vuelo
   */
  async generateReport(containerId, userId, reportType, format, filters = {}) {
    try {
      const container = await prisma.container.findUnique({
        where: { id: parseInt(containerId) },
      });

      if (!container) {
        throw new Error("Contenedor no encontrado");
      }

      // Verificar que el usuario es propietario del contenedor
      if (container.userId !== parseInt(userId)) {
        throw new Error("No tienes permiso para generar reportes de este contenedor");
      }

      // Obtener datos según el tipo de reporte
      let data;
      switch (reportType) {
        case "inventory":
          data = await this._getInventoryData(containerId, filters);
          break;
        case "loans":
          data = await this._getLoansData(containerId, filters);
          break;
        case "assets":
          data = await this._getAssetsData(containerId, filters);
          break;
        default:
          throw new Error(`Tipo de reporte no soportado: ${reportType}`);
      }

      // Generar el archivo
      let filePath, fileName;
      if (format === "pdf") {
        ({ filePath, fileName } = await this._generatePDF(reportType, container.name, data));
      } else if (format === "excel") {
        ({ filePath, fileName } = await this._generateExcel(reportType, container.name, data));
      } else {
        throw new Error(`Formato no soportado: ${format}`);
      }

      return {
        filePath,
        fileName,
      };
    } catch (error) {
      console.error("Error in generateReport:", error);
      throw new Error(`Error al generar reporte: ${error.message}`);
    }
  }

  // ========================
  // MÉTODOS PRIVADOS
  // ========================

  /**
   * Obtiene datos de inventario
   */
  async _getInventoryData(containerId, filters = {}) {
    const where = { containerId: parseInt(containerId) };

    // Aplicar filtros si existen
    if (filters.assetTypeId) {
      const assetTypeId = typeof filters.assetTypeId === "number" 
        ? filters.assetTypeId 
        : parseInt(filters.assetTypeId);
      if (!isNaN(assetTypeId) && assetTypeId > 0) {
        where.assetTypeId = assetTypeId;
      }
    }
    if (filters.locationId) {
      const locationId = typeof filters.locationId === "number"
        ? filters.locationId
        : parseInt(filters.locationId);
      if (!isNaN(locationId) && locationId > 0) {
        where.locationId = locationId;
      }
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      include: {
        assetType: { select: { name: true } },
        location: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    return {
      items,
      summary: {
        totalItems: items.length,
        totalValue: items.reduce((sum, item) => sum + (item.marketValue || 0), 0),
        avgValue: items.length > 0 ? items.reduce((sum, item) => sum + (item.marketValue || 0), 0) / items.length : 0,
      },
    };
  }

  /**
   * Obtiene datos de préstamos
   */
  async _getLoansData(containerId, filters = {}) {
    const where = { containerId: parseInt(containerId) };

    // Filtro por estado
    if (filters.status) {
      where.status = filters.status;
    }

    const loans = await prisma.loan.findMany({
      where,
      include: {
        inventoryItem: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { loanDate: "desc" },
    });

    const summary = {
      totalLoans: loans.length,
      activeLoans: loans.filter((l) => l.status === "active").length,
      overdueLoans: loans.filter((l) => l.status === "overdue").length,
      returnedLoans: loans.filter((l) => l.status === "returned").length,
    };

    return { loans, summary };
  }

  /**
   * Obtiene datos de activos por tipo
   */
  async _getAssetsData(containerId, filters = {}) {
    const assetTypes = await prisma.assetType.findMany({
      where: { containerId: parseInt(containerId) },
      include: {
        inventoryItems: true,
        fieldDefinitions: true,
      },
      orderBy: { name: "asc" },
    });

    return {
      assetTypes,
      summary: {
        totalAssetTypes: assetTypes.length,
        totalAssets: assetTypes.reduce((sum, at) => sum + at.inventoryItems.length, 0),
      },
    };
  }

  /**
   * Genera un PDF
   */
  async _generatePDF(reportType, containerName, data) {
    return new Promise((resolve, reject) => {
      try {
        const fileName = `reporte_${reportType}_${Date.now()}.pdf`;
        const filePath = path.join(this.reportsDir, fileName);
        const doc = new PDFDocument();
        const stream = fs.createWriteStream(filePath);

        doc.pipe(stream);

        // Encabezado
        doc.fontSize(20).font("Helvetica-Bold").text(`Reporte de ${reportType.toUpperCase()}`, 50, 50);
        doc.fontSize(12).font("Helvetica").text(`Contenedor: ${containerName}`, 50, 90);
        doc.text(`Fecha: ${new Date().toLocaleDateString("es-ES")}`, 50, 110);

        doc.moveTo(50, 140).lineTo(550, 140).stroke();

        // Contenido según tipo
        let yPosition = 170;

        if (reportType === "inventory") {
          doc.fontSize(14).font("Helvetica-Bold").text("Resumen de Inventario", 50, yPosition);
          yPosition += 30;

          doc.fontSize(11).font("Helvetica");
          doc.text(`Total de artículos: ${data.summary.totalItems}`, 50, yPosition);
          yPosition += 20;
          doc.text(`Valor total: €${data.summary.totalValue.toFixed(2)}`, 50, yPosition);
          yPosition += 20;
          doc.text(`Valor promedio: €${data.summary.avgValue.toFixed(2)}`, 50, yPosition);
          yPosition += 40;

          // Tabla de artículos
          doc.fontSize(12).font("Helvetica-Bold").text("Artículos", 50, yPosition);
          yPosition += 20;

          const tableTop = yPosition;
          const col1 = 50;
          const col2 = 250;
          const col3 = 400;
          const col4 = 500;

          doc.fontSize(10).font("Helvetica-Bold");
          doc.text("Nombre", col1, tableTop);
          doc.text("Tipo", col2, tableTop);
          doc.text("Ubicación", col3, tableTop);
          doc.text("Valor", col4, tableTop);

          yPosition = tableTop + 20;
          doc.font("Helvetica").fontSize(9);

          data.items.slice(0, 20).forEach((item) => {
            if (yPosition > 700) {
              doc.addPage();
              yPosition = 50;
            }
            doc.text(item.name.substring(0, 30), col1, yPosition);
            doc.text(item.assetType.name.substring(0, 20), col2, yPosition);
            doc.text(item.location.name.substring(0, 20), col3, yPosition);
            doc.text(`€${(item.marketValue || 0).toFixed(2)}`, col4, yPosition);
            yPosition += 15;
          });

          if (data.items.length > 20) {
            yPosition += 10;
            doc.fontSize(9).font("Helvetica-Bold").text(`... y ${data.items.length - 20} más`, 50, yPosition);
          }
        } else if (reportType === "loans") {
          doc.fontSize(14).font("Helvetica-Bold").text("Resumen de Préstamos", 50, yPosition);
          yPosition += 30;

          doc.fontSize(11).font("Helvetica");
          doc.text(`Total de préstamos: ${data.summary.totalLoans}`, 50, yPosition);
          yPosition += 20;
          doc.text(`Préstamos activos: ${data.summary.activeLoans}`, 50, yPosition);
          yPosition += 20;
          doc.text(`Préstamos vencidos: ${data.summary.overdueLoans}`, 50, yPosition);
          yPosition += 20;
          doc.text(`Préstamos devueltos: ${data.summary.returnedLoans}`, 50, yPosition);
          yPosition += 40;

          // Tabla de préstamos
          doc.fontSize(12).font("Helvetica-Bold").text("Préstamos Activos", 50, yPosition);
          yPosition += 20;

          const tableTop = yPosition;
          const col1 = 50;
          const col2 = 250;
          const col3 = 400;
          const col4 = 500;

          doc.fontSize(10).font("Helvetica-Bold");
          doc.text("Artículo", col1, tableTop);
          doc.text("Prestatario", col2, tableTop);
          doc.text("Fecha Préstamo", col3, tableTop);
          doc.text("Estado", col4, tableTop);

          yPosition = tableTop + 20;
          doc.font("Helvetica").fontSize(9);

          data.loans.slice(0, 15).forEach((loan) => {
            if (yPosition > 700) {
              doc.addPage();
              yPosition = 50;
            }
            doc.text(loan.inventoryItem.name.substring(0, 25), col1, yPosition);
            doc.text((loan.borrowerName || loan.user.name || "N/A").substring(0, 20), col2, yPosition);
            doc.text(new Date(loan.loanDate).toLocaleDateString("es-ES"), col3, yPosition);
            doc.text(loan.status.toUpperCase(), col4, yPosition);
            yPosition += 15;
          });
        } else if (reportType === "assets") {
          doc.fontSize(14).font("Helvetica-Bold").text("Resumen de Tipos de Activos", 50, yPosition);
          yPosition += 30;

          doc.fontSize(11).font("Helvetica");
          doc.text(`Total de tipos: ${data.summary.totalAssetTypes}`, 50, yPosition);
          yPosition += 20;
          doc.text(`Total de activos: ${data.summary.totalAssets}`, 50, yPosition);
          yPosition += 40;

          // Tabla de tipos de activos
          doc.fontSize(12).font("Helvetica-Bold").text("Tipos de Activos", 50, yPosition);
          yPosition += 20;

          const col1 = 50;
          const col2 = 250;
          const col3 = 450;

          doc.fontSize(10).font("Helvetica-Bold");
          doc.text("Nombre", col1, yPosition);
          doc.text("Cantidad", col2, yPosition);
          doc.text("Campos", col3, yPosition);

          yPosition += 20;
          doc.font("Helvetica").fontSize(9);

          data.assetTypes.slice(0, 20).forEach((at) => {
            if (yPosition > 700) {
              doc.addPage();
              yPosition = 50;
            }
            doc.text(at.name.substring(0, 35), col1, yPosition);
            doc.text(at.inventoryItems.length.toString(), col2, yPosition);
            doc.text(at.fieldDefinitions.length.toString(), col3, yPosition);
            yPosition += 15;
          });
        }

        // Footer
        doc.fontSize(9).font("Helvetica").text("Generado automaticamente por Invenicum", 50, 750);

        doc.end();
        stream.on("finish", () => resolve({ filePath, fileName }));
        stream.on("error", reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Genera un Excel
   */
  async _generateExcel(reportType, containerName, data) {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Reporte");

      // Estilos
      const headerStyle = {
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } },
        font: { bold: true, color: { argb: "FFFFFFFF" } },
        alignment: { horizontal: "center", vertical: "center" },
      };

      const titleStyle = {
        font: { bold: true, size: 16 },
        alignment: { horizontal: "left" },
      };

      // Encabezado
      worksheet.mergeCells("A1:D1");
      const titleCell = worksheet.getCell("A1");
      titleCell.value = `Reporte de ${reportType.toUpperCase()} - ${containerName}`;
      titleCell.style = titleStyle;

      worksheet.mergeCells("A2:D2");
      const dateCell = worksheet.getCell("A2");
      dateCell.value = `Fecha: ${new Date().toLocaleDateString("es-ES")}`;
      dateCell.style = { font: { size: 11 } };

      let startRow = 4;

      if (reportType === "inventory") {
        // Resumen
        worksheet.getCell(`A${startRow}`).value = "RESUMEN DE INVENTARIO";
        worksheet.getCell(`A${startRow}`).style = { font: { bold: true, size: 12 } };
        startRow += 2;

        worksheet.getCell(`A${startRow}`).value = "Total de artículos:";
        worksheet.getCell(`B${startRow}`).value = data.summary.totalItems;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = "Valor total:";
        worksheet.getCell(`B${startRow}`).value = data.summary.totalValue;
        worksheet.getCell(`B${startRow}`).numFmt = '"€"#,##0.00';
        startRow++;

        worksheet.getCell(`A${startRow}`).value = "Valor promedio:";
        worksheet.getCell(`B${startRow}`).value = data.summary.avgValue;
        worksheet.getCell(`B${startRow}`).numFmt = '"€"#,##0.00';
        startRow += 3;

        // Tabla de artículos
        worksheet.getCell(`A${startRow}`).value = "Nombre";
        worksheet.getCell(`B${startRow}`).value = "Tipo";
        worksheet.getCell(`C${startRow}`).value = "Ubicación";
        worksheet.getCell(`D${startRow}`).value = "Valor";

        for (let i = 1; i <= 4; i++) {
          worksheet.getCell(`${String.fromCharCode(64 + i)}${startRow}`).style = headerStyle;
        }

        startRow++;

        data.items.forEach((item) => {
          worksheet.getCell(`A${startRow}`).value = item.name;
          worksheet.getCell(`B${startRow}`).value = item.assetType.name;
          worksheet.getCell(`C${startRow}`).value = item.location.name;
          worksheet.getCell(`D${startRow}`).value = item.marketValue || 0;
          worksheet.getCell(`D${startRow}`).numFmt = '"€"#,##0.00';
          startRow++;
        });
      } else if (reportType === "loans") {
        // Resumen
        worksheet.getCell(`A${startRow}`).value = "RESUMEN DE PRÉSTAMOS";
        worksheet.getCell(`A${startRow}`).style = { font: { bold: true, size: 12 } };
        startRow += 2;

        worksheet.getCell(`A${startRow}`).value = "Total de préstamos:";
        worksheet.getCell(`B${startRow}`).value = data.summary.totalLoans;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = "Activos:";
        worksheet.getCell(`B${startRow}`).value = data.summary.activeLoans;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = "Vencidos:";
        worksheet.getCell(`B${startRow}`).value = data.summary.overdueLoans;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = "Devueltos:";
        worksheet.getCell(`B${startRow}`).value = data.summary.returnedLoans;
        startRow += 3;

        // Tabla de préstamos
        worksheet.getCell(`A${startRow}`).value = "Artículo";
        worksheet.getCell(`B${startRow}`).value = "Prestatario";
        worksheet.getCell(`C${startRow}`).value = "Fecha Préstamo";
        worksheet.getCell(`D${startRow}`).value = "Estado";

        for (let i = 1; i <= 4; i++) {
          worksheet.getCell(`${String.fromCharCode(64 + i)}${startRow}`).style = headerStyle;
        }

        startRow++;

        data.loans.forEach((loan) => {
          worksheet.getCell(`A${startRow}`).value = loan.inventoryItem.name;
          worksheet.getCell(`B${startRow}`).value = loan.borrowerName || loan.user.name || "N/A";
          worksheet.getCell(`C${startRow}`).value = new Date(loan.loanDate).toLocaleDateString("es-ES");
          worksheet.getCell(`D${startRow}`).value = loan.status;
          startRow++;
        });
      } else if (reportType === "assets") {
        // Resumen
        worksheet.getCell(`A${startRow}`).value = "RESUMEN DE TIPOS DE ACTIVOS";
        worksheet.getCell(`A${startRow}`).style = { font: { bold: true, size: 12 } };
        startRow += 2;

        worksheet.getCell(`A${startRow}`).value = "Total de tipos:";
        worksheet.getCell(`B${startRow}`).value = data.summary.totalAssetTypes;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = "Total de activos:";
        worksheet.getCell(`B${startRow}`).value = data.summary.totalAssets;
        startRow += 3;

        // Tabla de tipos
        worksheet.getCell(`A${startRow}`).value = "Nombre";
        worksheet.getCell(`B${startRow}`).value = "Cantidad";
        worksheet.getCell(`C${startRow}`).value = "Campos";
        worksheet.getCell(`D${startRow}`).value = "Serializado";

        for (let i = 1; i <= 4; i++) {
          worksheet.getCell(`${String.fromCharCode(64 + i)}${startRow}`).style = headerStyle;
        }

        startRow++;

        data.assetTypes.forEach((at) => {
          worksheet.getCell(`A${startRow}`).value = at.name;
          worksheet.getCell(`B${startRow}`).value = at.inventoryItems.length;
          worksheet.getCell(`C${startRow}`).value = at.fieldDefinitions.length;
          worksheet.getCell(`D${startRow}`).value = at.isSerialized ? "Sí" : "No";
          startRow++;
        });
      }

      // Ajustar ancho de columnas
      worksheet.columns = [
        { width: 30 },
        { width: 25 },
        { width: 25 },
        { width: 20 },
      ];

      // Guardar archivo
      const fileName = `reporte_${reportType}_${Date.now()}.xlsx`;
      const filePath = path.join(this.reportsDir, fileName);
      await workbook.xlsx.writeFile(filePath);

      return { filePath, fileName };
    } catch (error) {
      throw error;
    }
  }

}

module.exports = new ReportService();
