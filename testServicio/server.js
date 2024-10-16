const express = require('express');
const fileUpload = require('express-fileupload');
const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');
const app = express();

const containerPort = process.env.CONTAINER_PORT;
const hostPort = process.env.HOST_PORT;
const ipAddress = process.env.IP_ADDRESS;
const containerName = process.env.CONTAINER_NAME


// Middleware para manejar la subida de archivos
app.use(fileUpload());
app.use(express.static('frontend'));


app.get("/healthCheck", (req, res) => {
  res.status(200).end();
});


// Ruta para agregar la marca de agua
app.post('/upload', async (req, res) => {
  if (!req.files || !req.files.image) {
    return res.status(400).send('No se subió ninguna imagen.');
  }

  const image = req.files.image;
  const watermarkText = 'Marca de agua';

  try {
    const img = await Jimp.read(image.data);
    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

    img.print(font, 10, 10, watermarkText);  // Añadir la marca de agua
    const outputPath = path.join(__dirname, 'output', 'watermarked.jpg');

    await img.writeAsync(outputPath);  // Guardar la imagen con la marca de agua
    res.sendFile(outputPath);  // Enviar la imagen modificada al frontend
  } catch (err) {
    res.status(500).send('Error al procesar la imagen.');
  }
});

const startServer = async () => {
  try {
      console.log('IP del host:', ipAddress);
      console.log('ID del contenedor :', containerName)
      console.log('HostPort :', hostPort)
      console.log("ipDIS:"+process.env.DIS_SERVERIP_PORT)
      console.log(`Servidor corriendo en el puerto: ${containerPort}`);
      const requestOptions = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ipAddress: ipAddress, port: hostPort , id: containerName}),
      };
      await fetch(`http://${process.env.DIS_SERVERIP_PORT}/discoveryServer`, requestOptions).then((response) => {
          console.log(response.status);
      });
  } catch (error) {
      console.error('Error al obtener la IP:', error);
  }
};

app.listen(containerPort, startServer);

//docker run --rm --name chanchito -e CONTAINER_NAME=chanchito  -e HOST_PORT=3000 -e CONTAINER_PORT=3000  -e DIS_SERVERIP_PORT="192.168.1.17:9000" -p 3000:3000 testnapp