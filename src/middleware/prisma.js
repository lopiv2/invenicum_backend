require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

const adapter = new PrismaMariaDb(
  {
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10,
    connectTimeout: 5000,
  },
  {
    schema: "invenicum",
  },
);

// Cliente base limpio sin extensiones de cifrado
const prisma = new PrismaClient({
  adapter,
  log: ["error"],
});

module.exports = prisma;