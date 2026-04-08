require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const { Temporal } = require("@js-temporal/polyfill");

const adapter = new PrismaMariaDb(
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10,
    connectTimeout: 5000,
    // Necesario when MySQL Use caching_sha2_password without TLS.
    allowPublicKeyRetrieval: true,
  },
  {
    schema: process.env.DB_NAME,
  },
);

// 1. Cliente base
const basePrisma = new PrismaClient({
  adapter,
  log: ["error"],
});

const prisma = basePrisma.$extends({
  result: {
    alert: {
      createdAtTemporal: {
        needs: { createdAt: true },
        compute(a) {
          return safeTemporal(a.createdAt);
        },
      },
      scheduledAtTemporal: {
        needs: { scheduledAt: true },
        compute(a) {
          return safeTemporal(a.scheduledAt);
        },
      },
      // Añadimos notifyAt que también lo Uses en the DTO
      notifyAtTemporal: {
        needs: { notifyAt: true },
        compute(a) {
          return safeTemporal(a.notifyAt);
        },
      },
    },
    loan: {
      loanDateTemporal: {
        needs: { loanDate: true },
        compute(l) {
          return safeTemporal(l.loanDate);
        },
      },
      expectedReturnTemporal: {
        needs: { expectedReturnDate: true },
        compute(l) {
          return safeTemporal(l.expectedReturnDate);
        },
      },
      // ✅ Añadido: actualReturnDate for cerrar the ciclo del loan
      actualReturnTemporal: {
        needs: { actualReturnDate: true },
        compute(l) {
          return safeTemporal(l.actualReturnDate);
        },
      },
    },
    user: {
      githubLinkedTemporal: {
        needs: { githubLinkedAt: true },
        compute(u) {
          return safeTemporal(u.githubLinkedAt);
        },
      },
    },
  },
});

/**
 * Función auxiliar for convertir Date/String a Temporal.Instant de forma segura
 */
function safeTemporal(dateValue) {
  if (!dateValue) return null;
  try {
    // if ya es Date, Use ISO. if es string, Temporal.from lo entiende.
    const iso =
      dateValue instanceof Date
        ? dateValue.toISOString()
        : dateValue.toString();
    return Temporal.Instant.from(iso);
  } catch (e) {
    console.error("[PRISMA EXTENSION ERROR]: Fallo al convertir a Temporal", e);
    return null;
  }
}

module.exports = prisma;
