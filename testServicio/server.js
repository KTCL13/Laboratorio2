const express = require('express');
const multer = require('multer');
const Jimp = require('jimp');
const cors = require('cors'); // <-- Importa CORS
const morgan = require('morgan');
const moment = require('moment-timezone');
const app = express();


const containerPort = process.env.CONTAINER_PORT;
const hostPort = process.env.HOST_PORT;
const ipAddress = process.env.IP_ADDRESS; 
const containerName = process.env.CONTAINER_NAME;


const storage = multer.memoryStorage();
const upload = multer({ storage: storage });


app.use(cors());

let logsArray = []; 

morgan.token('date', (req, res, tz) => {
  return moment().tz("America/Bogota").format('DD/MMM/YYYY:HH:mm:ss ZZ');
});

const morganLogs = morgan('[:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":remote-addr ":user-agent"', {
  stream: {
    write: (log) => {
      console.log(log)
      logsArray.push(log); 
    }
  }
});


app.use(morganLogs);


app.get("/healthCheck", (req, res) => {
  res.status(200).json(logsArray);
});

app.post('/upload', upload.single('image'), async (req, res) => {
  console.log(req.file)
  if (!req.file) {
    console.log("No se subió ninguna imagen");
    return res.status(400).send('No se subió ninguna imagen.');
  }

  const image = req.file.buffer;
  const watermarkText = 'Marca de agua';

  try {
    console.log("Leyendo la imagen con Jimp");
    const img = await Jimp.read(image);
    console.log("Cargando la fuente");
    const font = await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);

    console.log("Añadiendo la marca de agua");
    img.print(font, 10, 10, watermarkText);  // Añadir la marca de agua
    
    const editedImageBuffer = await img.getBufferAsync(Jimp.MIME_JPEG);
    res.set('Content-Type', Jimp.MIME_JPEG);
    res.send(editedImageBuffer);  // Enviar la imagen procesada

  } catch (error) {
      console.error("Error al procesar la imagen:", error);
      res.status(500).json({ message: 'Error al procesar la imagen', error: error.message });
  }
});

const startServer = async () => {
  try {
    console.log('IP del host:', ipAddress);
    console.log('ID del contenedor:', containerName);
    console.log('HostPort:', hostPort);
    console.log("ipDIS:", process.env.DIS_SERVERIP_PORT);
    console.log(`Servidor corriendo en el puerto: ${containerPort}`);

    const requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ipAddress: ipAddress, port: hostPort , id: containerName }),
    };

    await fetch(`http://${process.env.DIS_SERVERIP_PORT}/discoveryserver`, requestOptions)
      .then((response) => {
        console.log(response.status);
      });
  } catch (error) {
    console.error('Error al obtener la IP:', error);
  }
};

app.listen(containerPort, startServer);

