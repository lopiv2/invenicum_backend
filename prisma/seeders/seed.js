const { PrismaClient } = require('../../src/generated/prisma');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

// npm run db:reset  - Si quieres resetear la base de datos y cargar los datos
// npm run db:seed  - Si solo quieres cargar los datos

const defaultUsers = [
    {
        email: 'admin',
        password: 'admin123',
        name: 'Administrador'
    },
    {
        email: 'usuario',
        password: 'usuario123',
        name: 'Usuario Demo'
    },
    {
        email: 'test',
        password: 'test123',
        name: 'Usuario Test'
    }
];

async function seedUsers() {
    console.log('Iniciando seeding de usuarios...');

    for (const user of defaultUsers) {
        try {
            // Verificar si el usuario ya existe
            const existingUser = await prisma.user.findUnique({
                where: { email: user.email }
            });

            if (!existingUser) {
                // Encriptar la contraseña antes de guardar
                const hashedPassword = await bcrypt.hash(user.password, 10);

                // Crear el usuario
                await prisma.user.create({
                    data: {
                        ...user,
                        password: hashedPassword
                    }
                });
                console.log(`Usuario creado: ${user.email}`);
            } else {
                console.log(`Usuario ya existe: ${user.email}`);
            }
        } catch (error) {
            console.error(`Error al procesar usuario ${user.email}:`, error);
        }
    }
}

async function main() {
    console.log('Iniciando proceso de seeding...');
    
    try {
        await seedUsers();
        console.log('Seeding completado exitosamente.');
    } catch (error) {
        console.error('Error durante el seeding:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();