# 🚀 Terminal Real - Instrucciones de Uso

## ⚡ Inicio Rápido

### Opción 1: Usar el archivo .bat (Recomendado)
```bash
# Doble clic en:
start-terminal.bat
```

### Opción 2: Comando manual
```bash
node simple-terminal-server.js
```

## 🌐 Abrir la Página Web

1. **Abre tu navegador**
2. **Arrastra** `index-simple.html` al navegador
3. **¡Listo!** Verás la terminal integrada

## 🎯 Cómo Usar

### **Terminal Integrada:**
- La terminal aparece en la página principal
- **Comandos Unix funcionan:** `ls`, `ll`, `pwd`, `clear`
- **También comandos Windows:** `dir`, `cls`, `cd`
- **Historial:** Usa ↑/↓ para navegar comandos anteriores

### **Comandos Rápidos:**
- **cd laragon** - Ir a carpeta de Laragon
- **ls / dir** - Listar archivos
- **npm install** - Instalar dependencias
- **pnpm dev** - Ejecutar proyecto
- **git status** - Estado de Git

### **Ejecutar Proyectos:**
1. Haz clic en **"Ejecutar en Terminal"** en cualquier proyecto
2. Se abre nueva pestaña con terminal
3. **Automáticamente ejecuta:**
   - `cd "ruta-del-proyecto"`
   - `npm install` o `pnpm install`
   - `npm run dev` o `pnpm run dev`

## 🔧 Solución de Problemas

### ❌ "Conexión cerrada" o "Desconectado"
**Causa:** El servidor no está ejecutándose
**Solución:**
```bash
node simple-terminal-server.js
```

### ❌ "Error de conexión WebSocket"
**Causa:** Puerto 3002 ocupado o servidor no iniciado
**Solución:**
1. Cierra otros programas que usen puerto 3002
2. Reinicia el servidor

### ❌ Comandos como `ls` no funcionan
**Solución:** ¡Ahora sí funcionan! El servidor convierte automáticamente:
- `ls` → `Get-ChildItem` (PowerShell)
- `ll` → `Get-ChildItem -Force`
- `pwd` → `Get-Location`
- `clear` → `Clear-Host`

### ❌ "No se puede ejecutar scripts"
**Solución:** El servidor usa `-ExecutionPolicy Bypass`

## 📁 Archivos del Proyecto

- `index-simple.html` - Página principal con proyectos
- `real-terminal.html` - Terminal independiente
- `simple-terminal-server.js` - Servidor backend (USAR ESTE)
- `terminal-server.js` - Servidor complejo (no usar)
- `start-terminal.bat` - Inicio rápido

## 🎮 Comandos Útiles

### **Navegación:**
```bash
cd C:\laragon\www          # Ir a Laragon
cd bolt.diy               # Entrar a proyecto
ls                        # Listar archivos (Unix)
dir                       # Listar archivos (Windows)
pwd                       # Mostrar ubicación actual
```

### **Desarrollo:**
```bash
npm install               # Instalar dependencias
npm run dev              # Ejecutar en desarrollo
pnpm install             # Con pnpm
pnpm run dev             # Ejecutar con pnpm
```

### **Git:**
```bash
git status               # Estado del repositorio
git add .                # Agregar cambios
git commit -m "mensaje"  # Confirmar cambios
```

## 🚨 Importante

- **El servidor debe estar ejecutándose** para que funcione la terminal
- **Los comandos se ejecutan realmente** en tu sistema
- **Ten cuidado** con comandos destructivos
- **La terminal usa PowerShell** por defecto

## 🎉 ¡Disfruta tu nueva terminal integrada!

Ahora puedes desarrollar sin salir del navegador. La terminal ejecuta comandos reales y convierte automáticamente comandos Unix a Windows.