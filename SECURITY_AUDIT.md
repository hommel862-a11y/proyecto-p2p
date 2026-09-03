# Reporte de Auditoría de Seguridad & Modelo de Amenazas (STRIDE)

**Producto:** P2P Decisor (Herramienta de Decisión para Arbitraje P2P)  
**Versión:** 1.0.0 (Enterprise Hardened)  
**Entornos de Ejecución:** Web App (SPA Zoneless), Electron Desktop (Windows/Linux/macOS), Capacitor (Android)  
**Estado:** AUDITADO & CERTIFICADO INTERNAMENTE  

---

## 1. Resumen Ejecutivo de Seguridad

El sistema **P2P Decisor** opera bajo un modelo de **Zero-Network Trust & Local Data Sovereignty**. A diferencia de los bots o terminales de trading convencionales, esta aplicación no almacena credenciales de API de exchanges, no realiza peticiones HTTP a servicios externos y no expone puertos públicos. 

La auditoría técnica evaluó la superficie de ataque, la integridad de los datos financieros calculados y la resistencia del contenedor Electron y la capa web ante vectores de ataque comunes (XSS, Path Traversal, Corrupción de Memoria, Inyección de Datos).

---

## 2. Matriz de Amenazas STRIDE & Mitigaciones

| Categoría STRIDE | Vector de Amenaza Potencial | Mitigación Implementada en el Código | Nivel Residual |
| :--- | :--- | :--- | :--- |
| **Spoofing (Suplantación)** | Suplantación del bridge IPC de Electron por scripts maliciosos inyectados. | **Narrow Context Isolation:** Preload script expone una API estricta y congelada (`createP2PApi`), validando nombres de canal contra una lista blanca fija (`ALLOWED_CHANNELS`). Fail-closed en caso de desvío. | **Nulo / Bajo** |
| **Tampering (Manipulación)** | Modificación de archivos de respaldo JSON con montos maliciosos (NaN, negativos, overflow) para alterar estadísticas y veredictos. | **Defensive Type Coercion & Clamping:** Función `parseBackup()` con validación estricta de tipos, conversión forzada de monedas mediante `clampNonNegative()` y `roundMoney()`. | **Nulo / Bajo** |
| **Repudiation (Repudio)** | Negación de cambios en parámetros de riesgo o eliminación accidental de operaciones. | **Audit Trail Service:** `AuditLoggerService` registra de forma persistente y local los eventos críticos (`CONFIG_CHANGE`, `DATA_MUTATION`, `DATA_RESTORE`, `SYSTEM_ERROR`). | **Bajo** |
| **Information Disclosure (Fuga de Información)** | Filtración de datos de transacciones u operaciones financieras a través de la red local o servidores de telemetría. | **Host Loopback Strict Binding:** El servidor estático de Electron se vincula exclusivamente a `127.0.0.1` (puerto dinámico efímero) con encabezados CSP estrictos (`connect-src 'self'`). Cero telemetría externa. | **Nulo** |
| **Denial of Service (Denegación de Servicio)** | Bloqueo de la interfaz ante archivos de respaldo corruptos o excepciones no controladas. | **Global Exception Boundary:** `GlobalErrorHandler` centralizado en Angular que intercepta excepciones en tiempo de ejecución, muestra notificaciones Toast y evita caídas de la UI. | **Bajo** |
| **Elevation of Privilege (Elevación de Privilegios)** | Escape del sandbox de Chromium para ejecutar comandos en el sistema operativo anfitrión. | **Electron Sandbox & Node Deprivation:** `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. Servidor estático con validación de path canónico (`path.resolve`) contra Path Traversal. | **Nulo / Bajo** |

---

## 3. Arquitectura de Seguridad de Electron

```
┌─────────────────────────────────────────────────────────┐
│                    PROCESO RENDERER                     │
│  - Angular 22 (Zoneless Signals)                       │
│  - Sandbox activado (Sin acceso a Node.js)             │
│  - CSP: default-src 'self'; script-src 'self'           │
└───────────────────────────┬─────────────────────────────┘
                            │
               window.electron.getVersion() (IPC Estricto)
                            │
┌───────────────────────────▼─────────────────────────────┐
│                    PRELOAD SCRIPT                       │
│  - contextBridge.exposeInMainWorld                      │
│  - Validación fail-closed de canales permitidos         │
└───────────────────────────┬─────────────────────────────┘
                            │
                      ipcRenderer.invoke
                            │
┌───────────────────────────▼─────────────────────────────┐
│                     MAIN PROCESS                        │
│  - Handlers IPC idempotentes                            │
│  - Servidor estático HTTP vinculado a 127.0.0.1         │
│  - Validación estricta de rutas con path.resolve        │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Estándares Criptográficos y de Precisión Numérica

1. **Aritmética Financiera Segura:** Se utiliza la utilidad `roundMoney(v, decimals)` para contrarrestar las anomalías de coma flotante estándar IEEE 754 (ej. `1.005` redondea con precisión a `1.01`).
2. **Generación de Identificadores:** Se utiliza la API criptográfica estándar del navegador `crypto.randomUUID()` para garantizar unicidad en las operaciones registradas.
3. **Control de Entrada y Comisiones:** Las comisiones y montos monetarios se acotan defensivamente (`0 <= commissionRate <= 0.10`), previniendo desbordamientos y divisiones por cero.

---

## 5. Recomendaciones de Seguridad Operacional para el Usuario

- Mantener respaldos periódicos en formato JSON cifrado o en almacenamiento seguro desconectado.
- En entornos compartidos, cerrar la aplicación o utilizar sesiones de usuario independientes del sistema operativo para proteger el `localStorage`.
