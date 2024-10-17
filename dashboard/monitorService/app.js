const express = require('express');
const axios = require('axios');
const http = require("http");
const cors = require("cors");
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const crypto = require('crypto');
const { strictEqual } = require('assert');

const app = express();
const server = http.createServer(app);  // Crear el servidor HTTP
const io = new Server(server, {
    cors: {
        origin: "http://192.168.137.50:8080/",  // Asegurar que el frontend está permitido
        methods: ["GET", "POST"],
    },
});

app.use(cors());
app.use(express.json());

const port = 7000;
const MAX_HISTORY = 10;
let connections = [];


// Rutas para los logs y los monitores
app.get("/status", (req, res) => {
    console.log("/status: Obteniendo Logs");
    res.json({ servers: connections });
});

app.post("/monitor", (req, res) => {
    console.log("Obteniendo y seteando instancias.");
    
    const instance = req.body;

    if (!instance || !instance.ipAddress || !instance.port) {
        console.log("Algo fallo en la ip y el port");
        return res.status(400).json({ error: "Se requiere ipAddress y port" });
    }

    const serverAddress = `${instance.ipAddress}:${instance.port}`;
    const idContainer= instance.id
    console.log("Servidor recibido: " + serverAddress);

    const existingServer = connections.find(conn => conn.instance === serverAddress);
    if (existingServer) {
        return res.status(409).json({ error: "El servidor ya está registrado" });
    }

    connections.push({
        instance: serverAddress,
        requests: 0,
        history: [],
        tried: false,
        status: 'up',
        id: idContainer
    });

    res.status(200).end();
    console.log("Instancias actualizadas: ", connections);
});

// Intervalo para verificar los servidores
setInterval(async () => {
    const timeout = (server) =>
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`La petición a ${server.instance} tardó más de 15 segundos`)), 15000)
        );

    const promises = connections.map(async (server) => {
        console.log(`Verificando ${server.instance}`);
        const startTime = Date.now();
        try {
            const respuesta = await Promise.race([
                axios.get(`http://${server.instance}/healthCheck`),
                timeout(server)
            ]);

            const responseTime = Date.now() - startTime;
            server.responseTime = responseTime;

            if (respuesta.status === 200) {
                server.status = 'up';
                server.message = `Tardo ${responseTime}`;
                console.log('Respuesta:', respuesta.data);
            } else {
                if(server.status == 'down'){
                server.message = `Error: ${respuesta.data}`;
                console.log('Llega pero falla:', respuesta.data);
                }else{
                    server.status = 'down';
                    server.message = `Error: ${respuesta.data}`;
                    console.log('Llega pero falla:', respuesta.data);    
                    runContainer((err, result) => {
                        if (err) {
                            console.log(`Error: ${err.message}`);
                        }
                        console.log(`Container created: ${result}`);
                    });
                }
            }
        } catch (error) {
            if(server.status == 'down'){
                const isTimeout = error.message.includes('tardó más de 15 segundos');
                server.message = `${isTimeout ? 'Timeout' : error.message}`;
                console.log(`Fallo en ${server.instance}: ${isTimeout ? 'Timeout' : error.message}`);

            }else{
                const isTimeout = error.message.includes('tardó más de 15 segundos');
                server.status = 'down';
                server.message = `${isTimeout ? 'Timeout' : error.message}`;
                console.log(`Fallo en ${server.instance}: ${isTimeout ? 'Timeout' : error.message}`);
                runContainer((err, result) => {
                    if (err) {
                        console.log(`Error: ${err.message}`);
                    }
                    console.log(`Container created: ${result}`);
                });
            }
        }

        server.history.push({
            timestamp: new Date().toISOString(),
            status: server.status,
            message: server.message,
        });

        if (server.history.length > MAX_HISTORY) {
            server.history.shift(); 
        }
    });

    await Promise.all(promises);
    console.log("Va a emitir");

    io.emit("update", { servers: connections });
    console.log("Emitió");
}, 15000);

io.on("connection", (_) => {
    console.log("Un usuario se conectó");
});



const sshConfig = {
    host: '192.168.137.50',  
    port: 22,           
    username: 'cristiancelis',  
    password: 'jcelis',   
  };

let portsData = { hostPort: 3000, containerPort: 3000 };

  app.post('/run-docker', (req, res) => {
    runContainer((err, result) => {
        if (err) {
            return res.status(500).send(`Error: ${err.message}`);
        }
        return res.status(200).send(`Container created: ${result}`);
    });
});

app.get('/stop-random-container', (req, res) => {
  // Select a random container from the list
  const randomContainer = connections[Math.floor(Math.random() * connections.length)];

    // Stop the container by its ID over SSH
    stopContainerById(randomContainer.id, (err, result) => {
      if (err) {
        return res.status(500).send(`Error: ${err.message}`);
      }
      res.send(`Container with ID ${randomContainer.id} stopped successfully.`);
    });
  });

function stopContainerById(containerId, callback) {
  const command = `docker stop ${containerId}`;
  executeSSHCommand(command, (err, stdout) => {
    if (err || !stdout) {
      return callback(new Error('Failed to stop container'));
    }
    callback(null, stdout);
  });
}

function runContainer(callback){
  const directory = '/home/cristiancelis/Documents/distribuidos/Laboratorio2/testServicio';
  portsData.hostPort += 1;
  portsData.containerPort += 1;
  const hostPort=portsData.hostPort;
  const containerPort= portsData.containerPort;
  const discoveryServer="192.168.137.203:9000"
  const ipAddress="192.168.137.50"
  const uniqueContainerName = `my-node-app-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const command = `
    cd ${directory} && \
    docker build -t my-node-app . && \
    docker run --rm --name ${uniqueContainerName} \
    -e CONTAINER_NAME=${uniqueContainerName} \
    -e HOST_PORT=${hostPort} \
    -e CONTAINER_PORT=${containerPort} \
    -e DIS_SERVERIP_PORT=${discoveryServer} \
    -e IP_ADDRESS=${ipAddress} \
    -p ${hostPort}:${containerPort} my-node-app
  `;

  executeSSHCommand(command, (err, stdout) => {
    if (err || !stdout) {
      return callback(new Error('Failed to create docker container'));
    }
    callback(null, stdout);
  });
}

function executeSSHCommand(command, callback) {
  const conn = new Client();

  conn.on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) {
        conn.end();
        return callback(err);
      }

      let outputData = '';
      let errorData = '';

      // Capture standard output
      stream.on('data', (chunk) => {
        outputData += chunk;
        console.log(`STDOUT: ${chunk}`); // Log standard output
      });

      // Capture error output
      stream.stderr.on('data', (chunk) => {
        errorData += chunk;
        console.error(`STDERR: ${chunk}`); // Log error output
      });

      stream.on('close', (code, signal) => {
        conn.end();
        // If there's error output, pass it to the callback
        if (errorData) {
          console.error('Error Output:', errorData.trim());
          return callback(new Error(errorData.trim()), outputData.trim());
        } else {
          console.log('Command executed successfully.');
          callback(null, outputData.trim());
        }
      });
    });
  }).connect(sshConfig);
}


// Cambiar de app.listen a server.listen para que Socket.IO funcione
server.listen(port, () => {
    console.log(`Monitor corriendo en el puerto: ${port}`);
});