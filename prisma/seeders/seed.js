require("dotenv").config({ path: "../.env" });
const { hashPassword } = require("../../src/middleware/cryptoUtils");

const prisma = require("../../src/middleware/prisma");



// npm run db:reset  - if quieres resetear the base de data and cargar the data
// npm run db:seed  - if only quieres cargar the data
// npx prisma migrate deploy - if only quieres aplicar migraciones without cargar data

const defaultUsers = [
  {
    email: "admin",
    password: "admin123",
    name: "Administrador",
  },
  {
    email: "usuario",
    password: "usuario123",
    name: "Usuario Demo",
  },
  {
    email: "test",
    password: "test123",
    name: "Usuario Test",
  },
];

async function seedUsers() {
  console.log("Iniciando seeding de usuarios (Modo Upsert)...");

  for (const user of defaultUsers) {
    try {
      // 1. Generamos the hash siempre so that, if cambias the pass en the array, se actualice en the DB
      const hashedPassword = await hashPassword(user.password);

      // 2. Use upsert for Create o update
      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          password: hashedPassword, // Esto permite que si cambias la pass en el código, se actualice en la DB
          // Agrega aquí otros campos if quieres que se sobreescriban
        },
        create: {
          email: user.email,
          name: user.name,
          password: hashedPassword,
        },
      });

      console.log(`Usuario procesado (creado o actualizado): ${user.email}`);
    } catch (error) {
      console.error(`Error al procesar usuario ${user.email}:`, error);
    }
  }
}

async function main() {
  console.log("Iniciando proceso de seeding...");

  try {
    await seedUsers();
    console.log("Seeding completado exitosamente.");
  } catch (error) {
    console.error("Error durante el seeding:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
