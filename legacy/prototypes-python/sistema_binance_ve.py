import asyncio
import csv
import json
import random
import os
from typing import Dict, List, Optional
from datetime import datetime


# =============================================================================
# MODULO 1: FUENTES DE DATOS (HerramientasIA)
# =============================================================================
class HerramientasIA:
    """Cinturon de utilidades: cada metodo simula una consulta a fuentes reales."""

    @staticmethod
    async def obtener_tasa_bcv() -> Dict:
        # Tasa BCV real del 29-30 de julio 2026
        return {"moneda": "USD", "oficial": 744.22, "fuente": "BCV", "timestamp": "2026-07-30"}

    @staticmethod
    async def obtener_tasa_euro_oficial() -> Dict:
        # Tasa BCV Euro real del 29-30 de julio 2026
        return {"moneda": "EUR", "oficial": 846.07, "fuente": "BCV", "timestamp": "2026-07-30"}

    @staticmethod
    async def obtener_tasa_euro_paralelo() -> Dict:
        return {"moneda": "EUR", "paralelo": 915.00, "fuente": "P2P_Monitor", "timestamp": "2026-07-30"}

    @staticmethod
    async def obtener_tasa_p2p_usdt() -> Dict:
        return {"moneda": "USDT", "compra": 890.50, "venta": 898.00, "spread_p2p": 7.50}

    @staticmethod
    async def obtener_earn_apr() -> Dict:
        return {"USDT_flexible": 3.85, "USDC_flexible": 5.74, "EUR_flexible": 2.10}

    @staticmethod
    async def analizar_riesgos_legales() -> Dict:
        return {
            "nivel": "ALTO",
            "factores": ["Detenciones por arbitraje", "Sundde fiscalizando"],
            "recomendacion": "Operar montos fraccionados"
        }


# =============================================================================
# MODULO 2: REGISTRO CSV (Bitacora de Operaciones)
# =============================================================================
class RegistroP2P:
    """
    Registra cada operacion P2P en un archivo CSV con calculo automatico
    de spread vs BCV, clasificacion de rentabilidad y notas.
    """

    ENCABEZADOS = [
        "Fecha/Hora", "Tipo", "Par", "Cantidad", "Tasa Bs",
        "Total Bs", "Banco", "Contraparte", "Tiempo Liberacion (min)",
        "Spread vs BCV", "Clasificacion", "Estado", "Notas"
    ]

    def __init__(self, archivo: str = "mi_operaciones_binance.csv"):
        self.archivo = archivo
        self._inicializar_archivo()

    def _inicializar_archivo(self):
        """Crea el archivo CSV con encabezados si no existe."""
        if not os.path.exists(self.archivo):
            with open(self.archivo, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(self.ENCABEZADOS)
            print(f"  [CSV] Archivo creado: {self.archivo}")
        else:
            print(f"  [CSV] Archivo existente cargado: {self.archivo}")

    def registrar(self, tipo: str, par: str, cantidad: float, tasa: float,
                  banco: str, contraparte: str, tiempo_liberacion: str,
                  bcv_actual: float = 744.22, notas: str = "") -> Dict:
        """
        Registra una operacion y calcula metricas automaticamente.
        
        Args:
            tipo: "COMPRA" o "VENTA"
            par: "USDT" o "EUR"
            cantidad: Cantidad de cripto operada
            tasa: Tasa en Bs por unidad
            banco: Banco utilizado
            contraparte: Usuario P2P (@nombre)
            tiempo_liberacion: Tiempo en minutos
            bcv_actual: Tasa oficial BCV del dia
            notas: Observaciones adicionales
        
        Returns:
            Dict con el resumen de la operacion registrada
        """
        # Calculos automaticos
        total_bs = cantidad * tasa
        spread = ((tasa - bcv_actual) / bcv_actual) * 100
        ganancia_vs_bcv = total_bs - (cantidad * bcv_actual)

        # Clasificacion por umbral de spread
        if spread > 22:
            clasificacion = "EXCELENTE"
        elif spread > 18:
            clasificacion = "GANANCIA"
        elif spread > 12:
            clasificacion = "ACEPTABLE"
        else:
            clasificacion = "RESERVA"

        # Escribir fila en CSV
        fila = [
            datetime.now().strftime("%Y-%m-%d %H:%M"),
            tipo,
            par,
            f"{cantidad:.2f}",
            f"{tasa:.2f}",
            f"{total_bs:,.2f}",
            banco,
            contraparte,
            tiempo_liberacion,
            f"{spread:.2f}%",
            clasificacion,
            "COMPLETADA",
            notas
        ]

        with open(self.archivo, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(fila)

        # Resumen para consola
        resumen = {
            "tipo": tipo,
            "par": par,
            "cantidad": cantidad,
            "tasa": tasa,
            "total_bs": round(total_bs, 2),
            "spread_pct": round(spread, 2),
            "ganancia_vs_bcv_bs": round(ganancia_vs_bcv, 2),
            "clasificacion": clasificacion,
        }

        indicador = "[+]" if spread > 18 else "[-]" if spread > 12 else "[!]"
        print(f"  [CSV] {indicador} Registrado: {tipo} {cantidad} {par} @ {tasa} Bs | "
              f"Spread: {spread:.2f}% | {clasificacion} | +{ganancia_vs_bcv:,.2f} Bs vs BCV")

        return resumen

    def registrar_cancelada(self, tipo: str, par: str, cantidad: float, tasa: float,
                            banco: str, contraparte: str, razon: str):
        """Registra una operacion que fue cancelada o entro en disputa."""
        fila = [
            datetime.now().strftime("%Y-%m-%d %H:%M"),
            tipo, par, f"{cantidad:.2f}", f"{tasa:.2f}",
            f"{cantidad * tasa:,.2f}", banco, contraparte,
            "N/A", "N/A", "N/A", "CANCELADA", razon
        ]
        with open(self.archivo, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(fila)
        print(f"  [CSV] [X] Cancelada registrada: {tipo} {cantidad} {par} | Razon: {razon}")

    def resumen_del_dia(self, bcv_actual: float = 744.22) -> Dict:
        """Lee el CSV y genera un resumen del dia actual."""
        hoy = datetime.now().strftime("%Y-%m-%d")
        operaciones_hoy = []
        total_ganancia_bs = 0.0
        total_volumen_bs = 0.0
        completadas = 0
        canceladas = 0

        if not os.path.exists(self.archivo):
            return {"error": "Archivo no encontrado"}

        with open(self.archivo, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            next(reader, None)  # Saltar encabezados
            for fila in reader:
                if not fila or not fila[0].startswith(hoy):
                    continue
                estado = fila[11] if len(fila) > 11 else ""
                if estado == "COMPLETADA":
                    completadas += 1
                    # Parsear total_bs (quitar comas)
                    total_str = fila[5].replace(",", "") if len(fila) > 5 else "0"
                    try:
                        monto = float(total_str)
                        total_volumen_bs += monto
                        # Calcular ganancia vs BCV
                        cantidad = float(fila[3]) if len(fila) > 3 else 0
                        total_ganancia_bs += monto - (cantidad * bcv_actual)
                    except ValueError:
                        pass
                elif estado == "CANCELADA":
                    canceladas += 1
                operaciones_hoy.append(fila)

        resumen = {
            "fecha": hoy,
            "operaciones_totales": len(operaciones_hoy),
            "completadas": completadas,
            "canceladas": canceladas,
            "volumen_total_bs": round(total_volumen_bs, 2),
            "ganancia_total_vs_bcv_bs": round(total_ganancia_bs, 2),
        }
        return resumen

    def imprimir_resumen_dia(self, bcv_actual: float = 744.22):
        """Imprime el resumen del dia en formato legible."""
        r = self.resumen_del_dia(bcv_actual)
        print(f"\n  {'='*55}")
        print(f"  RESUMEN DEL DIA: {r.get('fecha', 'N/A')}")
        print(f"  {'='*55}")
        print(f"  Operaciones totales:    {r.get('operaciones_totales', 0)}")
        print(f"  Completadas:            {r.get('completadas', 0)}")
        print(f"  Canceladas:             {r.get('canceladas', 0)}")
        print(f"  Volumen total:          {r.get('volumen_total_bs', 0):,.2f} Bs")
        print(f"  Ganancia vs BCV:        {r.get('ganancia_total_vs_bcv_bs', 0):,.2f} Bs")
        print(f"  {'='*55}")


# =============================================================================
# MODULO 3: ORQUESTADOR DE ANALISIS (Cerebro Estrategico)
# =============================================================================
class AgenteAnalistaBinance:
    """Bucle agentico de analisis con ejecucion en paralelo."""

    def __init__(self):
        self.max_iter = 6
        self.pasos = 0
        self.confianza_global = 0.0
        self.registro_herramientas = {
            "tasa_bcv": HerramientasIA.obtener_tasa_bcv,
            "tasa_euro_oficial": HerramientasIA.obtener_tasa_euro_oficial,
            "tasa_euro_paralelo": HerramientasIA.obtener_tasa_euro_paralelo,
            "tasa_p2p_usdt": HerramientasIA.obtener_tasa_p2p_usdt,
            "earn_apr": HerramientasIA.obtener_earn_apr,
            "riesgos": HerramientasIA.analizar_riesgos_legales,
        }
        self.memoria = {"evidencias": [], "insights": [], "metrica_clave": {}}
        self.plan_actual = []

    def _planificar(self) -> List[str]:
        return ["tasa_bcv", "tasa_euro_oficial", "tasa_p2p_usdt", "tasa_euro_paralelo", "earn_apr", "riesgos"]

    async def _ejecutar_plan(self, plan: List[str]) -> Dict:
        tareas = []
        nombres = []
        for nombre in plan:
            if nombre in self.registro_herramientas:
                tareas.append(self.registro_herramientas[nombre]())
                nombres.append(nombre)
        resultados_brutos = await asyncio.gather(*tareas, return_exceptions=True)
        resultados = {}
        for idx, nombre in enumerate(nombres):
            if isinstance(resultados_brutos[idx], Exception):
                resultados[nombre] = {"error": str(resultados_brutos[idx])}
            else:
                resultados[nombre] = resultados_brutos[idx]
        return resultados

    def _sintetizar(self, datos: Dict) -> Dict:
        bcv_usd = datos.get("tasa_bcv", {}).get("oficial", 0)
        euro_oficial = datos.get("tasa_euro_oficial", {}).get("oficial", 0)
        euro_paralelo = datos.get("tasa_euro_paralelo", {}).get("paralelo", 0)
        p2p_compra = datos.get("tasa_p2p_usdt", {}).get("compra", 0)
        p2p_venta = datos.get("tasa_p2p_usdt", {}).get("venta", 0)
        earn = datos.get("earn_apr", {}).get("USDT_flexible", 0)

        spread_usd = ((p2p_compra - bcv_usd) / bcv_usd) * 100 if bcv_usd else 0
        spread_eur = ((euro_paralelo - euro_oficial) / euro_oficial) * 100 if euro_oficial else 0
        arbitraje_ganador = "EURO" if spread_eur > spread_usd else "DOLAR"
        rentabilidad_esperada = max(spread_usd, spread_eur) + earn

        insight = {
            "bcv_usd": bcv_usd,
            "euro_oficial": euro_oficial,
            "euro_paralelo": euro_paralelo,
            "p2p_compra": p2p_compra,
            "p2p_venta": p2p_venta,
            "earn_apr": earn,
            "spread_dolar_vs_bcv": round(spread_usd, 2),
            "spread_euro_paralelo": round(spread_eur, 2),
            "activo_mas_rentable_hoy": arbitraje_ganador,
            "rentabilidad_total_estimada": round(rentabilidad_esperada, 2),
        }
        datos_validos = sum(1 for v in [bcv_usd, p2p_compra, euro_oficial, euro_paralelo] if v > 0)
        confianza = min(0.95, 0.60 + (datos_validos * 0.08))
        return {"insight": insight, "confianza": confianza, "datos_brutos": datos}

    async def ejecutar_analisis(self) -> Dict:
        print(f"[*] Iniciando bucle experto - Maximo {self.max_iter} iteraciones")
        analisis = None
        while self.pasos < self.max_iter and self.confianza_global < 0.90:
            self.pasos += 1
            if not self.plan_actual:
                self.plan_actual = self._planificar()
            datos_crudos = await self._ejecutar_plan(self.plan_actual)
            analisis = self._sintetizar(datos_crudos)
            self.memoria["insights"].append(analisis["insight"])
            self.confianza_global = analisis["confianza"]
            print(f"    [>] Iteracion {self.pasos}/{self.max_iter} | Confianza: {self.confianza_global*100:.1f}%")
            if self.confianza_global >= 0.90:
                return analisis
        return analisis


# =============================================================================
# MODULO 4: MOTOR DE OPERACIONES P2P (El Bucle Tactico)
# =============================================================================

class EstadoBancario:
    """Simula el estado de un banco para verificaciones pre-vuelo."""
    BANCOS_DISPONIBLES = {
        "BDV":        {"nombre": "Banco de Venezuela",   "limite_diario_bs": 50_000_000, "activo": True,  "falla_frecuente": "viernes"},
        "Banesco":    {"nombre": "Banesco",              "limite_diario_bs": 80_000_000, "activo": True,  "falla_frecuente": None},
        "Mercantil":  {"nombre": "Mercantil",            "limite_diario_bs": 70_000_000, "activo": True,  "falla_frecuente": None},
        "Provincial": {"nombre": "BBVA Provincial",      "limite_diario_bs": 60_000_000, "activo": True,  "falla_frecuente": None},
    }

    @staticmethod
    def verificar_disponibilidad(banco: str) -> Dict:
        info = EstadoBancario.BANCOS_DISPONIBLES.get(banco, {})
        if not info:
            return {"disponible": False, "razon": f"Banco '{banco}' no registrado"}
        dia_semana = datetime.now().strftime("%A").lower()
        dias_es = {"monday": "lunes", "tuesday": "martes", "wednesday": "miercoles",
                   "thursday": "jueves", "friday": "viernes", "saturday": "sabado", "sunday": "domingo"}
        dia_es = dias_es.get(dia_semana, dia_semana)
        if info.get("falla_frecuente") and info["falla_frecuente"] == dia_es:
            return {"disponible": False, "razon": f"{info['nombre']} tiene caidas frecuentes los {dia_es}"}
        return {"disponible": info["activo"], "limite_bs": info["limite_diario_bs"], "banco": info["nombre"]}


class OfertaP2P:
    """Representa una oferta encontrada en Binance P2P."""
    def __init__(self, usuario, tipo, tasa, moneda, completado_pct, ordenes, banco, tiempo_resp_min):
        self.usuario = usuario
        self.tipo = tipo
        self.tasa = tasa
        self.moneda = moneda
        self.completado_pct = completado_pct
        self.ordenes = ordenes
        self.banco = banco
        self.tiempo_resp_min = tiempo_resp_min

    def cumple_filtros(self, min_completado=95.0, min_ordenes=50, max_tiempo=5) -> bool:
        return (self.completado_pct >= min_completado and
                self.ordenes >= min_ordenes and
                self.tiempo_resp_min <= max_tiempo)


class OrdenP2P:
    """Representa una orden P2P en curso."""
    def __init__(self, tipo, monto_usdt, tasa, banco, moneda):
        self.tipo = tipo
        self.monto_usdt = monto_usdt
        self.tasa = tasa
        self.banco = banco
        self.moneda = moneda
        self.monto_bs = round(monto_usdt * tasa, 2)
        self.status = "PENDIENTE"
        self.contraparte = ""
        self.timeout_minutos = 15

    def simular_resultado(self):
        r = random.random()
        if r < 0.75:
            self.status = "COMPLETADA"
        elif r < 0.88:
            self.status = "PAGADA"
        elif r < 0.95:
            self.status = "CANCELADA"
        else:
            self.status = "EN_DISPUTA"


class MotorOperacionesP2P:
    """
    Motor de operaciones P2P con 6 fases tacticas integrado con RegistroP2P.
    """

    def __init__(self, saldo_bs, saldo_usdt, banco_principal="Banesco", registro: RegistroP2P = None):
        self.saldo_bs = saldo_bs
        self.saldo_usdt = saldo_usdt
        self.banco_principal = banco_principal
        self.tope_usdt_por_operacion = 2000.0
        self.cooldown_minutos = 30

        # Registro CSV integrado
        self.registro = registro or RegistroP2P()

        # Estado interno
        self.blacklist_usuarios = []
        self.bancos_con_problemas = []
        self.operaciones_hoy = 0
        self.ganancia_acumulada_bs = 0.0
        self.ganancia_acumulada_usdt = 0.0

    def _log(self, fase, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"  [{ts}] FASE {fase}: {msg}")

    # FASE 0: SEGURIDAD (PRE-FLIGHT)
    def fase0_preflight(self, tasas):
        self._log("0", "=== PRE-FLIGHT CHECK ===")
        tengo_usdt = self.saldo_usdt > 10
        tengo_bs = self.saldo_bs > (tasas.get("p2p_compra", 890) * 10)
        modo = "VENTA" if tengo_usdt else ("COMPRA" if tengo_bs else "SIN_FONDOS")
        self._log("0", f"Saldo: {self.saldo_usdt:.2f} USDT | {self.saldo_bs:,.0f} Bs | Modo: {modo}")

        if modo == "SIN_FONDOS":
            self._log("0", "[!] Sin fondos suficientes para operar.")
            return {"ok": False, "modo": modo, "razon": "Saldo insuficiente"}

        estado_banco = EstadoBancario.verificar_disponibilidad(self.banco_principal)
        if not estado_banco.get("disponible"):
            self._log("0", f"[!] Banco NO disponible: {estado_banco.get('razon')}")
            for alt in ["Banesco", "Mercantil", "Provincial", "BDV"]:
                if alt != self.banco_principal:
                    alt_estado = EstadoBancario.verificar_disponibilidad(alt)
                    if alt_estado.get("disponible"):
                        self._log("0", f"[+] Banco alternativo: {alt}")
                        self.banco_principal = alt
                        estado_banco = alt_estado
                        break
            else:
                return {"ok": False, "modo": modo, "razon": "Ningun banco disponible"}

        tope = min(self.tope_usdt_por_operacion,
                   self.saldo_usdt if modo == "VENTA" else self.saldo_bs / tasas.get("p2p_compra", 890))
        tope = round(min(tope, 2000.0), 2)
        self._log("0", f"Tope: {tope} USDT | Banco: {self.banco_principal}")
        return {"ok": True, "modo": modo, "tope_usdt": tope, "banco": self.banco_principal}

    # FASE 1: BUSQUEDA DE OPORTUNIDAD (SCAN)
    def fase1_scan(self, modo, banco):
        self._log("1", f"=== ESCANEANDO OFERTAS P2P ({modo}) ===")
        ofertas_simuladas = [
            OfertaP2P("CryptoVzla_Pro",  modo, 890.50, "USDT", 99.2, 1523, "Banesco",    2),
            OfertaP2P("BsDigital",       modo, 891.00, "USDT", 97.8,  812, "Mercantil",   3),
            OfertaP2P("PagoMovil_King",  modo, 889.80, "USDT", 96.1,  345, "BDV",         4),
            OfertaP2P("TrustExchange",   modo, 892.30, "USDT", 98.5,  204, "Provincial",  2),
            OfertaP2P("NuevoTrader22",   modo, 887.00, "USDT", 78.0,   12, "BDV",         8),
            OfertaP2P("EuroVzla_Master", modo, 910.00, "EUR",  99.0,  675, "Banesco",     3),
            OfertaP2P("EUR_Merchant",    modo, 912.50, "EUR",  97.2,  189, "Mercantil",   4),
        ]
        filtradas = [o for o in ofertas_simuladas if o.cumple_filtros() and o.usuario not in self.blacklist_usuarios]
        self._log("1", f"Total: {len(ofertas_simuladas)} | Filtradas: {len(filtradas)}")
        del_banco = [o for o in filtradas if o.banco == banco]
        if del_banco:
            self._log("1", f"En {banco}: {len(del_banco)}")
            return del_banco
        return filtradas

    # FASE 2: ARBITRAJE CRUZADO EUR/USDT
    def fase2_arbitraje_cruzado(self, ofertas, tasas):
        self._log("2", "=== ARBITRAJE CRUZADO EUR vs USDT ===")
        ofertas_usdt = [o for o in ofertas if o.moneda == "USDT"]
        ofertas_eur = [o for o in ofertas if o.moneda == "EUR"]
        mejor_usdt = min(ofertas_usdt, key=lambda o: o.tasa) if ofertas_usdt else None
        mejor_eur = min(ofertas_eur, key=lambda o: o.tasa) if ofertas_eur else None

        p2p_usdt = mejor_usdt.tasa if mejor_usdt else tasas.get("p2p_compra", 890.50)
        p2p_eur = mejor_eur.tasa if mejor_eur else tasas.get("euro_paralelo", 915.00)

        umbral = p2p_usdt * 1.05
        if p2p_eur < umbral and mejor_eur:
            ahorro = round(((umbral - p2p_eur) / umbral) * 100, 2)
            self._log("2", f"[+] EUR ({p2p_eur} Bs) < umbral ({umbral:.2f} Bs) -> +{ahorro}% ahorro")
            return {"decision": "COMPRAR_EUR_CONVERTIR_USDT", "tasa_eur": p2p_eur, "tasa_usdt": p2p_usdt,
                    "ahorro_estimado_pct": ahorro, "oferta_elegida": mejor_eur}
        else:
            self._log("2", f"[-] EUR sin ventaja vs USDT. Operar directo en USDT.")
            return {"decision": "OPERAR_USDT_DIRECTO", "tasa_usdt": p2p_usdt, "oferta_elegida": mejor_usdt}

    # FASE 3: EJECUCION TACTICA
    async def fase3_ejecucion(self, arbitraje, tope_usdt, banco):
        oferta = arbitraje.get("oferta_elegida")
        if not oferta:
            self._log("3", "[!] Sin oferta valida.")
            return None

        moneda = "EUR" if arbitraje["decision"] == "COMPRAR_EUR_CONVERTIR_USDT" else "USDT"
        tasa = arbitraje.get("tasa_eur", arbitraje.get("tasa_usdt"))

        orden = OrdenP2P(tipo=oferta.tipo, monto_usdt=tope_usdt, tasa=tasa, banco=banco, moneda=moneda)
        orden.contraparte = oferta.usuario

        self._log("3", "=== EJECUTANDO ORDEN ===")
        self._log("3", f"  {orden.tipo} {orden.monto_usdt} {orden.moneda} @ {orden.tasa} Bs | {orden.banco}")
        self._log("3", f"  Total: {orden.monto_bs:,.2f} Bs | Contraparte: @{oferta.usuario}")
        self._log("3", f"  Timeout: {orden.timeout_minutos} min...")

        await asyncio.sleep(0.2)
        orden.simular_resultado()

        if orden.status == "COMPLETADA":
            self._log("3", "[+] ORDEN COMPLETADA.")
        elif orden.status == "PAGADA":
            self._log("3", "[!] Pagaste pero NO liberaron -> DISPUTA abierta.")
            orden.status = "EN_DISPUTA"
        elif orden.status == "CANCELADA":
            self._log("3", f"[!] Contraparte NO pago -> CANCELADA. Blacklisteando: {oferta.usuario}")
            self.blacklist_usuarios.append(oferta.usuario)
        elif orden.status == "EN_DISPUTA":
            self._log("3", "[!] EN_DISPUTA. Apelacion enviada.")

        return orden

    # FASE 4: REGISTRO Y LIMPIEZA (Post-Trade) - AHORA CON CSV
    async def fase4_post_trade(self, orden, tasas):
        if not orden:
            self._log("4", "Sin orden. Saltando post-trade.")
            return

        bcv = tasas.get("bcv_usd", 744.22)

        if orden.status == "COMPLETADA":
            self._log("4", "=== POST-TRADE ===")

            # --- REGISTRO EN CSV ---
            self.registro.registrar(
                tipo=orden.tipo,
                par=orden.moneda,
                cantidad=orden.monto_usdt,
                tasa=orden.tasa,
                banco=orden.banco,
                contraparte=f"@{orden.contraparte}",
                tiempo_liberacion="5",
                bcv_actual=bcv,
                notas=f"Ciclo automatico"
            )

            # Actualizar saldos internos
            if orden.tipo == "COMPRA":
                self.saldo_usdt += orden.monto_usdt
                self.saldo_bs -= orden.monto_bs
                earn = tasas.get("earn_apr", 3.85)
                gan_diaria = round(orden.monto_usdt * (earn / 100) / 365, 4)
                self._log("4", f"[+] USDT -> Earn Flexible ({earn}% APR) | +{gan_diaria} USDT/dia")
                self._log("4", f"    REGLA: NUNCA guardes Bs en el banco. Inflacion diaria.")
                self.ganancia_acumulada_usdt += gan_diaria
            else:
                self.saldo_usdt -= orden.monto_usdt
                self.saldo_bs += orden.monto_bs
                ganancia = round(orden.monto_bs - (orden.monto_usdt * bcv), 2)
                self._log("4", f"[+] Bs recibidos: {orden.monto_bs:,.2f} Bs | Ganancia vs BCV: +{ganancia:,.2f} Bs")
                self._log("4", f"    REGLA: Convertir Bs a USD o recomprar USDT en MAX 2 HORAS.")
                self.ganancia_acumulada_bs += ganancia

            self.operaciones_hoy += 1
            self._log("4", f"    Cooldown: {self.cooldown_minutos} min (anti-bloqueo SUDEBAN).")

        elif orden.status in ("CANCELADA", "EN_DISPUTA"):
            # Registrar la cancelada tambien
            self.registro.registrar_cancelada(
                tipo=orden.tipo,
                par=orden.moneda,
                cantidad=orden.monto_usdt,
                tasa=orden.tasa,
                banco=orden.banco,
                contraparte=f"@{orden.contraparte}",
                razon=f"Status: {orden.status}"
            )

    # FASE 5: AUTOAPRENDIZAJE
    def fase5_autoaprendizaje(self, orden):
        self._log("5", "=== AUTOAPRENDIZAJE ===")
        if orden and orden.status in ("CANCELADA", "EN_DISPUTA"):
            if orden.banco not in self.bancos_con_problemas:
                self.bancos_con_problemas.append(orden.banco)
        self._log("5", f"    Blacklist: {self.blacklist_usuarios if self.blacklist_usuarios else 'Limpia'}")
        self._log("5", f"    Bancos problemas: {self.bancos_con_problemas if self.bancos_con_problemas else 'Ninguno'}")
        self._log("5", f"    Ops hoy: {self.operaciones_hoy} | Gan Bs: {self.ganancia_acumulada_bs:,.2f} | Gan USDT: {self.ganancia_acumulada_usdt:.4f}")


# =============================================================================
# MODULO 5: SISTEMA COMPLETO (Orquestador Principal)
# =============================================================================
class SistemaCompletoBinanceVE:
    """Une Analisis + Operaciones + Registro CSV en un unico flujo."""

    def __init__(self, saldo_bs=5_000_000.0, saldo_usdt=500.0, banco="Banesco", ciclos=3):
        self.registro = RegistroP2P(archivo="mi_operaciones_binance.csv")
        self.analista = AgenteAnalistaBinance()
        self.motor = MotorOperacionesP2P(
            saldo_bs=saldo_bs, saldo_usdt=saldo_usdt,
            banco_principal=banco, registro=self.registro
        )
        self.ciclos_max = ciclos

    async def ejecutar(self):
        print("=" * 70)
        print("  SISTEMA BINANCE VENEZUELA - ANALISIS + P2P + REGISTRO CSV")
        print(f"  Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        print("=" * 70)

        # ETAPA 1: ANALISIS ESTRATEGICO
        print("\n[ETAPA 1] ANALISIS ESTRATEGICO")
        print("-" * 40)
        analisis = await self.analista.ejecutar_analisis()
        insight = analisis["insight"]

        print(f"\n  Tasas actualizadas (30 julio 2026):")
        print(f"  +{'='*50}+")
        print(f"  | {'Indicador':<25} | {'Valor':>20} |")
        print(f"  +{'-'*50}+")
        print(f"  | {'BCV USD (Oficial)':<25} | {insight['bcv_usd']:>17.2f} Bs |")
        print(f"  | {'BCV EUR (Oficial)':<25} | {insight['euro_oficial']:>17.2f} Bs |")
        print(f"  | {'P2P USDT Compra':<25} | {insight['p2p_compra']:>17.2f} Bs |")
        print(f"  | {'P2P USDT Venta':<25} | {insight['p2p_venta']:>17.2f} Bs |")
        print(f"  | {'EUR Paralelo':<25} | {insight['euro_paralelo']:>17.2f} Bs |")
        print(f"  | {'Spread USD (BCV vs P2P)':<25} | {insight['spread_dolar_vs_bcv']:>16.2f}% |")
        print(f"  | {'Spread EUR (Ofi vs Par)':<25} | {insight['spread_euro_paralelo']:>16.2f}% |")
        print(f"  | {'Activo Ganador':<25} | {insight['activo_mas_rentable_hoy']:>20} |")
        print(f"  | {'Earn APR':<25} | {insight['earn_apr']:>16.2f}% |")
        print(f"  +{'='*50}+")

        tasas = {
            "bcv_usd": insight["bcv_usd"],
            "euro_oficial": insight["euro_oficial"],
            "euro_paralelo": insight["euro_paralelo"],
            "p2p_compra": insight["p2p_compra"],
            "p2p_venta": insight["p2p_venta"],
            "earn_apr": insight["earn_apr"],
        }

        # ETAPA 2: CICLOS DE OPERACION P2P
        print(f"\n[ETAPA 2] CICLOS DE OPERACION P2P (Max: {self.ciclos_max})")
        print("-" * 40)

        for ciclo in range(1, self.ciclos_max + 1):
            print(f"\n{'='*55}")
            print(f"  CICLO {ciclo}/{self.ciclos_max}")
            print(f"{'='*55}")

            preflight = self.motor.fase0_preflight(tasas)
            if not preflight["ok"]:
                print(f"  [X] Abortando: {preflight.get('razon')}")
                break

            ofertas = self.motor.fase1_scan(modo=preflight["modo"], banco=preflight["banco"])
            if not ofertas:
                print("  [X] Sin ofertas. Saltando.")
                continue

            arbitraje = self.motor.fase2_arbitraje_cruzado(ofertas, tasas)
            orden = await self.motor.fase3_ejecucion(
                arbitraje=arbitraje, tope_usdt=preflight["tope_usdt"], banco=preflight["banco"]
            )
            await self.motor.fase4_post_trade(orden, tasas)
            self.motor.fase5_autoaprendizaje(orden)

        # ETAPA 3: REPORTE FINAL + RESUMEN CSV
        print(f"\n{'='*70}")
        print("  REPORTE FINAL DE SESION")
        print(f"{'='*70}")
        print(f"  Operaciones completadas:  {self.motor.operaciones_hoy}")
        print(f"  Ganancia Bs (vs BCV):     {self.motor.ganancia_acumulada_bs:,.2f} Bs")
        print(f"  Ganancia USDT (Earn):     {self.motor.ganancia_acumulada_usdt:.4f} USDT")
        print(f"  Saldo final USDT:         {self.motor.saldo_usdt:.2f} USDT")
        print(f"  Saldo final Bs:           {self.motor.saldo_bs:,.2f} Bs")
        print(f"  Blacklist:                {self.motor.blacklist_usuarios if self.motor.blacklist_usuarios else 'Limpia'}")
        print(f"  Bancos problemas:         {self.motor.bancos_con_problemas if self.motor.bancos_con_problemas else 'Ninguno'}")
        print(f"{'='*70}")

        # Resumen del CSV del dia
        self.registro.imprimir_resumen_dia(bcv_actual=tasas["bcv_usd"])

        # Mostrar contenido del CSV
        print(f"\n  Archivo CSV generado: {self.registro.archivo}")
        if os.path.exists(self.registro.archivo):
            with open(self.registro.archivo, 'r', encoding='utf-8') as f:
                print(f"  Contenido:")
                for linea in f:
                    print(f"    {linea.strip()}")


# =============================================================================
# PUNTO DE ENTRADA
# =============================================================================
if __name__ == "__main__":
    # Eliminar CSV anterior para demo limpia
    if os.path.exists("mi_operaciones_binance.csv"):
        os.remove("mi_operaciones_binance.csv")

    sistema = SistemaCompletoBinanceVE(
        saldo_bs=5_000_000.0,
        saldo_usdt=500.0,
        banco="Banesco",
        ciclos=3
    )
    asyncio.run(sistema.ejecutar())
