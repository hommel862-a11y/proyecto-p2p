import asyncio
import json
from typing import Dict, List, Callable, Any
from datetime import datetime

# --- 1. DEFINICIÓN DE HERRAMIENTAS (El "Cinturón de Utilidades") ---
# En lugar de if/elif, usamos un diccionario de funciones (Strategy Pattern)
class HerramientasIA:
    
    @staticmethod
    async def obtener_tasa_bcv() -> Dict:
        """Simula consulta a la API del BCV (Dólar Oficial)"""
        # Actualizado con la tasa BCV real del 29-30 de julio 2026
        return {"moneda": "USD", "oficial": 744.22, "fuente": "BCV", "timestamp": "2026-07-30"}
    
    @staticmethod
    async def obtener_tasa_euro_oficial() -> Dict:
        """Tasa Euro fijada por el BCV"""
        # Actualizado con la tasa BCV Euro real del 29-30 de julio 2026
        return {"moneda": "EUR", "oficial": 846.07, "fuente": "BCV", "timestamp": "2026-07-30"}
    
    @staticmethod
    async def obtener_tasa_euro_paralelo() -> Dict:
        """Euro en el mercado paralelo/P2P"""
        return {"moneda": "EUR", "paralelo": 915.00, "fuente": "P2P_Monitor", "timestamp": "2026-07-30"}
    
    @staticmethod
    async def obtener_tasa_p2p_usdt() -> Dict:
        """Tasa de compra/venta de USDT en Binance P2P (promedio)"""
        return {"moneda": "USDT", "compra": 890.50, "venta": 898.00, "spread_p2p": 7.50}

    @staticmethod
    async def obtener_earn_apr() -> Dict:
        """Rendimientos de Binance Earn"""
        return {"USDT_flexible": 3.85, "USDC_flexible": 5.74, "EUR_flexible": 2.10}

    @staticmethod
    async def analizar_riesgos_legales() -> Dict:
        """Risk Intelligence"""
        return {"nivel": "ALTO", "factores": ["Detenciones por arbitraje", "Sundde fiscalizando"], "recomendacion": "Operar montos fraccionados"}


# --- 2. EL ORQUESTADOR (El Bucle Potenciado) ---
class AgenteAnalistaBinance:
    def __init__(self):
        self.max_iter = 6  # Reducido porque ahora es más eficiente
        self.pasos = 0
        self.confianza_global = 0.0
        
        # Registro dinámico de herramientas (¡Aquí está el poder!)
        self.registro_herramientas = {
            "tasa_bcv": HerramientasIA.obtener_tasa_bcv,
            "tasa_euro_oficial": HerramientasIA.obtener_tasa_euro_oficial,
            "tasa_euro_paralelo": HerramientasIA.obtener_tasa_euro_paralelo,
            "tasa_p2p_usdt": HerramientasIA.obtener_tasa_p2p_usdt,
            "earn_apr": HerramientasIA.obtener_earn_apr,
            "riesgos": HerramientasIA.analizar_riesgos_legales,
        }
        
        # Memoria del agente (con compresión automática)
        self.memoria = {
            "evidencias": [],
            "insights": [],
            "metrica_clave": {}
        }
        self.plan_actual = []

    # --- 3. MOTOR DE RAZONAMIENTO (Planificación dinámica) ---
    def _planificar(self) -> List[str]:
        """La IA decide QUÉ herramientas usar y en QUÉ orden."""
        return [
            "tasa_bcv",           
            "tasa_euro_oficial",  
            "tasa_p2p_usdt",      
            "tasa_euro_paralelo", 
            "earn_apr",           
            "riesgos"             
        ]

    # --- 4. EJECUCIÓN PARALELA (¡El gran upgrade!) ---
    async def _ejecutar_plan(self, plan: List[str]) -> Dict:
        """Lanzamos TODAS las consultas a la vez usando asyncio.gather."""
        tareas = []
        herramientas_validas = []
        
        for nombre_herramienta in plan:
            if nombre_herramienta in self.registro_herramientas:
                tareas.append(self.registro_herramientas[nombre_herramienta]())
                herramientas_validas.append(nombre_herramienta)
            else:
                print(f"⚠️ Herramienta {nombre_herramienta} no encontrada")
        
        resultados_brutos = await asyncio.gather(*tareas, return_exceptions=True)
        
        resultados = {}
        for idx, nombre in enumerate(herramientas_validas):
            if isinstance(resultados_brutos[idx], Exception):
                resultados[nombre] = {"error": str(resultados_brutos[idx])}
            else:
                resultados[nombre] = resultados_brutos[idx]
        
        return resultados

    # --- 5. SÍNTESIS Y CRITERIO DE PARADA (El "Cerebro") ---
    def _sintetizar(self, datos: Dict) -> Dict:
        """Aquí está el análisis CRUZADO entre BCV, Euro y P2P."""
        bcv_usd = datos.get("tasa_bcv", {}).get("oficial", 0)
        euro_oficial = datos.get("tasa_euro_oficial", {}).get("oficial", 0)
        euro_paralelo = datos.get("tasa_euro_paralelo", {}).get("paralelo", 0)
        p2p_compra = datos.get("tasa_p2p_usdt", {}).get("compra", 0)
        p2p_venta = datos.get("tasa_p2p_usdt", {}).get("venta", 0)
        earn = datos.get("earn_apr", {}).get("USDT_flexible", 0)
        
        # 1. Spread Dólar (BCV vs P2P)
        spread_usd = ((p2p_compra - bcv_usd) / bcv_usd) * 100 if bcv_usd else 0
        
        # 2. Spread Euro (Oficial vs Paralelo)
        spread_eur = ((euro_paralelo - euro_oficial) / euro_oficial) * 100 if euro_oficial else 0
        
        # 3. ¿Euro o Dólar? 
        arbitraje_ganador = "EURO" if spread_eur > spread_usd else "DOLAR"
        
        # 4. Rentabilidad Total
        rentabilidad_esperada = max(spread_usd, spread_eur) + earn
        
        insight = {
            "spread_dolar_vs_bcv": f"{spread_usd:.2f}%",
            "spread_euro_paralelo": f"{spread_eur:.2f}%",
            "activo_mas_rentable_hoy": arbitraje_ganador,
            "rentabilidad_total_estimada": f"{rentabilidad_esperada:.2f}%",
            "recomendacion_estructural": (
                f"Si tienes acceso a Euros oficiales (BCV), vendelos en el mercado paralelo. "
                f"Si no, el P2P USDT sigue siendo refugio, combinado con Earn al {earn}% APR."
            )
        }
        
        datos_validos = sum(1 for v in [bcv_usd, p2p_compra, euro_oficial, euro_paralelo] if v > 0)
        confianza = min(0.95, 0.60 + (datos_validos * 0.08))
        
        return {"insight": insight, "confianza": confianza, "datos_brutos": datos}

    # --- 6. EJECUCIÓN PRINCIPAL DEL BUCLE ---
    async def ejecutar_analisis(self):
        print(f"[*] Iniciando bucle experto - Maximo {self.max_iter} iteraciones")
        
        while self.pasos < self.max_iter and self.confianza_global < 0.90:
            self.pasos += 1
            print(f"\n[>] Iteracion {self.pasos}/{self.max_iter}")
            
            if not self.plan_actual:
                self.plan_actual = self._planificar()
                print(f"[+] Plan trazado: {self.plan_actual}")
            
            print("[-] Consultando fuentes en paralelo (BCV, Euro, P2P, Earn)...")
            datos_crudos = await self._ejecutar_plan(self.plan_actual)
            
            analisis = self._sintetizar(datos_crudos)
            self.memoria["insights"].append(analisis["insight"])
            self.confianza_global = analisis["confianza"]
            
            if len(self.memoria["insights"]) > 3:
                resumen = f"Historico: {self.memoria['insights'][0]['activo_mas_rentable_hoy']} y spreads previos."
                self.memoria["insights"] = [{"resumen_historico": resumen}] + self.memoria["insights"][-2:]
            
            print(f"[*] Confianza actual: {self.confianza_global*100:.1f}%")
            if self.confianza_global >= 0.90:
                print("[+] Confianza alta. Finalizando bucle.")
                return self._generar_informe_final(analisis)
        
        print("[!] Limite de iteraciones alcanzado. Entregando analisis parcial.")
        return self._generar_informe_parcial()

    # --- 7. GENERADORES DE INFORMES ---
    def _generar_informe_final(self, analisis):
        insight = analisis["insight"]
        # Evitando caracteres especiales de Unicode en CMD para Windows
        return f"""
        ========================================
        [+] INFORME EJECUTIVO - BINANCE VENEZUELA
        ========================================
        - Activo mas rentable hoy: {insight['activo_mas_rentable_hoy']}
        - Spread Dolar (BCV vs P2P): {insight['spread_dolar_vs_bcv']}
        - Spread Euro (Oficial vs Paralelo): {insight['spread_euro_paralelo']}
        - Rentabilidad Total estimada (Arbitraje + Earn): {insight['rentabilidad_total_estimada']}
        
        Recomendacion del Experto:
        {insight['recomendacion_estructural']}
        
        Riesgo Asociado: {analisis['datos_brutos'].get('riesgos', dict()).get('nivel', 'No evaluado')}
        ========================================
        """

    def _generar_informe_parcial(self):
        return "[!] No se pudo alcanzar la confianza suficiente. Revisa las fuentes de datos."

if __name__ == "__main__":
    agente = AgenteAnalistaBinance()
    resultado = asyncio.run(agente.ejecutar_analisis())
    print(resultado)
