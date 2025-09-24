// Importa el módulo Express
const express = require('express');

// Crea una instancia de la aplicación Express
const app = express();

// Define el puerto donde el servidor escuchará
const port = 3000;

// Define una ruta para la página de inicio (ruta raíz)
app.get('/', (req, res) => {
  // Envía una respuesta al cliente
  res.send('<h1>¡Hola desde mi primera app con Express!</h1>');
});

// Inicia el servidor
app.listen(port, () => {
  console.log(`La aplicación está corriendo en http://localhost:${port}`);
});