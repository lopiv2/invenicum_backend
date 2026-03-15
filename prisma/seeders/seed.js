require("dotenv").config({ path: "../.env" });
const { hashPassword } = require("../../src/middleware/cryptoUtils");

const prisma = require("../../src/middleware/prisma");



// npm run db:reset  - Si quieres resetear la base de datos y cargar los datos
// npm run db:seed  - Si solo quieres cargar los datos
// npx prisma migrate deploy - Si solo quieres aplicar migraciones sin cargar datos

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
      // 1. Generamos el hash siempre para que, si cambias la pass en el array, se actualice en la DB
      const hashedPassword = await hashPassword(user.password);

      // 2. Usamos upsert para crear o actualizar
      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          password: hashedPassword, // Esto permite que si cambias la pass en el código, se actualice en la DB
          // Agrega aquí otros campos si quieres que se sobreescriban
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
