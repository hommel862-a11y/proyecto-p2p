# ESPECIFICACIÓN MAESTRA: MÓDULO PORTAFOLIO FINANCIERO, PYME & PRESUPUESTOS 360

## 1. VISIÓN GENERAL Y REGLA DE ORO (AISLAMIENTO P2P)
Este módulo es un Portafolio Financiero Integral, Proyector de Flujo de Caja, Gestor Comercial (Pyme) y Generador de Presupuestos integrado dentro de la suite principal, pero 100% aislado del ruido operativo de la Mesa P2P.
- Regla de Oro de Aislamiento: NO se deben mezclar las transferencias bancarias, pagos móviles ni el capital de rotación del arbitraje P2P dentro de este módulo.
- Único Puente con la Mesa P2P: Solo existirá un botón/función llamado "Traer Ganancia Neta P2P del Día", que enviará únicamente el Profit Neto positivo del día (si se operó) como un único registro limpio de entrada.

## 2. ARQUITECTURA DE ENTRADA DE DATOS (PUENTE VSR / OCR + TELEGRAM + GOOGLE DRIVE)
El módulo se conectará con las herramientas ya existentes: Módulo Comprobantes OCR / VSR, Bot de Telegram y Sincronización con Google Drive (Excel + PDF).
1. Enrutador en Bandeja VSR / OCR: Selector de destino [ Mesa P2P ] vs. [ Portafolio Financiero ]. Si viene del Bot de Telegram con nota de gasto/ingreso/proveedor/nómina, el Agente IA lo pre-clasifica para Finanzas.
2. Motor Bimonetario (Bs ↔ USD): Congela automáticamente la equivalencia en USD usando la tasa del momento exacto de la operación (guardando monto_bs, tasa_aplicada, monto_usd) y detecta referencias duplicadas.
3. Registro Rápido en Efectivo: Genera recibo interno en PDF cuando no hay capture bancario.
4. Guardado en Google Drive: Archiva el PDF en carpetas (/Finanzas_360/Año/Mes/Categoría/) y añade la fila al Libro Maestro de Excel (.xlsx) en Drive con enlace directo desde la app.

## 3. INTERFAZ PRINCIPAL (BENTO GRID) Y MODO CAMALEÓNICO
Selector superior en tiempo real: [ 🌐 Todos | 👤 Personal | 🏢 Negocio / Pyme ].
Los 4 Pilares Contables:
1. ACTIVOS (Bóvedas de Liquidez y Patrimonio): Saldos en vivo por canal: Zelle/USD, Bancos Nacionales Bs (con equivalente USD), Otras Financieras/Cripto, Efectivo, Cuentas por Cobrar y Activos Fijos.
2. PASIVOS (Deudas y Por Pagar): Facturas de proveedores, cuotas de Cashea/financiamientos y gastos fijos del mes por vencer.
3. ENTRADAS (Ingresos): Ganancia Neta P2P diaria, Sueldo, Pagos recibidos por Zelle/Bs/Efectivo, Ventas de negocio y Cobro de presupuestos.
4. SALIDAS (Gastos Dinámicos): Categorías abiertas tanto personales (corte de pelo, pintura, hogar, salud) como de empresa (proveedores, nómina, servicios). Descuenta del Activo usado o abona al Pasivo correspondiente.

## 4. MOTOR DE ESTADÍSTICAS Y PROYECTOR EN 3 HORIZONTES
1. Vista Día a Día: Bitácora diaria y links directos a PDF/Excel en Drive.
2. Estadísticas Semanales (7 Días): Comparativa vs. semana anterior, Mapa de Calor por día de semana y distribución por método de pago.
3. Estadísticas Mensuales (Mes a Mes - 12 Meses): Radiografía por categorías, Velocímetro de gasto (Burn Rate), Cono Predictivo IA al día 30 y Simulador "¿Qué pasa si...?".
4. Estadísticas Trimestrales (90 Días): Comparativa Mes 1 vs. Mes 2 vs. Mes 3, detector de inflación en costos y reporte trimestral en Drive.

## 5. SUB-MÓDULO 1: PROYECTOR DE COMPRAS & CALCULADORA CASHEA / FINANCIAMIENTOS
1. Proyector Dual (Moto, Vehículo, TV, Equipos): Compara Camino A (Reuniendo el dinero mes a mes según el flujo libre) vs. Camino B (Compra financiada).
2. Calculadora de Flujo de Caja Cashea y Créditos: Niveles Cashea configurables (Inicial 60%, 50%, 40%, 30%, 25%, 20%), planes de 1, 3, 6, 9, 12 cuotas (cada 14 días) o crédito vehicular (12-24 meses). Calcula el descuento de la inicial hoy y el impacto quincenal/mensual en el flujo de caja.
3. Sincronización Cashea por VSR/Telegram: Lee captures de "Mis Cuotas" para agendar vencimientos cada 14 días en Pasivos, alerta choques de liquidez con gastos fijos/sueldo, y descuenta cuotas al subir el capture del pago a tasa BCV.

## 6. SUB-MÓDULO 2: APARTADO PYME / NEGOCIO (TALLER, MINIMARKET, ZAPATERÍA, ACCESORIOS)
1. Directorio de Proveedores y Cuentas por Pagar: Carga de facturas por foto en VSR/Telegram, fechas de vencimiento y control de abonos parciales.
2. Inventario Táctico Semáforo: Stock Óptimo (Verde), Alerta de Reposición (Amarillo) y Agotado/Mercancía Fría (Rojo).
3. Cortafuegos de Caja Comercial (3 Gavetas): Separa ingresos en 1) Fondo de Reposición de Mercancía, 2) Gaveta Operativa (Nómina, Alquiler, Servicios) y 3) Utilidad Neta y Mejoras.
4. Contabilidad Práctica (P&L) y Proyector de Mejoras (CAPEX): Estado de Ganancias y Pérdidas automático y meta de ahorro para mejoras del local.
5. Escuadrón de 4 Agentes IA: Agente de Nómina, Agente de Proveedores, Agente de Compras/Stock y Agente de Mejoras enviando alertas en pantalla y por Telegram.

## 7. SUB-MÓDULO 3: GENERADOR DE PRESUPUESTOS (TALLERES Y OBRA POR m²)
1. Modo Taller Automotriz (Latonería y Pintura): Cotización por piezas/paños, nivel de daño, código/tipo de color (Bicapa, Tricapa, Perlado) y receta automática de materiales (pintura, barniz, fondo, masilla, lijas, tirro, pulitura).
2. Modo Construcción y Hogar (Recetas por m²): Cálculo automático de materiales y mano de obra por m² para Pintura de casas/locales, Drywall y Cerámica/Porcelanato (+10% desperdicio).
3. Motor Dual de Mano de Obra: Cálculo de pago al trabajador por Comisión (%) / Tarifa por m², o por Sueldo Fijo prorrateado por días de trabajo.
4. Anticipo Blindado, Voz en Telegram y Doble PDF: Calcula el anticipo mínimo para cubrir 100% costos, permite dictar presupuestos por audio en Telegram y exporta 2 PDFs (uno comercial limpio para el cliente ocultando costos internos, y otro interno de rentabilidad para Google Drive). Al aprobarse, alimenta Caja, Cuentas por Cobrar, Compras y Nómina.
