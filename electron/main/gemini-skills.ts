/**
 * Financial Agent Skills for Gemini Orchestrator within the Electron desktop shell.
 * Facade module re-exporting modularized skills from `./skills/index`.
 *
 * Mecanismo (decisión documentada — Opción B, alternativa):
 * Los cómputos reales provienen de los motores de dominio de @p2p/core empaquetados
 * en `./vendor/p2p-core/*` para cumplir con `rootDir: "."` de Electron.
 * La modularización divide las habilidades por familias temáticas:
 * - Macro (BCV, drenaje de liquidez, teoría de juegos)
 * - Trading (arbitraje triangular, Avellaneda-Stoikov, VPIN, slicing)
 * - Risk (Golden rule, delta neutral, ZK mesh, listas negras, bancos)
 * - Earn (Simple Earn, Dual Investment, Launchpool, liquidity ladder)
 * - Operations (disputas, OCR comprobantes, RPA, SLAs, Google Sheets)
 */

export * from './skills/index';