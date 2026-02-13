const { PrismaClient } = require("@prisma/client");
const { encrypt, decrypt } = require('../middleware/cryptoUtils');

const basePrisma = new PrismaClient();

// 🚩 Centralizamos la lógica de cifrado aquí UNA SOLA VEZ
const prisma = basePrisma.$extends({
  query: {
    user: {
      async $allOperations({ operation, args, query }) {
        // CIFRAR AL GUARDAR
        if (['create', 'update', 'upsert'].includes(operation)) {
          if (args.data && args.data.githubToken) {
            args.data.githubToken = encrypt(args.data.githubToken);
          }
        }

        const result = await query(args);

        // DESCIFRAR AL LEER
        if (result) {
          if (Array.isArray(result)) {
            result.forEach(user => {
              if (user.githubToken) user.githubToken = decrypt(user.githubToken);
            });
          } else if (result.githubToken) {
            result.githubToken = decrypt(result.githubToken);
          }
        }
        return result;
      },
    },
  },
});

module.exports = prisma;