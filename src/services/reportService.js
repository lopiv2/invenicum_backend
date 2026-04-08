const prisma = require("../middleware/prisma");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const { Temporal } = require("@js-temporal/polyfill");
const translations = require("../i18n/reports.json");

class ReportService {
  constructor() {
    // Create temporary reports directory
    this.reportsDir = path.join(__dirname, "../uploads/reports");
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * Generates a report of inventory, loans or assets on the fly
   */
  async generateReport(
    containerId,
    userId,
    reportType,
    format,
    filters = {},
    locale,
    currency
  ) {
    try {
      const container = await prisma.container.findUnique({
        where: { id: parseInt(containerId) },
      });

      if (!container) {
        throw new Error("Contenedor no encontrado");
      }

      // Verify that the user is the owner of the container
      if (container.userId !== parseInt(userId)) {
        throw new Error(
          "No tienes permiso para generar reportes de este contenedor",
        );
      }

      // Get data according to the report type
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

      // Generate the file
      let filePath, fileName;
      if (format === "pdf") {
        ({ filePath, fileName } = await this._generatePDF(
          reportType,
          container.name,
          data,
          locale,
          currency,
        ));
      } else if (format === "excel") {
        ({ filePath, fileName } = await this._generateExcel(
          reportType,
          container.name,
          data,
          locale,
          currency,
        ));
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
  * gets inventory data
   */
  async _getInventoryData(containerId, filters = {}) {
    const where = { containerId: parseInt(containerId) };

    // Aplicar filtros if existen
    if (filters.assetTypeId) {
      const assetTypeId =
        typeof filters.assetTypeId === "number"
          ? filters.assetTypeId
          : parseInt(filters.assetTypeId);
      if (!isNaN(assetTypeId) && assetTypeId > 0) {
        where.assetTypeId = assetTypeId;
      }
    }
    if (filters.locationId) {
      const locationId =
        typeof filters.locationId === "number"
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
        totalValue: items.reduce(
          (sum, item) => sum + (item.marketValue || 0),
          0,
        ),
        avgValue:
          items.length > 0
            ? items.reduce((sum, item) => sum + (item.marketValue || 0), 0) /
              items.length
            : 0,
      },
    };
  }

  /**
   * gets data de loans
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
   * gets data de activos por tipo
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
        totalAssets: assetTypes.reduce(
          (sum, at) => sum + at.inventoryItems.length,
          0,
        ),
      },
    };
  }

  /**
   * Genera a PDF
   */
  async _generatePDF(reportType, containerName, data, locale = "en", currency = "USD") {
    const t = translations[locale] || translations["en"];
    return new Promise((resolve, reject) => {
      try {
        const timestamp = Temporal.Now.instant().epochMilliseconds;
        const fileName = `${t.report}_${reportType}_${timestamp}.pdf`;
        const filePath = path.join(this.reportsDir, fileName);
        const doc = new PDFDocument();
        const stream = fs.createWriteStream(filePath);

        doc.pipe(stream);

        // 2. Fecha formateada correctamente
        // Convertimos a String explícitamente for PDFKit
        const reportDate = Temporal.Now.zonedDateTimeISO().toLocaleString(
          "es-ES",
          {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          },
        );

        // Encabezado
        doc
          .fontSize(20)
          .font("Helvetica-Bold")
          .text(`${t.report_title} ${reportType.toUpperCase()}`, 50, 50);
        doc
          .fontSize(12)
          .font("Helvetica")
          .text(`${t.container}: ${containerName}`, 50, 90);
        doc.text(`${t.date}: ${reportDate}`, 50, 110);

        doc.moveTo(50, 140).lineTo(550, 140).stroke();

        // Contenido según tipo
        let yPosition = 170;

        if (reportType === "inventory") {
          doc
            .fontSize(14)
            .font("Helvetica-Bold")
            .text(t.inventory_summary, 50, yPosition);
          yPosition += 30;

          doc.fontSize(11).font("Helvetica");
          doc.text(
            `${t.total_items}: ${data.summary.totalItems}`,
            50,
            yPosition,
          );
          yPosition += 20;
          const symbol = currency;
          doc.text(
            `${t.total_value}: ${symbol}${data.summary.totalValue.toFixed(2)}`,
            50,
            yPosition,
          );
          yPosition += 20;
          doc.text(
            `${t.average_value}: €${data.summary.avgValue.toFixed(2)}`,
            50,
            yPosition,
          );
          yPosition += 40;

          // Tabla de artículos
          doc
            .fontSize(12)
            .font("Helvetica-Bold")
            .text(t.items, 50, yPosition);
          yPosition += 20;

          const tableTop = yPosition;
          const col1 = 50;
          const col2 = 250;
          const col3 = 400;
          const col4 = 500;

          doc.fontSize(10).font("Helvetica-Bold");
          doc.text(t.item_name, col1, tableTop);
          doc.text(t.item_type, col2, tableTop);
          doc.text(t.item_location, col3, tableTop);
          doc.text(t.item_value, col4, tableTop);

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
            doc.text(`${symbol} ${(item.marketValue || 0).toFixed(2)}`, col4, yPosition);
            yPosition += 15;
          });

          if (data.items.length > 20) {
            yPosition += 10;
            doc
              .fontSize(9)
              .font("Helvetica-Bold")
              .text(`${t.and} ${data.items.length - 20} ${t.more}`, 50, yPosition);
          }
        } else if (reportType === "loans") {
          doc
            .fontSize(14)
            .font("Helvetica-Bold")
            .text(t.loans.summary_title, 50, yPosition);
          yPosition += 30;

          doc.fontSize(11).font("Helvetica");
          doc.text(
            `${t.loans.total_loans}: ${data.summary.totalLoans}`,
            50,
            yPosition,
          );
          yPosition += 20;
          doc.text(
            `${t.loans.active_loans}: ${data.summary.activeLoans}`,
            50,
            yPosition,
          );
          yPosition += 20;
          doc.text(
            `${t.loans.overdue_loans}: ${data.summary.overdueLoans}`,
            50,
            yPosition,
          );
          yPosition += 20;
          doc.text(
            `${t.loans.returned_loans}: ${data.summary.returnedLoans}`,
            50,
            yPosition,
          );
          yPosition += 40;

          // Tabla de loans
          doc
            .fontSize(12)
            .font("Helvetica-Bold")
            .text("Active Loans", 50, yPosition);
          yPosition += 20;

          const tableTop = yPosition;
          const col1 = 50;
          const col2 = 250;
          const col3 = 400;
          const col4 = 500;

          doc.fontSize(10).font("Helvetica-Bold");
          doc.text(t.loans.col_item, col1, tableTop);
          doc.text(t.loans.col_borrower, col2, tableTop);
          doc.text(t.loans.col_date, col3, tableTop);
          doc.text(t.loans.col_status, col4, tableTop);

          yPosition = tableTop + 20;
          doc.font("Helvetica").fontSize(9);

          data.loans.slice(0, 15).forEach((loan) => {
            if (yPosition > 700) {
              doc.addPage();
              yPosition = 50;
            }
            const dateStr = loan.loanDate
              ? new Date(loan.loanDate).toLocaleDateString("es-ES")
              : "N/A";
            doc.text(loan.inventoryItem.name.substring(0, 25), col1, yPosition);
            doc.text(
              (loan.borrowerName || loan.user.name || "N/A").substring(0, 20),
              col2,
              yPosition,
            );
            doc.text(dateStr, col3, yPosition);
            doc.text(loan.status.toUpperCase(), col4, yPosition);
            yPosition += 15;
          });
        } else if (reportType === "assets") {
          doc
            .fontSize(14)
            .font("Helvetica-Bold")
            .text(t.assets.summary_title, 50, yPosition);
          yPosition += 30;

          doc.fontSize(11).font("Helvetica");
          doc.text(
            `${t.assets.total_types}: ${data.summary.totalAssetTypes}`,
            50,
            yPosition,
          );
          yPosition += 20;
          doc.text(
            `${t.assets.total_assets}: ${data.summary.totalAssets}`,
            50,
            yPosition,
          );
          yPosition += 40;

          // Tabla de tipos de activos
          doc
            .fontSize(12)
            .font("Helvetica-Bold")
            .text(t.assets.active_assets, 50, yPosition);
          yPosition += 20;

          const col1 = 50;
          const col2 = 250;
          const col3 = 450;

          doc.fontSize(10).font("Helvetica-Bold");
          doc.text(t.assets.col_name, col1, yPosition);
          doc.text(t.assets.col_quantity, col2, yPosition);
          doc.text(t.assets.col_fields, col3, yPosition);

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
        doc
          .fontSize(9)
          .font("Helvetica")
          .text(t.generated_by, 50, 750);

        doc.end();
        stream.on("finish", () => resolve({ filePath, fileName }));
        stream.on("error", reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Genera a Excel
   */
    
  async _generateExcel(reportType, containerName, data,locale = "en", currency = "USD") {
    const t = translations[locale] || translations["en"];
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(t.report);

      // Estilos
      const headerStyle = {
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF1F4E78" },
        },
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
      titleCell.value = `${t.report_title} ${reportType.toUpperCase()} - ${containerName}`;
      titleCell.style = titleStyle;

      worksheet.mergeCells("A2:D2");
      const dateCell = worksheet.getCell("A2");
      dateCell.value = `${t.date}: ${Temporal.Now.zonedDateTimeISO().toLocaleString("es-ES")}`;
      dateCell.style = { font: { size: 11 } };

      let startRow = 4;

      if (reportType === "inventory") {
        // Resumen
        worksheet.getCell(`A${startRow}`).value = t.inventory_summary.toUpperCase();
        worksheet.getCell(`A${startRow}`).style = {
          font: { bold: true, size: 12 },
        };
        startRow += 2;

        worksheet.getCell(`A${startRow}`).value = `${t.total_items}:`;
        worksheet.getCell(`B${startRow}`).value = data.summary.totalItems;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = `${t.total_value}:`;
        worksheet.getCell(`B${startRow}`).value = data.summary.totalValue;
        worksheet.getCell(`B${startRow}`).numFmt = `"${currency}"#,##0.00`;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = `${t.average_value}:`;
        worksheet.getCell(`B${startRow}`).value = data.summary.avgValue;
        worksheet.getCell(`B${startRow}`).numFmt = `"${currency}"#,##0.00`;
        startRow += 3;

        // Tabla de artículos
        worksheet.getCell(`A${startRow}`).value = t.item_name;
        worksheet.getCell(`B${startRow}`).value = t.item_type;
        worksheet.getCell(`C${startRow}`).value = t.item_location;
        worksheet.getCell(`D${startRow}`).value = t.item_value;

        for (let i = 1; i <= 4; i++) {
          worksheet.getCell(`${String.fromCharCode(64 + i)}${startRow}`).style =
            headerStyle;
        }

        startRow++;

        data.items.forEach((item) => {
          worksheet.getCell(`A${startRow}`).value = item.name;
          worksheet.getCell(`B${startRow}`).value = item.assetType.name;
          worksheet.getCell(`C${startRow}`).value = item.location.name;
          worksheet.getCell(`D${startRow}`).value = item.marketValue || 0;
          worksheet.getCell(`D${startRow}`).numFmt = `"${currency}"#,##0.00`;
          startRow++;
        });
      } else if (reportType === "loans") {
        // Resumen
        worksheet.getCell(`A${startRow}`).value = t.loans.summary_title.toUpperCase();
        worksheet.getCell(`A${startRow}`).style = {
          font: { bold: true, size: 12 },
        };
        startRow += 2;

        worksheet.getCell(`A${startRow}`).value = `${t.loans.total_loans}:`;
        worksheet.getCell(`B${startRow}`).value = data.summary.totalLoans;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = `${t.loans.active_loans}:`;
        worksheet.getCell(`B${startRow}`).value = data.summary.activeLoans;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = `${t.loans.overdue_loans}:`;
        worksheet.getCell(`B${startRow}`).value = data.summary.overdueLoans;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = `${t.loans.returned_loans}:`;
        worksheet.getCell(`B${startRow}`).value = data.summary.returnedLoans;
        startRow += 3;

        // Tabla de loans
        worksheet.getCell(`A${startRow}`).value = t.loans.col_item;
        worksheet.getCell(`B${startRow}`).value = t.loans.col_borrower;
        worksheet.getCell(`C${startRow}`).value = t.loans.col_date;
        worksheet.getCell(`D${startRow}`).value = t.loans.col_status;

        for (let i = 1; i <= 4; i++) {
          worksheet.getCell(`${String.fromCharCode(64 + i)}${startRow}`).style =
            headerStyle;
        }

        startRow++;

        data.loans.forEach((loan) => {
          worksheet.getCell(`A${startRow}`).value = loan.inventoryItem.name;
          worksheet.getCell(`B${startRow}`).value =
            loan.borrowerName || loan.user.name || "N/A";
          const rawDate = loan.loanDateTemporal || loan.loanDate;
          if (rawDate) {
            worksheet.getCell(`C${startRow}`).value = rawDate.toLocaleString(
              "es-ES",
              {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              },
            );
          } else {
            worksheet.getCell(`C${startRow}`).value = "N/A";
          }
          worksheet.getCell(`D${startRow}`).value = loan.status;
          startRow++;
        });
      } else if (reportType === "assets") {
        // Resumen
        worksheet.getCell(`A${startRow}`).value = t.assets.summary_title.toUpperCase();
        worksheet.getCell(`A${startRow}`).style = {
          font: { bold: true, size: 12 },
        };
        startRow += 2;

        worksheet.getCell(`A${startRow}`).value = `${t.assets.total_types}:`;
        worksheet.getCell(`B${startRow}`).value = data.summary.totalAssetTypes;
        startRow++;

        worksheet.getCell(`A${startRow}`).value = `${t.assets.total_assets}:`;
        worksheet.getCell(`B${startRow}`).value = data.summary.totalAssets;
        startRow += 3;

        // Tabla de tipos
        worksheet.getCell(`A${startRow}`).value = t.assets.col_name;
        worksheet.getCell(`B${startRow}`).value = t.assets.col_quantity;
        worksheet.getCell(`C${startRow}`).value = t.assets.col_fields;
        worksheet.getCell(`D${startRow}`).value = t.assets.col_serialized;

        for (let i = 1; i <= 4; i++) {
          worksheet.getCell(`${String.fromCharCode(64 + i)}${startRow}`).style =
            headerStyle;
        }

        startRow++;

        data.assetTypes.forEach((at) => {
          worksheet.getCell(`A${startRow}`).value = at.name;
          worksheet.getCell(`B${startRow}`).value = at.inventoryItems.length;
          worksheet.getCell(`C${startRow}`).value = at.fieldDefinitions.length;
          worksheet.getCell(`D${startRow}`).value = at.isSerialized
            ? t.yes
            : t.no;
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
      const fileName = `${t.report}_${reportType}_${Temporal.Now.instant().epochMilliseconds}.xlsx`;
      const filePath = path.join(this.reportsDir, fileName);
      await workbook.xlsx.writeFile(filePath);

      return { filePath, fileName };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new ReportService();
