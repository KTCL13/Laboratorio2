const express = require('express');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors')
const { Client } = require('ssh2');
const crypto = require('crypto');

const app = express();
const port = 7000;

app.use(express.json());
app.use(cors());
const server = http.createServer(app); 
const io = new Server(server); 



let connections = [];

const sshConfig = {
    host: '192.168.77.170',  
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
        res.status(200).send(`Container created: ${result}`);
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
  const directory = '/home/cristiancelis/Documents/distribuidos/testServicio';
  portsData.hostPort += 1;
  portsData.containerPort += 1;
  const hostPort=portsData.hostPort;
  const containerPort= portsData.containerPort;
  const discoveryServer="192.168.1.17:9000"
  const ipAddress="192.168.1.18"
  const uniqueContainerName = `my-node-app-${crypto.randomBytes(4).toString('hex')}`;

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

// Guardar instancias de los servidores
app.post("/monitor", (req, res) => {
    const instance = req.body;

    if (!instance || !instance.ipAddress || !instance.port) {
        return res.status(400).json({ error: "Se requiere ipAddress y port" });
    }

    const serverAddress = `${instance.ipAddress}:${instance.port}`;

    const existingServer = connections.find(conn => conn.instance === serverAddress);
    if (existingServer) {
        return res.status(409).json({ error: "El servidor ya está registrado" });
    }

    connections.push({
        instance: serverAddress,
        requests: 0,
        id: instance.id,
        logs: [],
        history: [],
        tried: false,
        status: 'up'
    });

    res.status(200).end();
    console.log("Instancias actualizadas: ", connections);
});

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
                console.log('Respuesta:', respuesta.data);
            } else {
                server.status = 'down';
                server.history.push({
                    timestamp: new Date().toISOString(),
                    status: 'down',
                    error: `Código de estado: ${respuesta.status}`
                });
            }
        } catch (error) {
            server.status = 'down';
            server.history.push({
                timestamp: new Date().toISOString(),
                status: 'down',
                error: error.message
            });
            console.log(`Fallo en ${server.instance}: ${error.message}`);
        }
    });

    await Promise.all(promises);
    io.emit('update', { servers: connections });
}, 60000);


app.listen(port, () => {
    console.log(`Monitor corriendo en el puerto: ${port}`);
});
