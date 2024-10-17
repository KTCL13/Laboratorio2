require('dotenv').config();
const express = require('express');
const axios = require('axios');
const http = require("http");
const cors = require("cors");
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const { strictEqual } = require('assert');

const app = express();
const server = http.createServer(app);  // Crear el servidor HTTP
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

app.use(cors());
app.use(express.json());

const port = process.env.PORT; 
const MAX_HISTORY = 20;
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
        console.log("Algo falló en la ip y el port");
        return res.status(400).json({ error: "Se requiere ipAddress y port" });
    }

    const serverAddress = `${instance.ipAddress}:${instance.port}`;
    const idContainer = instance.id;
    console.log("Servidor recibido: " + serverAddress);

    const existingServer = connections.find(conn => conn.instance === serverAddress);
    if (existingServer) {
        return res.status(409).json({ error: "El servidor ya está registrado" });
    }

    connections.push({
        instance: serverAddress,
        history: [],
        status: 'up',
        id: idContainer,
        logs: []
    });

    res.status(200).end();
    console.log("Instancias actualizadas: ", connections);
});

// Intervalo para verificar los servidores
setInterval(async () => {
    const timeout = (server) =>
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`La petición a ${server.instance} tardó más de 15 segundos`)), 7000)
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
            server.logs = respuesta.data;

            if (respuesta.status === 200) {
                server.status = 'up';
                server.message = `Tardó ${responseTime}`;
                console.log('Respuesta:', respuesta.data);
            } else {
                handleServerFailure(server, respuesta);
                
            }
        } catch (error) {
            handleServerFailure(server, error);
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

function handleServerFailure(server, error) {
    const isTimeout = error.message.includes('tardó más de 15 segundos');
    if(server.status != 'down'){
        server.status = 'down';
        runContainer((err, result) => {
            if (err) {
                console.log(`Error: ${err.message}`);
            }
            console.log(`Container created: ${result}`);
        });
    }
    server.message = `${isTimeout ? 'Timeout' : error.message}`;
    console.log(`Fallo en ${server.instance}: ${isTimeout ? 'Timeout' : error.message}`);
}

io.on("connection", (_) => {
    console.log("Un usuario se conectó");
});

const sshConfig = {
    host: process.env.SSH_HOST,  
    port: 22,           
    username: process.env.SSH_USERNAME,  
    password: process.env.SSH_PASSWORD,   
};

let portsData = { hostPort: 3000, containerPort: 3000 };

app.post('/run-docker', (req, res) => {
    console.log("/run-docker: iniciando una nueva instancia")
    runContainer((err, result) => {
        if (err) {
            return res.status(500).send(`Error: ${err.message}`);
        }
        res.status(200).send(`Container created: ${result}`);
    });
    console.log("/run-docker: end")
});

app.get('/stop-random-container', (req, res) => {
    console.log("/stop-random-container: Iniciando caos");

    if (connections.length === 0) {
        return res.status(400).send("No containers available to stop.");
    }

    const randomContainer = connections[Math.floor(Math.random() * connections.length)];

    stopContainerById(randomContainer.id, (err, result) => {
        if (err) {
            return res.status(500).send(`Error: ${err.message}`);
        }
        res.send(`Container with ID ${randomContainer.id} stopped successfully.`);
    });
    console.log("/stop-random-container: finalizando caos");
});


function stopContainerById(containerId, callback) {
    const command = `docker stop ${containerId}`;
    executeSSHCommand(command, callback);
}

function runContainer(callback) {
    const directory = process.env.DOCKER_DIRECTORY;
    portsData.hostPort += 1;
    portsData.containerPort += 1;
    const hostPort = portsData.hostPort;
    const containerPort = portsData.containerPort;
    const discoveryServer = process.env.DISCOVERY_SERVER;
    const ipAddress = process.env.SSH_HOST;
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

    executeSSHCommand(command, callback);
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
            stream.on('data', (chunk) => { outputData += chunk; });
            stream.stderr.on('data', (chunk) => { console.error(`STDERR: ${chunk}`); });
            stream.on('close', () => {
                conn.end();
                callback(null, outputData.trim());
            });
        });
    }).connect(sshConfig);
}

server.listen(port, () => {
    console.log(`Monitor corriendo en el puerto: ${port}`);
});
