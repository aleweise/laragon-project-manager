const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = 3002;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Crear servidor HTTP
const server = http.createServer(app);

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

// Almacenar sesiones activas
const sessions = new Map();

class SimpleTerminalSession {
    constructor(id, websocket) {
        this.id = id;
        this.websocket = websocket;
        this.process = null;
        this.isActive = false;
        this.cwd = 'C:\\laragon\\www';
    }

    start() {
        try {
            console.log(`[${this.id}] Iniciando PowerShell...`);
            
            this.process = spawn('powershell.exe', ['-NoExit', '-ExecutionPolicy', 'Bypass'], {
                cwd: this.cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
                windowsHide: false
            });

            this.isActive = true;

            // Manejar salida
            this.process.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`[${this.id}] STDOUT:`, output);
                this.send('stdout', output);
            });

            this.process.stderr.on('data', (data) => {
                const output = data.toString();
                console.log(`[${this.id}] STDERR:`, output);
                this.send('stderr', output);
            });

            this.process.on('close', (code) => {
                console.log(`[${this.id}] Proceso cerrado:`, code);
                this.isActive = false;
                this.send('close', `Proceso terminado: ${code}`);
            });

            this.process.on('error', (error) => {
                console.error(`[${this.id}] Error:`, error);
                this.isActive = false;
                this.send('error', error.message);
            });

            // Enviar mensaje inicial
            setTimeout(() => {
                this.send('stdout', `PowerShell iniciado en: ${this.cwd}\nPS ${this.cwd}> `);
            }, 1000);

            return true;
        } catch (error) {
            console.error(`[${this.id}] Error iniciando:`, error);
            return false;
        }
    }

    executeCommand(command) {
        if (!this.isActive || !this.process) {
            this.send('error', 'Terminal no activa');
            return false;
        }

        try {
            // Convertir comandos Unix a Windows
            const windowsCommand = this.convertCommand(command);
            console.log(`[${this.id}] Ejecutando: ${windowsCommand}`);

            // Escribir comando
            this.process.stdin.write(windowsCommand + '\r\n');
            return true;
        } catch (error) {
            console.error(`[${this.id}] Error ejecutando:`, error);
            this.send('error', `Error: ${error.message}`);
            return false;
        }
    }

    convertCommand(command) {
        const cmd = command.trim().toLowerCase();
        
        // Conversiones comunes Unix -> Windows
        const conversions = {
            'ls': 'Get-ChildItem',
            'ls -la': 'Get-ChildItem -Force',
            'ls -l': 'Get-ChildItem',
            'll': 'Get-ChildItem -Force',
            'pwd': 'Get-Location',
            'cat': 'Get-Content',
            'clear': 'Clear-Host',
            'which': 'Get-Command'
        };

        if (conversions[cmd]) {
            return conversions[cmd];
        }

        // Reemplazar comandos que empiecen con estos
        for (const [unix, windows] of Object.entries(conversions)) {
            if (cmd.startsWith(unix + ' ')) {
                return command.replace(new RegExp('^' + unix, 'i'), windows);
            }
        }

        return command;
    }

    send(type, data) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({
                type,
                data,
                sessionId: this.id,
                timestamp: new Date().toISOString()
            }));
        }
    }

    kill() {
        if (this.process && this.isActive) {
            this.process.kill('SIGTERM');
            setTimeout(() => {
                if (this.isActive) {
                    this.process.kill('SIGKILL');
                }
            }, 3000);
        }
        this.isActive = false;
    }
}

// Manejar conexiones WebSocket
wss.on('connection', (ws, req) => {
    console.log('Nueva conexión WebSocket');
    
    let session = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data.type);
            
            switch (data.type) {
                case 'start_session':
                    const sessionId = data.sessionId || `session_${Date.now()}`;
                    session = new SimpleTerminalSession(sessionId, ws);
                    
                    if (session.start()) {
                        sessions.set(sessionId, session);
                        ws.send(JSON.stringify({
                            type: 'session_started',
                            sessionId,
                            success: true
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'session_error',
                            error: 'No se pudo iniciar la terminal'
                        }));
                    }
                    break;

                case 'execute_command':
                    if (session && session.isActive) {
                        session.executeCommand(data.command);
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'No hay sesión activa'
                        }));
                    }
                    break;

                case 'kill_session':
                    if (session) {
                        session.kill();
                        sessions.delete(session.id);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Error procesando mensaje'
            }));
        }
    });

    ws.on('close', () => {
        console.log('Conexión WebSocket cerrada');
        if (session) {
            session.kill();
            sessions.delete(session.id);
        }
    });

    ws.on('error', (error) => {
        console.error('Error WebSocket:', error);
    });
});

// Limpiar al cerrar
process.on('SIGINT', () => {
    console.log('Cerrando servidor...');
    
    for (const [sessionId, session] of sessions) {
        console.log(`Cerrando sesión: ${sessionId}`);
        session.kill();
    }
    
    setTimeout(() => {
        process.exit(0);
    }, 2000);
});

server.listen(PORT, () => {
    console.log(`🚀 Servidor de terminal simple en http://localhost:${PORT}`);
    console.log(`📡 WebSocket en ws://localhost:${PORT}`);
    console.log(`📁 Directorio base: C:\\laragon\\www`);
});