const { PrismaClient } = require('../generated/prisma');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

class UserService {
    async register(userData) {
        const { email, password, name } = userData;

        try {
            // Verificar si el usuario ya existe
            const existingUser = await prisma.user.findUnique({
                where: { email }
            });

            if (existingUser) {
                return {
                    success: false,
                    message: 'El usuario ya existe'
                };
            }

            // Encriptar la contraseña
            const hashedPassword = await bcrypt.hash(password, 10);

            // Crear el nuevo usuario
            const newUser = await prisma.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    name
                }
            });

            return {
                success: true,
                message: 'Usuario registrado exitosamente',
                user: {
                    id: parseInt(newUser.id),
                    email: newUser.email,
                    name: newUser.name
                }
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Error al registrar usuario'
            };
        }
    }

    async login(credentials) {
        const { username, password } = credentials;

        try {
            // Buscar el usuario por email (username en el frontend)
            const user = await prisma.user.findUnique({
                where: { email: username }
            });

            if (!user) {
                return {
                    success: false,
                    message: 'Usuario no encontrado'
                };
            }

            // Verificar la contraseña
            const isPasswordValid = await bcrypt.compare(password, user.password);

            if (!isPasswordValid) {
                return {
                    success: false,
                    message: 'Contraseña incorrecta'
                };
            }

            // Generar token JWT
            const token = jwt.sign(
                { 
                    userId: parseInt(user.id),
                    email: user.email
                },
                process.env.JWT_SECRET || 'tu-secret-key-temporal',
                { expiresIn: '24h' }
            );

            return {
                success: true,
                message: 'Login exitoso',
                token: token,
                user: {
                    id: parseInt(user.id),
                    email: user.email,
                    name: user.name
                }
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Error en el servidor'
            };
        }
    }

    async getUserById(userId) {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId }
            });

            if (!user) {
                return {
                    success: false,
                    message: 'Usuario no encontrado'
                };
            }

            return {
                success: true,
                user: {
                    id: parseInt(user.id),
                    email: user.email,
                    name: user.name
                }
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Error al obtener usuario'
            };
        }
    }
}

module.exports = new UserService();