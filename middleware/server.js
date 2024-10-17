const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');
const app = express();
const port = 4000;

app.use(express.json());
app.use(cors());
const storage = multer.memoryStorage();
const upload = multer( {storage:storage} );


let connections = [];
const logs = [];


app.post("/middleware", (req, res) => {
  let instance = req.body
  connections.push({instance:`${instance.ipAddress}:${instance.port}`, requests: 0 , logs: [], tried:false });
  res.status(200).end();
  console.log("Instancias actualizadas: ", connections);
});

app.post("/request", upload.single('image'), async (req, res) => {

  if (!req.file) {
    return res.status(400).send('No se ha subido ningún archivo.');
}


  if (connections.length === 0) {
    return res.status(503).json({ error: "No hay servidores disponibles" });
  }


  let leastConnectedServer = connections.reduce((prev, curr) => 
    prev.requests < curr.requests ? prev : curr
  );

  for (let i = 0; i < connections.length; i++) {
    try {

      const formData = new FormData();
      formData.append('image', req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
          knownLength: req.file.size
      });

      console.log(`Llamando a servidor: ${leastConnectedServer.instance}/upload`);
      const response = await axios.post(`http://${leastConnectedServer.instance}/upload`, formData,{
         headers: {
          ...formData.getHeaders()   
         },
       responseType: "arraybuffer"
      });
      leastConnectedServer.requests++;
      leastConnectedServer.logs.push(`${new Date()} - ${req.originalUrl} -  ${req.method}. ${JSON.stringify(response.data)}`)

      res.set('Content-Type', response.headers['content-type']); 
      res.send(response.data);

    } catch (error) {

      console.log(`Error. ${leastConnectedServer.instance}: ${error.message}. ${new Date()}`);
      leastConnectedServer.requests++;
      if (error.response) {
        leastConnectedServer.logs.push(`${new Date()} - ${error.response.status} - ${error.message}`);
      } else {
        leastConnectedServer.logs.push(`${new Date()} - Error: ${error.message}`);
      }
      leastConnectedServer.tried = true;

      const availableConnections = connections.filter(conn => !conn.tried);
      
      if (availableConnections.length > 0) {
        leastConnectedServer = availableConnections.reduce((prev, curr) => 
          prev.requests < curr.requests ? prev : curr
        );
        console.log(leastConnectedServer)
      } else {
        connections.forEach(conn => conn.tried = false);
        return res.status(503).json({ error: "No hay servidores disponibles" });

      }
    }
  }

  connections.forEach(conn => conn.tried = false);

});


app.get("/status", (req,res) =>{
  res.json(connections);
});


setInterval(() => {
  connections.forEach(server => server.requests = 0);
  console.log("Reiniciando contador de peticiones...");
}, 60000);

app.listen(port, () => {
  console.log(`Middleware corriendo en el puerto: ${port}`);
});
