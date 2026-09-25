# Términos de Uso, Privacidad Soberana y Política de Gestión de Riesgo

**Versión:** 1.0.0  
**Fecha de Entrada en Vigor:** Septiembre 2026  
**Ámbito de Aplicación:** Herramienta de Soporte a la Decisión P2P (Escritorio, Web y Móvil Android)

---

## 1. Naturaleza Jurídica del Software

1. **Herramienta de Asistencia y Cálculo Personal (*Decision-Support Utility*):**  
   Esta aplicación es exclusivamente un software de cálculo matemático, análisis estadístico de mercado y ordenamiento contable local. **NO** constituye un exchange, **NO** es una entidad financiera, **NO** es una pasarela de pagos y **NO** es un Proveedor de Servicios de Activos Virtuales (VASP/PSAV) bajo los lineamientos del Grupo de Acción Financiera Internacional (GAFI/FATF) ni de las legislaciones nacionales.

2. **Ausencia de Custodia e Intermediación:**  
   El software **NO custodia, retiene, transfiere ni tiene acceso jamás a fondos**, ni en criptoactivos (USDT, BTC, etc.) ni en moneda de curso legal (VES, USD, etc.). Toda transferencia de activos o dinero fiduciario es ejecutada directamente por el usuario a través de sus cuentas bancarias personales y exchanges oficiales de su elección (ej. Binance P2P).

3. **Arquitectura *Human-in-the-Loop* (Control Humano Absoluto):**  
   El sistema no ejecuta órdenes autónomas en cuentas de terceros ni transfiere activos sin supervisión. Los algoritmos, fórmulas de arbitraje, predicciones de brecha BCV y semáforos de riesgo son de carácter consultivo; la decisión y ejecución final recaen única y exclusivamente en el operador humano.

---

## 2. Soberanía de Datos y Privacidad Cero Telemetría (*Zero Data Collection*)

1. **Cero Recopilación de Datos Personales (*Zero Telemetry*):**  
   Los desarrolladores y mantenedores de este proyecto **NO recopilan, NO almacenan, NO procesan, NO transmiten ni tienen acceso a ningún dato del usuario**. La aplicación no cuenta con servidores centrales, bases de datos remotas ni servicios analíticos que capturen direcciones IP, telemetría o identificadores personales.

2. **Aislamiento en el Entorno Local del Usuario:**  
   La totalidad del libro contable, parámetros de spread, listas de contrapartes, historiales de auditoría y registros operativos residen exclusivamente en el almacenamiento local del dispositivo del usuario (`IndexedDB` en navegadores/móvil, `SQLite` local en escritorio).

3. **Integraciones en la Nube Privada del Usuario (*Bring Your Own Credentials / Cloud*):**  
   Cualquier funcionalidad opcional de respaldo o sincronización (como copias de seguridad de recibos en Google Drive o sincronización de libros en Google Sheets):
   - Se ejecuta conectando directamente el dispositivo del usuario con la cuenta personal de Google Workspace / Google Cloud del propio usuario.
   - Utiliza credenciales, tokens OAuth y carpetas privadas pertenecientes al usuario.
   - Ningún dato transita por intermediarios o servidores de terceros ajenos a la infraestructura personal del usuario.

---

## 3. Descargo de Responsabilidad y Exención de Garantías (*Disclaimer*)

1. **Distribución "Tal Cual" (*As-Is*):**  
   El software se proporciona de forma abierta y personal sin garantías de ningún tipo, expresas o implícitas, incluyendo, sin limitación, garantías de comerciabilidad, idoneidad para un propósito particular o ausencia de errores.

2. **Exención por Pérdidas Financieras:**  
   En ningún caso los creadores o colaboradores del proyecto serán responsables por pérdidas de capital, márgenes negativos, discrepancias cambiarias, retrasos en la liquidación o fluctuaciones súbitas de precios en los mercados cambiarios o criptográficos.

3. **Exención por Acciones Regulatorias o Bancarias:**  
   El usuario asume el 100% de la responsabilidad sobre el uso de sus instrumentos bancarios. Los desarrolladores no se responsabilizan por bloqueos de cuentas, cierres preventivos, solicitudes de justificación de fondos por parte de superintendencias bancarias (como SUDEBAN en Venezuela u organismos equivalentes) ni investigaciones tributarias derivadas de la actividad comercial del usuario.

4. **Cumplimiento Tributario y Legal:**  
   Es obligación exclusiva del usuario declarar sus ganancias, retenciones y cumplir con el marco impositivo y aduanero aplicable en su jurisdicción fiscal.

---

## 4. Política de Prevención de Delitos Financieros y Fraude (AML & Compliance)

Los usuarios de la herramienta se comprometen a respetar los siguientes estándares de integridad operativa:

1. **Prohibición Estricta de Pagos de Terceros (*Third-Party Payment Ban*):**  
   Como regla fundamental contra estafas de triangulación, suplantación de identidad y legitimación de capitales, el operador debe verificar que la cuenta bancaria de origen o destino coincida exactamente con la identidad verificada de la contraparte en la plataforma de intercambio (cédula, nombre y apellido). La herramienta provee detectores de listas negras y auditoría de comprobantes OCR para reforzar esta verificación.

2. **Uso Exclusivo para Fines Lícitos:**  
   Queda terminantemente prohibido el empleo de los algoritmos o utilidades del sistema para facilitar actividades de lavado de dinero, financiamiento al terrorismo, adquisición de bienes ilícitos o evasión de controles cambiarios sancionados por la ley.

3. **Gestión de Saturación y Rotación Bancaria:**  
   El operador debe utilizar los módulos de control de velocidad y alertas anti-saturación para planificar su operativa dentro de los umbrales transaccionales razonables de su perfil bancario, previniendo el uso indebido de canales financieros personales para volúmenes de carácter corporativo no declarados.

---

## 5. Política de Gestión de Riesgo Operativo (*Golden Rule & Circuit Breakers*)

1. **Regla de Oro Institucional (Spread Neto $\ge 0.50\%$):**  
   Se desaconseja categóricamente realizar operaciones de compra/venta con márgenes netos inferiores al 0.50% o márgenes negativos, ya que incrementan exponencialmente la exposición a la devaluación del inventario fiduciario en bolívares (VES).

2. **Respeto a las Señales de Parada de Emergencia (*Circuit Breaker*):**  
   Ante estados de `PAUSE` (activación de límite de pérdida diaria, exceso de errores consecutivos o alertas de saturación) o `DENY` (riesgo elevado de contraparte o margen deficitario), el operador debe suspender la emisión de órdenes y revisar su disciplina operativa antes de reanudar el libro mayor.

---

## 6. Aceptación Expresa

La instalación, compilación, ejecución o utilización continuada de esta aplicación en cualquier plataforma (PC, Web o Teléfono Android) constituye la lectura, comprensión y aceptación irrestricta de las presentes cláusulas de Términos de Uso, Privacidad Soberana y Gestión de Riesgo.
