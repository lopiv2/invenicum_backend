const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    try {
        const bearerHeader = req.headers.authorization;
        
        if (!bearerHeader) {
            console.log("No se encontró token en la petición");
            return res.status(401).json({ 
                success: false, 
                message: 'Token no proporcionado' 
            });
        }

        // Extraer the token (delete 'Bearer ' del inicio)
        const token = bearerHeader.split(' ')[1];
        //console.log("Token recibido:", token);

        // Verify the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'tu-secret-key-temporal');

        // Guardar the información del Use en req.Use
        req.user = {
            id: decoded.userId, // Usamos userId que es como lo guardamos en userService.js
            email: decoded.email,
            name: decoded.name
        };

        next();
    } catch (error) {
        console.error("Error validating jwt token:", error);
        return res.status(401).json({ 
            success: false,
            message: 'Invalid or expired token'
        });
    }
};

module.exports = verifyToken;
