const express = require('express');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const config = require('./config');

// Validate configuration
const configErrors = config.validate();
if (configErrors.length > 0) {
    console.error('Configuration errors:');
    configErrors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
}

const app = express();
const PORT = config.port;

// Middleware
app.use(cors({
    origin: config.allowedOrigins,
    credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('.'));

// Security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Enhanced command validation
class CommandValidator {
    constructor() {
        this.dangerousCommands = [
            'rm -rf', 'del /f', 'format', 'shutdown', 'reboot',
            'mkfs', 'fdisk', 'dd if=', 'sudo rm', 'sudo shutdown',
            'halt', 'poweroff', 'init 0', 'telinit 0'
        ];

        this.dangerousPatterns = [
            /rm\s+-rf\s+\//, // rm -rf /
            /del\s+\/[fs]\s+/, // del /f or /s
            />\s*\/dev\//, // redirect to device files
            /curl.*\|\s*sh/, // curl pipe to shell
            /wget.*\|\s*sh/, // wget pipe to shell
        ];
    }

    validate(command) {
        if (!command || typeof command !== 'string') {
            return { valid: false, error: 'Comando inválido' };
        }

        if (command.length > 1000) {
            return { valid: false, error: 'Comando demasiado largo' };
        }

        const lowerCommand = command.toLowerCase().trim();

        // Check dangerous commands
        for (const dangerous of this.dangerousCommands) {
            if (lowerCommand.includes(dangerous.toLowerCase())) {
                return { valid: false, error: 'Comando no permitido por seguridad' };
            }
        }

        // Check dangerous patterns
        for (const pattern of this.dangerousPatterns) {
            if (pattern.test(command)) {
                return { valid: false, error: 'Patrón de comando no permitido' };
            }
        }

        return { valid: true };
    }
}

const commandValidator = new CommandValidator();
const validateCommand = (command) => commandValidator.validate(command);

// Crear servidor HTTP
const server = http.createServer(app);

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

// Almacenar sesiones de terminal activas
const terminalSessions = new Map();

// Logger utility
const logger = {
    info: (message, data = {}) => console.log(`[INFO] ${new Date().toISOString()} - ${message}`, data),
    error: (message, error = {}) => console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error),
    warn: (message, data = {}) => console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, data),
    debug: (message, data = {}) => {
        if (process.env.NODE_ENV === 'development') {
            console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, data);
        }
    }
};

// Use configuration from config.js
const DEFAULT_CONFIG = config.terminal;

/**
 * Represents a terminal session with process management and WebSocket communication
 */
class TerminalSession {
    /**
     * Creates a new terminal session
     * @param {string} id - Unique session identifier
     * @param {Object} config - Session configuration options
     */
    constructor(id, config = {}) {
        this.id = id;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.process = null;
        this.isActive = false;
        this.history = [];
        this.currentDir = this.config.cwd;
        this.websocket = null;
        this.createdAt = new Date();
        this.lastActivity = new Date();

        // Auto-cleanup timer
        this.cleanupTimer = setTimeout(() => {
            this.kill();
            logger.warn(`Session ${this.id} auto-cleaned due to inactivity`);
        }, this.config.sessionTimeout);
    }

    start() {
        try {
            // Configurar argumentos según el shell
            let args = [];
            if (this.config.shell.includes('powershell')) {
                args = ['-NoExit', '-ExecutionPolicy', 'Bypass'];
            } else if (this.config.shell.includes('cmd')) {
                args = ['/k'];
            }

            console.log(`Iniciando shell: ${this.config.shell} con args:`, args);

            this.process = spawn(this.config.shell, args, {
                cwd: this.currentDir,
                env: this.config.env,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,
                windowsHide: false
            });

            this.isActive = true;

            // Manejar salida estándar
            this.process.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`[${this.id}] STDOUT:`, output);
                this.sendToClient('stdout', output);
            });

            // Manejar errores
            this.process.stderr.on('data', (data) => {
                const output = data.toString();
                console.log(`[${this.id}] STDERR:`, output);
                this.sendToClient('stderr', output);
            });

            // Manejar cierre del proceso
            this.process.on('close', (code) => {
                console.log(`[${this.id}] Proceso cerrado con código:`, code);
                this.isActive = false;
                this.sendToClient('close', `Proceso terminado con código: ${code}`);
            });

            // Manejar errores del proceso
            this.process.on('error', (error) => {
                console.error(`[${this.id}] Error del proceso:`, error);
                this.isActive = false;
                this.sendToClient('error', `Error: ${error.message}`);
            });

            // Enviar mensaje inicial
            setTimeout(() => {
                this.sendToClient('stdout', `Terminal iniciada en: ${this.currentDir}\n`);
            }, 1000);

            return true;
        } catch (error) {
            console.error('Error starting terminal:', error);
            return false;
        }
    }

    executeCommand(command) {
        if (!this.isActive || !this.process) {
            logger.error(`Cannot execute command: session ${this.id} is not active`);
            return false;
        }

        // Validate command
        const validation = validateCommand(command);
        if (!validation.valid) {
            this.sendToClient('error', validation.error);
            return false;
        }

        try {
            this.updateActivity();

            // Agregar al historial con límite
            this.addToHistory({
                command,
                timestamp: new Date().toISOString(),
                cwd: this.currentDir
            });

            // Enviar comando al proceso
            this.process.stdin.write(command + '\n');
            logger.debug(`Command executed in session ${this.id}`, { command });
            return true;
        } catch (error) {
            logger.error('Error executing command:', error);
            this.sendToClient('error', `Error ejecutando comando: ${error.message}`);
            return false;
        }
    }

    updateActivity() {
        this.lastActivity = new Date();
        // Reset cleanup timer
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
        }
        this.cleanupTimer = setTimeout(() => {
            this.kill();
            logger.warn(`Session ${this.id} auto-cleaned due to inactivity`);
        }, this.config.sessionTimeout);
    }

    addToHistory(entry) {
        this.history.push(entry);
        // Maintain history size limit
        if (this.history.length > this.config.maxHistorySize) {
            this.history = this.history.slice(-this.config.maxHistorySize);
        }
    }

    sendToClient(type, data) {
        // Enviar datos a través de WebSocket
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({
                type,
                data,
                sessionId: this.id,
                timestamp: new Date().toISOString()
            }));
        }
    }

    setWebSocket(ws) {
        this.websocket = ws;
    }

    kill() {
        if (this.process && this.isActive) {
            try {
                this.process.kill('SIGTERM');
                setTimeout(() => {
                    if (this.isActive && this.process) {
                        try {
                            this.process.kill('SIGKILL');
                        } catch (error) {
                            logger.warn(`Failed to force kill session ${this.id}:`, error);
                        }
                    }
                }, 5000);
            } catch (error) {
                logger.warn(`Failed to terminate session ${this.id}:`, error);
            }
        }
        this.isActive = false;

        // Clear cleanup timer
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    changeDirectory(newDir) {
        if (fs.existsSync(newDir)) {
            this.currentDir = newDir;
            return true;
        }
        return false;
    }
}

// WebSocket Message Handlers
class WebSocketMessageHandler {
    constructor(ws, terminalSessions, logger) {
        this.ws = ws;
        this.terminalSessions = terminalSessions;
        this.logger = logger;
        this.sessionId = null;
        this.session = null;
    }

    sendResponse(type, data) {
        this.ws.send(JSON.stringify({ type, ...data }));
    }

    sendError(error) {
        this.sendResponse('error', { error });
    }

    handleStartSession(data) {
        this.sessionId = data.sessionId || `session_${Date.now()}`;
        this.session = new TerminalSession(this.sessionId, data.config);
        this.session.setWebSocket(this.ws);

        if (this.session.start()) {
            this.terminalSessions.set(this.sessionId, this.session);
            this.sendResponse('session_started', {
                sessionId: this.sessionId,
                success: true
            });
        } else {
            this.sendResponse('session_error', {
                error: 'No se pudo iniciar la sesión de terminal'
            });
        }
    }

    handleExecuteCommand(data) {
        if (this.session && this.session.isActive) {
            this.session.executeCommand(data.command);
        } else {
            this.sendError('No hay sesión activa');
        }
    }

    handleChangeDirectory(data) {
        if (this.session) {
            if (this.session.changeDirectory(data.directory)) {
                this.sendResponse('directory_changed', {
                    directory: data.directory
                });
            } else {
                this.sendError('Directorio no encontrado');
            }
        }
    }

    handleGetHistory() {
        if (this.session) {
            this.sendResponse('history', {
                history: this.session.history
            });
        }
    }

    handleKillSession() {
        if (this.session) {
            this.session.kill();
            this.terminalSessions.delete(this.sessionId);
            this.sendResponse('session_killed', {
                sessionId: this.sessionId
            });
        }
    }

    handleMessage(message) {
        try {
            const data = JSON.parse(message);

            if (!data.type) {
                throw new Error('Tipo de mensaje requerido');
            }

            const handlers = {
                'start_session': () => this.handleStartSession(data),
                'execute_command': () => this.handleExecuteCommand(data),
                'change_directory': () => this.handleChangeDirectory(data),
                'get_history': () => this.handleGetHistory(),
                'kill_session': () => this.handleKillSession()
            };

            const handler = handlers[data.type];
            if (handler) {
                handler();
            } else {
                this.sendError(`Tipo de mensaje no soportado: ${data.type}`);
            }
        } catch (error) {
            this.logger.error('Error processing WebSocket message:', error);
            this.sendError('Error procesando mensaje');
        }
    }

    cleanup() {
        if (this.session) {
            this.session.kill();
            if (this.sessionId) {
                this.terminalSessions.delete(this.sessionId);
            }
        }
    }
}

// Manejar conexiones WebSocket
wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    logger.info('Nueva conexión WebSocket establecida', { clientIP });

    // Check session limit
    if (terminalSessions.size >= DEFAULT_CONFIG.maxSessions) {
        ws.send(JSON.stringify({
            type: 'error',
            error: 'Máximo número de sesiones alcanzado'
        }));
        ws.close();
        return;
    }

    const messageHandler = new WebSocketMessageHandler(ws, terminalSessions, logger);

    ws.on('message', (message) => messageHandler.handleMessage(message));

    ws.on('close', () => {
        logger.info('Conexión WebSocket cerrada');
        messageHandler.cleanup();
    });

    ws.on('error', (error) => {
        logger.error('Error en WebSocket:', error);
    });
});

// Rate limiting utility
class RateLimiter {
    constructor(windowMs = 60 * 1000, maxRequests = 30) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.clients = new Map();

        // Cleanup expired entries every 5 minutes
        setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }

    middleware() {
        return (req, res, next) => {
            const clientIP = req.ip || req.connection.remoteAddress;
            const now = Date.now();

            if (!this.clients.has(clientIP)) {
                this.clients.set(clientIP, { count: 1, resetTime: now + this.windowMs });
                return next();
            }

            const clientData = this.clients.get(clientIP);
            if (now > clientData.resetTime) {
                clientData.count = 1;
                clientData.resetTime = now + this.windowMs;
                return next();
            }

            if (clientData.count >= this.maxRequests) {
                return res.status(429).json({
                    error: 'Demasiadas solicitudes',
                    retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
                });
            }

            clientData.count++;
            next();
        };
    }

    cleanup() {
        const now = Date.now();
        for (const [clientIP, data] of this.clients.entries()) {
            if (now > data.resetTime) {
                this.clients.delete(clientIP);
            }
        }
    }
}

const rateLimiter = new RateLimiter(
    config.rateLimit?.windowMs || 60 * 1000,
    config.rateLimit?.maxRequests || 30
);
const rateLimit = rateLimiter.middleware();

// API REST endpoints
app.get('/api/terminal/sessions', rateLimit, (req, res) => {
    try {
        const sessions = Array.from(terminalSessions.entries()).map(([id, session]) => ({
            id,
            isActive: session.isActive,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            currentDir: session.currentDir
        }));
        res.json({ sessions, count: sessions.length });
    } catch (error) {
        logger.error('Error getting sessions:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/api/terminal/execute', rateLimit, (req, res) => {
    try {
        const { command, cwd } = req.body;

        if (!command) {
            return res.status(400).json({ error: 'Comando requerido' });
        }

        const validation = validateCommand(command);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const execOptions = {
            cwd: cwd || DEFAULT_CONFIG.cwd,
            timeout: 30000, // 30 seconds timeout
            maxBuffer: 1024 * 1024 // 1MB buffer
        };

        exec(command, execOptions, (error, stdout, stderr) => {
            res.json({
                success: !error,
                stdout: stdout || '',
                stderr: stderr || '',
                error: error ? error.message : null,
                timestamp: new Date().toISOString()
            });
        });
    } catch (error) {
        logger.error('Error executing command:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeSessions: terminalSessions.size,
        memoryUsage: process.memoryUsage()
    });
});

// Endpoint para obtener información del sistema
app.get('/api/system/info', rateLimit, (req, res) => {
    try {
        res.json({
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            cwd: process.cwd(),
            defaultShell: DEFAULT_CONFIG.shell,
            maxSessions: DEFAULT_CONFIG.maxSessions,
            activeSessions: terminalSessions.size
        });
    } catch (error) {
        logger.error('Error getting system info:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    // Close WebSocket server
    wss.close(() => {
        logger.info('WebSocket server closed');
    });

    // Close HTTP server
    server.close(() => {
        logger.info('HTTP server closed');
    });

    // Clean up terminal sessions
    const sessionCleanupPromises = [];
    for (const [sessionId, session] of terminalSessions) {
        logger.info(`Closing session: ${sessionId}`);
        sessionCleanupPromises.push(
            new Promise((resolve) => {
                session.kill();
                setTimeout(resolve, 1000);
            })
        );
    }

    Promise.all(sessionCleanupPromises).then(() => {
        logger.info('All sessions closed. Exiting...');
        process.exit(0);
    }).catch((error) => {
        logger.error('Error during cleanup:', error);
        process.exit(1);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
        logger.error('Force exit after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start server with error handling
server.listen(PORT, (error) => {
    if (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }

    logger.info(`🚀 Terminal server running on http://localhost:${PORT}`);
    logger.info(`📡 WebSocket available at ws://localhost:${PORT}`);
    logger.info(`📁 Base directory: ${DEFAULT_CONFIG.cwd}`);
    logger.info(`🖥️  Default shell: ${DEFAULT_CONFIG.shell}`);
    logger.info(`⚙️  Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`🔒 Max sessions: ${DEFAULT_CONFIG.maxSessions}`);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
    } else {
        logger.error('Server error:', error);
    }
    process.exit(1);
});