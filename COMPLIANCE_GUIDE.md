# Guía de Cumplimiento, Gobernanza y Continuidad de Datos

**Organización:** P2P Decisor  
**Alcance:** Políticas de Respaldo, Trazabilidad, Gobernanza de Reglas de Riesgo y Recuperación ante Desastres (Disaster Recovery)  

---

## 1. Soberanía y Residencia de Datos

1. **Almacenamiento Local Único:** La totalidad de los registros de operaciones, parámetros de reglas de riesgo y registros de auditoría residen en el almacenamiento local del dispositivo del operador (`localStorage` / `StoragePort`).
2. **Cero Dependencia de la Nube:** No existen servidores intermedios, bases de datos remotas ni servicios SaaS recolectando datos financieros de las operaciones.
3. **Privacidad por Diseño (Privacy by Design):** Cumple con los más altos estándares de privacidad al no recopilar direcciones IP, identificadores bancarios completos ni información personal identificable (PII).

---

## 2. Protocolo de Respaldo y Recuperación ante Desastres (Disaster Recovery)

Para evitar la pérdida involuntaria de registros contables ante limpieza de caché del navegador, formateo del equipo o cambio de dispositivo móvil/PC:

### 2.1 Frecuencia Recomendada de Respaldo
- **Diaria:** Para operadores con más de 10 operaciones diarias (descarga de archivo `.json`).
- **Semanal:** Exportación de consolidado `.csv` para archivo histórico en software de contabilidad o Excel.

### 2.2 Procedimiento de Restauración
1. Acceder al módulo **Registro de Operaciones**.
2. Hacer clic en **Importar respaldo JSON**.
3. Seleccionar el archivo de respaldo previamente exportado.
4. El sistema ejecutará automáticamente una **validación de esquema estricta**. Si el archivo es válido, se presentará un modal de confirmación indicando el número exacto de operaciones detectadas.
5. Al confirmar, el libro mayor quedará restaurado inmediatamente y se registrará un evento de auditoría.

---

## 3. Registro de Auditoría Local (`AuditLoggerService`)

El sistema mantiene una bitácora local de hasta 200 eventos críticos para fines de control interno y verificación contable:

| Categoría | Descripción del Evento | Severidad |
| :--- | :--- | :--- |
| `CONFIG_CHANGE` | Modificación o restablecimiento de parámetros de riesgo (spread mínimo, límites de pérdida). | `info` / `warn` |
| `DATA_MUTATION` | Registro o eliminación manual de una operación de compra/venta. | `info` |
| `DATA_BACKUP` | Descarga de respaldo en JSON o exportación de libro mayor en CSV. | `info` |
| `DATA_RESTORE` | Importación y restauración de un conjunto de operaciones desde archivo. | `warn` |
| `SECURITY_ALERT`| Detección de activación de reglas de parada de emergencia (`PAUSE` / `DENY`). | `warn` |
| `SYSTEM_ERROR`  | Registro de excepciones no controladas capturadas por el `GlobalErrorHandler`. | `error` |

---

## 4. Gobernanza de las Reglas de Riesgo

El motor de reglas de riesgo actúa como una **barrera de seguridad preventiva (Circuit Breaker)**:
- **PERMITIR (ALLOW):** Todos los parámetros se encuentran dentro de los umbrales seguros configurados.
- **DENEGAR (DENY):** El spread actual o el riesgo por operación es desfavorable. Se aconseja no ejecutar la orden.
- **PAUSAR (PAUSE):** Se ha alcanzado el límite de pérdida diaria, el máximo de errores consecutivos o el tope de concurrencia. El operador debe detener operaciones y evaluar su disciplina.
