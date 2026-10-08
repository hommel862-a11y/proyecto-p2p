import { createRequire } from 'module'; const require = createRequire(import.meta.url);
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// ../../node_modules/dotenv/package.json
var require_package = __commonJS({
  "../../node_modules/dotenv/package.json"(exports, module) {
    module.exports = {
      name: "dotenv",
      version: "16.6.1",
      description: "Loads environment variables from .env file",
      main: "lib/main.js",
      types: "lib/main.d.ts",
      exports: {
        ".": {
          types: "./lib/main.d.ts",
          require: "./lib/main.js",
          default: "./lib/main.js"
        },
        "./config": "./config.js",
        "./config.js": "./config.js",
        "./lib/env-options": "./lib/env-options.js",
        "./lib/env-options.js": "./lib/env-options.js",
        "./lib/cli-options": "./lib/cli-options.js",
        "./lib/cli-options.js": "./lib/cli-options.js",
        "./package.json": "./package.json"
      },
      scripts: {
        "dts-check": "tsc --project tests/types/tsconfig.json",
        lint: "standard",
        pretest: "npm run lint && npm run dts-check",
        test: "tap run --allow-empty-coverage --disable-coverage --timeout=60000",
        "test:coverage": "tap run --show-full-coverage --timeout=60000 --coverage-report=text --coverage-report=lcov",
        prerelease: "npm test",
        release: "standard-version"
      },
      repository: {
        type: "git",
        url: "git://github.com/motdotla/dotenv.git"
      },
      homepage: "https://github.com/motdotla/dotenv#readme",
      funding: "https://dotenvx.com",
      keywords: [
        "dotenv",
        "env",
        ".env",
        "environment",
        "variables",
        "config",
        "settings"
      ],
      readmeFilename: "README.md",
      license: "BSD-2-Clause",
      devDependencies: {
        "@types/node": "^18.11.3",
        decache: "^4.6.2",
        sinon: "^14.0.1",
        standard: "^17.0.0",
        "standard-version": "^9.5.0",
        tap: "^19.2.0",
        typescript: "^4.8.4"
      },
      engines: {
        node: ">=12"
      },
      browser: {
        fs: false
      }
    };
  }
});

// ../../node_modules/dotenv/lib/main.js
var require_main = __commonJS({
  "../../node_modules/dotenv/lib/main.js"(exports, module) {
    var fs3 = __require("fs");
    var path3 = __require("path");
    var os = __require("os");
    var crypto = __require("crypto");
    var packageJson = require_package();
    var version = packageJson.version;
    var LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
    function parse(src) {
      const obj = {};
      let lines = src.toString();
      lines = lines.replace(/\r\n?/mg, "\n");
      let match;
      while ((match = LINE.exec(lines)) != null) {
        const key = match[1];
        let value = match[2] || "";
        value = value.trim();
        const maybeQuote = value[0];
        value = value.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");
        if (maybeQuote === '"') {
          value = value.replace(/\\n/g, "\n");
          value = value.replace(/\\r/g, "\r");
        }
        obj[key] = value;
      }
      return obj;
    }
    function _parseVault(options) {
      options = options || {};
      const vaultPath = _vaultPath(options);
      options.path = vaultPath;
      const result = DotenvModule.configDotenv(options);
      if (!result.parsed) {
        const err = new Error(`MISSING_DATA: Cannot parse ${vaultPath} for an unknown reason`);
        err.code = "MISSING_DATA";
        throw err;
      }
      const keys = _dotenvKey(options).split(",");
      const length = keys.length;
      let decrypted;
      for (let i = 0; i < length; i++) {
        try {
          const key = keys[i].trim();
          const attrs = _instructions(result, key);
          decrypted = DotenvModule.decrypt(attrs.ciphertext, attrs.key);
          break;
        } catch (error) {
          if (i + 1 >= length) {
            throw error;
          }
        }
      }
      return DotenvModule.parse(decrypted);
    }
    function _warn(message) {
      console.log(`[dotenv@${version}][WARN] ${message}`);
    }
    function _debug(message) {
      console.log(`[dotenv@${version}][DEBUG] ${message}`);
    }
    function _log(message) {
      console.log(`[dotenv@${version}] ${message}`);
    }
    function _dotenvKey(options) {
      if (options && options.DOTENV_KEY && options.DOTENV_KEY.length > 0) {
        return options.DOTENV_KEY;
      }
      if (process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0) {
        return process.env.DOTENV_KEY;
      }
      return "";
    }
    function _instructions(result, dotenvKey) {
      let uri;
      try {
        uri = new URL(dotenvKey);
      } catch (error) {
        if (error.code === "ERR_INVALID_URL") {
          const err = new Error("INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        }
        throw error;
      }
      const key = uri.password;
      if (!key) {
        const err = new Error("INVALID_DOTENV_KEY: Missing key part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environment = uri.searchParams.get("environment");
      if (!environment) {
        const err = new Error("INVALID_DOTENV_KEY: Missing environment part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environmentKey = `DOTENV_VAULT_${environment.toUpperCase()}`;
      const ciphertext = result.parsed[environmentKey];
      if (!ciphertext) {
        const err = new Error(`NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${environmentKey} in your .env.vault file.`);
        err.code = "NOT_FOUND_DOTENV_ENVIRONMENT";
        throw err;
      }
      return { ciphertext, key };
    }
    function _vaultPath(options) {
      let possibleVaultPath = null;
      if (options && options.path && options.path.length > 0) {
        if (Array.isArray(options.path)) {
          for (const filepath of options.path) {
            if (fs3.existsSync(filepath)) {
              possibleVaultPath = filepath.endsWith(".vault") ? filepath : `${filepath}.vault`;
            }
          }
        } else {
          possibleVaultPath = options.path.endsWith(".vault") ? options.path : `${options.path}.vault`;
        }
      } else {
        possibleVaultPath = path3.resolve(process.cwd(), ".env.vault");
      }
      if (fs3.existsSync(possibleVaultPath)) {
        return possibleVaultPath;
      }
      return null;
    }
    function _resolveHome(envPath) {
      return envPath[0] === "~" ? path3.join(os.homedir(), envPath.slice(1)) : envPath;
    }
    function _configVault(options) {
      const debug = Boolean(options && options.debug);
      const quiet = options && "quiet" in options ? options.quiet : true;
      if (debug || !quiet) {
        _log("Loading env from encrypted .env.vault");
      }
      const parsed = DotenvModule._parseVault(options);
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsed, options);
      return { parsed };
    }
    function configDotenv(options) {
      const dotenvPath = path3.resolve(process.cwd(), ".env");
      let encoding = "utf8";
      const debug = Boolean(options && options.debug);
      const quiet = options && "quiet" in options ? options.quiet : true;
      if (options && options.encoding) {
        encoding = options.encoding;
      } else {
        if (debug) {
          _debug("No encoding is specified. UTF-8 is used by default");
        }
      }
      let optionPaths = [dotenvPath];
      if (options && options.path) {
        if (!Array.isArray(options.path)) {
          optionPaths = [_resolveHome(options.path)];
        } else {
          optionPaths = [];
          for (const filepath of options.path) {
            optionPaths.push(_resolveHome(filepath));
          }
        }
      }
      let lastError;
      const parsedAll = {};
      for (const path4 of optionPaths) {
        try {
          const parsed = DotenvModule.parse(fs3.readFileSync(path4, { encoding }));
          DotenvModule.populate(parsedAll, parsed, options);
        } catch (e) {
          if (debug) {
            _debug(`Failed to load ${path4} ${e.message}`);
          }
          lastError = e;
        }
      }
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsedAll, options);
      if (debug || !quiet) {
        const keysCount = Object.keys(parsedAll).length;
        const shortPaths = [];
        for (const filePath of optionPaths) {
          try {
            const relative = path3.relative(process.cwd(), filePath);
            shortPaths.push(relative);
          } catch (e) {
            if (debug) {
              _debug(`Failed to load ${filePath} ${e.message}`);
            }
            lastError = e;
          }
        }
        _log(`injecting env (${keysCount}) from ${shortPaths.join(",")}`);
      }
      if (lastError) {
        return { parsed: parsedAll, error: lastError };
      } else {
        return { parsed: parsedAll };
      }
    }
    function config(options) {
      if (_dotenvKey(options).length === 0) {
        return DotenvModule.configDotenv(options);
      }
      const vaultPath = _vaultPath(options);
      if (!vaultPath) {
        _warn(`You set DOTENV_KEY but you are missing a .env.vault file at ${vaultPath}. Did you forget to build it?`);
        return DotenvModule.configDotenv(options);
      }
      return DotenvModule._configVault(options);
    }
    function decrypt(encrypted, keyStr) {
      const key = Buffer.from(keyStr.slice(-64), "hex");
      let ciphertext = Buffer.from(encrypted, "base64");
      const nonce = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(-16);
      ciphertext = ciphertext.subarray(12, -16);
      try {
        const aesgcm = crypto.createDecipheriv("aes-256-gcm", key, nonce);
        aesgcm.setAuthTag(authTag);
        return `${aesgcm.update(ciphertext)}${aesgcm.final()}`;
      } catch (error) {
        const isRange = error instanceof RangeError;
        const invalidKeyLength = error.message === "Invalid key length";
        const decryptionFailed = error.message === "Unsupported state or unable to authenticate data";
        if (isRange || invalidKeyLength) {
          const err = new Error("INVALID_DOTENV_KEY: It must be 64 characters long (or more)");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        } else if (decryptionFailed) {
          const err = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
          err.code = "DECRYPTION_FAILED";
          throw err;
        } else {
          throw error;
        }
      }
    }
    function populate(processEnv, parsed, options = {}) {
      const debug = Boolean(options && options.debug);
      const override = Boolean(options && options.override);
      if (typeof parsed !== "object") {
        const err = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
        err.code = "OBJECT_REQUIRED";
        throw err;
      }
      for (const key of Object.keys(parsed)) {
        if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
          if (override === true) {
            processEnv[key] = parsed[key];
          }
          if (debug) {
            if (override === true) {
              _debug(`"${key}" is already defined and WAS overwritten`);
            } else {
              _debug(`"${key}" is already defined and was NOT overwritten`);
            }
          }
        } else {
          processEnv[key] = parsed[key];
        }
      }
    }
    var DotenvModule = {
      configDotenv,
      _configVault,
      _parseVault,
      config,
      decrypt,
      parse,
      populate
    };
    module.exports.configDotenv = DotenvModule.configDotenv;
    module.exports._configVault = DotenvModule._configVault;
    module.exports._parseVault = DotenvModule._parseVault;
    module.exports.config = DotenvModule.config;
    module.exports.decrypt = DotenvModule.decrypt;
    module.exports.parse = DotenvModule.parse;
    module.exports.populate = DotenvModule.populate;
    module.exports = DotenvModule;
  }
});

// ../../node_modules/dotenv/lib/env-options.js
var require_env_options = __commonJS({
  "../../node_modules/dotenv/lib/env-options.js"(exports, module) {
    var options = {};
    if (process.env.DOTENV_CONFIG_ENCODING != null) {
      options.encoding = process.env.DOTENV_CONFIG_ENCODING;
    }
    if (process.env.DOTENV_CONFIG_PATH != null) {
      options.path = process.env.DOTENV_CONFIG_PATH;
    }
    if (process.env.DOTENV_CONFIG_QUIET != null) {
      options.quiet = process.env.DOTENV_CONFIG_QUIET;
    }
    if (process.env.DOTENV_CONFIG_DEBUG != null) {
      options.debug = process.env.DOTENV_CONFIG_DEBUG;
    }
    if (process.env.DOTENV_CONFIG_OVERRIDE != null) {
      options.override = process.env.DOTENV_CONFIG_OVERRIDE;
    }
    if (process.env.DOTENV_CONFIG_DOTENV_KEY != null) {
      options.DOTENV_KEY = process.env.DOTENV_CONFIG_DOTENV_KEY;
    }
    module.exports = options;
  }
});

// ../../node_modules/dotenv/lib/cli-options.js
var require_cli_options = __commonJS({
  "../../node_modules/dotenv/lib/cli-options.js"(exports, module) {
    var re = /^dotenv_config_(encoding|path|quiet|debug|override|DOTENV_KEY)=(.+)$/;
    module.exports = function optionMatcher(args) {
      const options = args.reduce(function(acc, cur) {
        const matches = cur.match(re);
        if (matches) {
          acc[matches[1]] = matches[2];
        }
        return acc;
      }, {});
      if (!("quiet" in options)) {
        options.quiet = "true";
      }
      return options;
    };
  }
});

// ../../node_modules/dotenv/config.js
(function() {
  require_main().config(
    Object.assign(
      {},
      require_env_options(),
      require_cli_options()(process.argv)
    )
  );
})();

// src/index.ts
import http from "node:http";
import fs2 from "node:fs";
import path2 from "node:path";

// ../../projects/core/src/lib/money.ts
function roundMoney(v, decimals = 2) {
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** Math.max(0, Math.floor(decimals));
  const rounded = Math.round((v + Number.EPSILON) * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

// ../../projects/core/src/lib/binance-p2p.ts
function parseBinanceP2pItems(data) {
  if (!data) return [];
  const items = Array.isArray(data) ? data : data?.data;
  if (!Array.isArray(items)) return [];
  const offers = [];
  for (const item of items) {
    const adv = item?.adv;
    const advertiser = item?.advertiser;
    if (!adv || !adv.price) continue;
    const price = Number(adv.price);
    if (isNaN(price) || price <= 0) continue;
    const payMethods = (adv.tradeMethods ?? []).map((m) => m.tradeMethodName ?? m.identifier ?? "").filter((m) => m.length > 0);
    offers.push({
      advNo: String(adv.advNo ?? ""),
      price: roundMoney(price, 2),
      merchantName: advertiser?.nickName ?? "An\xF3nimo",
      finishRatePct: Math.round((advertiser?.monthFinishRate ?? 1) * 100),
      orderCount: advertiser?.monthOrderCount ?? 0,
      minVes: roundMoney(Number(adv.minSingleTransAmount ?? 0), 2),
      maxVes: roundMoney(Number(adv.maxSingleTransAmount ?? 0), 2),
      payMethods
    });
  }
  return offers;
}
function filterOffersByPayMethod(offers, methodName) {
  if (!methodName || methodName.trim().length === 0 || methodName.toUpperCase() === "ALL") {
    return [...offers];
  }
  const norm = methodName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return offers.filter(
    (o) => o.payMethods.some(
      (pm) => pm.toLowerCase().replace(/[^a-z0-9]/g, "").includes(norm)
    )
  );
}
function computeMarketDepth(buyAdsRaw, sellAdsRaw, asset = "USDT", fiat = "VES", filterMethod) {
  const buyOffers = filterOffersByPayMethod(parseBinanceP2pItems(buyAdsRaw), filterMethod);
  const sellOffers = filterOffersByPayMethod(parseBinanceP2pItems(sellAdsRaw), filterMethod);
  const bestBuyPrice = buyOffers.length > 0 ? Math.min(...buyOffers.map((o) => o.price)) : 0;
  const bestSellPrice = sellOffers.length > 0 ? Math.max(...sellOffers.map((o) => o.price)) : 0;
  let spreadVes = 0;
  let spreadPct = 0;
  if (bestBuyPrice > 0 && bestSellPrice > 0) {
    spreadVes = roundMoney(bestSellPrice - bestBuyPrice, 2);
    spreadPct = roundMoney(spreadVes / bestBuyPrice * 100, 2);
  }
  return {
    asset,
    fiat,
    bestBuyPrice,
    bestSellPrice,
    spreadVes,
    spreadPct,
    buyOffers: buyOffers.slice(0, 5),
    sellOffers: sellOffers.slice(0, 5),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// ../../projects/core/src/lib/market-scanner.ts
var HIGH_DEMAND_TIERS_USDT = [1e3, 2500, 5e3, 1e4];
var MAKER_FEE_RATES = {
  STANDARD: 25e-4,
  // 0.25% (No verificado / Comerciante estándar)
  BRONZE: 2e-3,
  // 0.20%
  SILVER: 175e-5,
  // 0.175%
  GOLD: 125e-5
  // 0.125%
};
function filterQualifiedCompetitors(offers, criteria = {}) {
  const minRate = criteria.minFinishRatePct ?? 90;
  const minCount = criteria.minOrderCount ?? 50;
  return offers.filter((o) => {
    return o.finishRatePct >= minRate && o.orderCount >= minCount && o.price > 0;
  });
}
function normalizePaymentMethod(method) {
  return method.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function offerMatchesBank(offer, bankFilter) {
  if (!bankFilter || bankFilter.toUpperCase() === "ALL" || bankFilter.trim().length === 0) {
    return true;
  }
  const normFilter = normalizePaymentMethod(bankFilter);
  return offer.payMethods.some((pm) => normalizePaymentMethod(pm).includes(normFilter));
}
function offerAbsorbsCapital(offer, targetCapitalVes) {
  if (targetCapitalVes <= 0) return true;
  if (offer.maxVes > 0 && offer.maxVes < targetCapitalVes) {
    return false;
  }
  if (offer.minVes > targetCapitalVes) {
    return false;
  }
  return true;
}
function computeHighDemandScan(depth, options = {}) {
  const merchantLevel = options.merchantLevel ?? "STANDARD";
  const makerFeeRate = MAKER_FEE_RATES[merchantLevel] ?? 25e-4;
  const makerFeeRatePct = roundMoney(makerFeeRate * 100, 3);
  const stepVes = options.stepVes && options.stepVes > 0 ? options.stepVes : 0.01;
  const bankFilter = options.bankFilter?.trim() || "ALL";
  const emptyResult = {
    asset: depth?.asset ?? "USDT",
    fiat: depth?.fiat ?? "VES",
    bankFilter,
    merchantLevel,
    makerFeeRatePct,
    scannedAt: depth?.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    tiers: [],
    bestOpportunityTier: null
  };
  if (!depth || depth.bestBuyPrice <= 0 || depth.bestSellPrice <= 0) {
    return emptyResult;
  }
  const refRate = (depth.bestBuyPrice + depth.bestSellPrice) / 2;
  const qualifiedBuys = filterQualifiedCompetitors(
    depth.buyOffers ?? [],
    options.filterCriteria
  ).filter((o) => offerMatchesBank(o, bankFilter));
  const qualifiedSells = filterQualifiedCompetitors(
    depth.sellOffers ?? [],
    options.filterCriteria
  ).filter((o) => offerMatchesBank(o, bankFilter));
  const tiers = [];
  for (const tierUsdt of HIGH_DEMAND_TIERS_USDT) {
    const tierVes = roundMoney(tierUsdt * refRate, 2);
    const eligibleBuys = qualifiedBuys.filter((o) => offerAbsorbsCapital(o, tierVes));
    const eligibleSells = qualifiedSells.filter((o) => offerAbsorbsCapital(o, tierVes));
    eligibleBuys.sort((a, b) => b.price - a.price);
    eligibleSells.sort((a, b) => a.price - b.price);
    const hasFullAbsorption = eligibleBuys.length > 0 && eligibleSells.length > 0;
    const fallbackBuy = eligibleBuys.length === 0 && qualifiedBuys.length > 0 ? [...qualifiedBuys].sort((a, b) => b.price - a.price)[0] : null;
    const fallbackSell = eligibleSells.length === 0 && qualifiedSells.length > 0 ? [...qualifiedSells].sort((a, b) => a.price - b.price)[0] : null;
    const bestCompBuy = eligibleBuys.length > 0 ? eligibleBuys[0].price : fallbackBuy?.price ?? 0;
    const bestCompSell = eligibleSells.length > 0 ? eligibleSells[0].price : fallbackSell?.price ?? 0;
    const bestCompBuyMerchant = eligibleBuys.length > 0 ? eligibleBuys[0].merchantName : fallbackBuy?.merchantName ?? "";
    const bestCompSellMerchant = eligibleSells.length > 0 ? eligibleSells[0].merchantName : fallbackSell?.merchantName ?? "";
    let suggestedBuy = bestCompBuy > 0 ? roundMoney(bestCompBuy + stepVes, 2) : 0;
    let suggestedSell = bestCompSell > 0 ? roundMoney(bestCompSell - stepVes, 2) : 0;
    if (options.maxBuyPrice && options.maxBuyPrice > 0 && suggestedBuy > options.maxBuyPrice) {
      suggestedBuy = roundMoney(options.maxBuyPrice, 2);
    }
    if (options.breakEvenSellPrice && options.breakEvenSellPrice > 0 && suggestedSell < options.breakEvenSellPrice) {
      suggestedSell = roundMoney(options.breakEvenSellPrice, 2);
    }
    const hasTwoSidedMarket = suggestedBuy > 0 && suggestedSell > 0;
    let grossSpreadVes = 0;
    let grossSpreadPct = 0;
    let netSpreadVes = 0;
    let netSpreadPct = 0;
    let netProfitVes = 0;
    let netProfitUsdt = 0;
    let isActionable = false;
    let statusNote = "Sin liquidez calificada en ambos lados para este tramo";
    const totalFeePct = roundMoney(makerFeeRatePct * 2, 3);
    if (hasTwoSidedMarket) {
      grossSpreadVes = roundMoney(suggestedSell - suggestedBuy, 2);
      grossSpreadPct = roundMoney(grossSpreadVes / suggestedBuy * 100, 2);
      netSpreadPct = roundMoney(grossSpreadPct - totalFeePct, 2);
      netSpreadVes = roundMoney(suggestedBuy * (netSpreadPct / 100), 2);
      netProfitVes = roundMoney(tierUsdt * netSpreadVes, 2);
      netProfitUsdt = roundMoney(netProfitVes / suggestedSell, 2);
      if (hasFullAbsorption && netSpreadPct > 0) {
        isActionable = true;
        statusNote = `Spread neto positivo (+${netSpreadPct}%) descontando comisiones Maker (${makerFeeRatePct}% x 2)`;
      } else if (!hasFullAbsorption && netSpreadPct > 0) {
        isActionable = false;
        statusNote = `Referencia orientativa: liquidez del libro no absorbe el 100% del tramo (${tierUsdt} USDT)`;
      } else {
        isActionable = false;
        statusNote = `Spread comprimido: el margen bruto (+${grossSpreadPct}%) no cubre comisiones (${totalFeePct}%)`;
      }
    }
    const velocityFactor = tierUsdt === 1e3 ? 1.3 : tierUsdt === 2500 ? 1.2 : tierUsdt === 5e3 ? 1 : 0.8;
    const opportunityScore = isActionable ? roundMoney(netSpreadPct * velocityFactor, 2) : 0;
    tiers.push({
      tierUsdt,
      tierVes,
      qualifiedBuyOffersCount: eligibleBuys.length,
      qualifiedSellOffersCount: eligibleSells.length,
      bestCompetitorBuyPrice: bestCompBuy,
      bestCompetitorSellPrice: bestCompSell,
      bestCompetitorBuyMerchant: bestCompBuyMerchant || void 0,
      bestCompetitorSellMerchant: bestCompSellMerchant || void 0,
      suggestedBuyPrice: suggestedBuy,
      suggestedSellPrice: suggestedSell,
      grossSpreadVes,
      grossSpreadPct,
      makerFeeBuyPct: makerFeeRatePct,
      makerFeeSellPct: makerFeeRatePct,
      totalFeePct,
      netSpreadVes,
      netSpreadPct,
      netProfitVesPerCycle: netProfitVes,
      netProfitUsdtPerCycle: netProfitUsdt,
      opportunityScore,
      isActionable,
      statusNote
    });
  }
  const actionableTiers = tiers.filter((t) => t.isActionable);
  actionableTiers.sort((a, b) => b.opportunityScore - a.opportunityScore);
  const bestOpportunityTier = actionableTiers.length > 0 ? actionableTiers[0] : null;
  return {
    ...emptyResult,
    tiers,
    bestOpportunityTier
  };
}

// ../../projects/core/src/lib/repricer.ts
function calculatePositionPrice(offers, side, strategy, stepVes = 0.01) {
  if (offers.length === 0) return 0;
  const sorted = [...offers].sort(
    (a, b) => side === "BUY" ? b.price - a.price : a.price - b.price
  );
  let targetIndex = 0;
  if (strategy === "TOP_2" && sorted.length >= 2) targetIndex = 1;
  if (strategy === "TOP_3" && sorted.length >= 3) targetIndex = 2;
  const basePrice = sorted[targetIndex].price;
  if (strategy === "MATCH") {
    return roundMoney(basePrice, 2);
  }
  if (side === "BUY") {
    return roundMoney(basePrice + (strategy === "UNDERCUT" ? stepVes : 0), 2);
  } else {
    return roundMoney(basePrice - (strategy === "UNDERCUT" ? stepVes : 0), 2);
  }
}

// ../../projects/core/src/lib/telegram-sentinel.ts
function escapeMarkdownV2(text) {
  if (!text) return "";
  return text.replace(/([_*[\]()~>#+=|{}.!\\-])/g, "\\$1");
}
function formatBcvIntelligenceTelegramMessage(intel) {
  const bs = (value) => value == null ? "s/d" : `${value.toFixed(2)} Bs`;
  const zoneIcon = intel.zone === "CRITICAL_DISPERSION" ? "\u{1F534}" : intel.zone === "ELEVATED" ? "\u{1F7E1}" : intel.zone === "COMPRESSED" ? "\u{1F535}" : "\u26AA";
  const gapLine = intel.gapPct == null ? `\u26A1 *Brecha:* ${zoneIcon} *no disponible*` : `\u26A1 *Brecha:* ${zoneIcon} *+${escapeMarkdownV2(intel.gapPct.toFixed(2))}%* \\(\`${escapeMarkdownV2(bs(intel.gapVes))}\`\\)`;
  return `\u{1F3DB}\uFE0F *INTELIGENCIA CAMBIARIA BCV* \u{1F3DB}\uFE0F
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4C8} *Tasa Paralelo:* \`${escapeMarkdownV2(bs(intel.parallelRate))}\`
\u{1F3DB}\uFE0F *Tasa Oficial BCV:* \`${escapeMarkdownV2(bs(intel.bcvRate))}\`
${gapLine}
\u{1F4CA} *Zona:* \`${escapeMarkdownV2(intel.zone)}\`

\u23F1\uFE0F *Fase del Ciclo:* \`${escapeMarkdownV2(intel.phase)}\`
\u{1F4C5} *Pr\xF3xima Inyecci\xF3n:* \`${escapeMarkdownV2(intel.nextExpectedIntervention)}\` _(calendario; sin modelo probabil\xEDstico)_
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F3AF} *Directiva de Tesorer\xEDa:*
\u{1F449} *${escapeMarkdownV2(intel.actionLabel)}*
\u23F3 _Timing: ${escapeMarkdownV2(intel.timingNotice)}_`;
}
function formatMetric(value, decimals = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/d";
  return escapeMarkdownV2(value.toFixed(decimals));
}
function formatPlainMetric(value, decimals = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/d";
  return value.toFixed(decimals);
}
function formatCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/d";
  return escapeMarkdownV2(String(value));
}
function formatCodeSpan(value) {
  const safe = typeof value === "string" ? value.replace(/[`\\]/g, "") : "";
  return escapeMarkdownV2(safe);
}
function formatRadarTelegramMessage(rows, opts = {}) {
  const bankRaw = typeof opts.bank === "string" && opts.bank.trim() ? opts.bank.trim() : "todos";
  const capitalRaw = typeof opts.capital === "number" && Number.isFinite(opts.capital) ? `${opts.capital.toFixed(2)} USDT` : "sin filtro";
  const header = `\u{1F50E} *Filtro:* banco \`${formatCodeSpan(bankRaw)}\` \u2022 capital \`${formatCodeSpan(capitalRaw)}\``;
  if (!Array.isArray(rows) || rows.length === 0) {
    return `\u{1F4E1} *RADAR DE GAPS \\(SIN RESULTADOS\\)* \u{1F4E1}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${header}
\u26A0\uFE0F ${escapeMarkdownV2("Ninguna oferta cumple el criterio solicitado")}`;
  }
  let topIndex = 0;
  for (let i = 1; i < rows.length; i++) {
    const candidate = rows[i].spreadPct;
    const best = rows[topIndex].spreadPct;
    const candidateOk = typeof candidate === "number" && Number.isFinite(candidate);
    const bestOk = typeof best === "number" && Number.isFinite(best);
    if (candidateOk && (!bestOk || candidate > best)) topIndex = i;
  }
  const body = rows.map((row, index) => {
    const marker = index === topIndex ? ` \u{1F947} *${escapeMarkdownV2("TOP GAP")}*` : "";
    const bank = typeof row.bank === "string" && row.bank.trim() ? row.bank.trim() : "sin banco";
    const merchantTag = row.merchantName ? `
   \u2022 Vendedor: \`${formatCodeSpan(row.merchantName)}\`` : "";
    return `${index + 1}\\. *${formatCodeSpan(bank)}*${marker}
   \u2022 Precio: \`${formatMetric(row.price)}\`${merchantTag}
   \u2022 Tope TC: \`${formatCount(row.maxTc)}\`
   \u2022 Volumen: \`${formatMetric(row.volumeUsdt, 0)} USDT\`
   \u2022 Spread: \`${formatMetric(row.spreadPct)}%\``;
  }).join("\n\n");
  return `\u{1F4E1} *RADAR DE GAPS* \u{1F4E1}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${header}
\u2501\u2501\u2501\u2501\u2501
${body}`;
}
function formatRadarAltaDemandaTelegramMessage(scan, bankFilter) {
  const bankRaw = bankFilter && bankFilter.trim() ? bankFilter.trim() : "TODOS";
  const header = `\u{1F50E} *Filtro:* Banco \`${formatCodeSpan(bankRaw)}\` \u2022 *Nivel:* \`${formatCodeSpan(scan.merchantLevel)}\` \\(Fee: \`${formatMetric(scan.makerFeeRatePct)}%\`\\)`;
  if (!scan.tiers || scan.tiers.length === 0) {
    return `\u{1F3AF} *RADAR DE ALTA DEMANDA \\(SIN DATOS\\)* \u{1F3AF}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${header}
\u26A0\uFE0F ${escapeMarkdownV2("Profundidad de mercado no disponible para evaluar tramos.")}`;
  }
  const rows = scan.tiers.map((t) => {
    const icon = t.isActionable ? "\u{1F7E2}" : "\u26AA";
    const bestTag = scan.bestOpportunityTier?.tierUsdt === t.tierUsdt ? " \u{1F3C6} *RECOMENDADO*" : "";
    const buyCompTag = t.bestCompetitorBuyMerchant ? ` \\(Comprador: \`${formatCodeSpan(t.bestCompetitorBuyMerchant)}\` \u2022 ${formatMetric(t.bestCompetitorBuyPrice)}\\)` : ` \\(Comp\\.: ${formatMetric(t.bestCompetitorBuyPrice)}\\)`;
    const sellCompTag = t.bestCompetitorSellMerchant ? ` \\(Vendedor: \`${formatCodeSpan(t.bestCompetitorSellMerchant)}\` \u2022 ${formatMetric(t.bestCompetitorSellPrice)}\\)` : ` \\(Comp\\.: ${formatMetric(t.bestCompetitorSellPrice)}\\)`;
    const netSpreadSign = t.netSpreadPct >= 0 ? "+" : "";
    return `${icon} *Tramo: ${t.tierUsdt.toLocaleString("en-US")} USDT* \\(\u2248 ${formatMetric(t.tierVes)} Bs\\)${bestTag}
   \u2022 Compra Maker: \`${formatPlainMetric(t.suggestedBuyPrice)} Bs\`${buyCompTag}
   \u2022 Venta Maker: \`${formatPlainMetric(t.suggestedSellPrice)} Bs\`${sellCompTag}
   \u2022 Spread Bruto: \`${formatPlainMetric(t.grossSpreadPct)}%\` \\(\u0394 ${formatMetric(t.grossSpreadVes)} Bs\\)
   \u2022 \u26A1 *Margen Neto Real:* \`${netSpreadSign}${formatPlainMetric(t.netSpreadPct)}%\` \\(Neto: \`${formatPlainMetric(t.netProfitUsdtPerCycle)} USDT\`\\)
   \u2022 Liquidez Calificada: \`${t.qualifiedBuyOffersCount} buys / ${t.qualifiedSellOffersCount} sells\``;
  }).join("\n\n");
  return `\u{1F3AF} *RADAR DE ALTA DEMANDA \\(\u2265 1\\.000 USDT\\)* \u{1F3AF}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${header}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${rows}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2139\uFE0F _Micro\\-ajuste \xB10\\.01 Bs sobre el mejor comerciante calificado \\(\u226590% comp\\. \xB7 \u226550 \xF3rdenes\\)_`;
}
function formatMacroTelegramMessage(intel) {
  const rawNote = typeof intel.forecastNote === "string" ? intel.forecastNote.trim() : "";
  const note = rawNote ? `
\u{1F9E0} *Pron\xF3stico:* _${formatCodeSpan(rawNote)}_` : "";
  return `\u{1F30E} *REPORTE MACRO CONSOLIDADO* \u{1F30E}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F3DB}\uFE0F *Referencia BCV:* \`${formatMetric(intel.bcvRef)} Bs\`
\u{1F4B5} *Paralelo:* \`${formatMetric(intel.parallelRef)} Bs\`
\u{1F4CA} *Spread promedio:* \`${formatMetric(intel.spreadPct)}%\`
\u{1F30A} *Volatilidad 2h:* \`${formatMetric(intel.volatility2hPct)}%\`
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501${note}`;
}
function formatRepriceTelegramMessage(req) {
  const buyPrice = typeof req.buyPrice === "number" ? req.buyPrice : Number.NaN;
  const sellPrice = typeof req.sellPrice === "number" ? req.sellPrice : Number.NaN;
  const delta = sellPrice - buyPrice;
  const deltaLine = Number.isFinite(delta) ? `
\u{1F4D0} *Delta venta \u2212 compra:* \`${formatMetric(delta)} Bs\`` : "";
  const head = req.confirmed ? "\u2705 *REPRICE APLICADO* \u2705" : "\u26A0\uFE0F *REPRICE \\(CONFIRMACI\xD3N REQUERIDA\\)* \u26A0\uFE0F";
  const footer = req.confirmed ? `
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F7E2} ${escapeMarkdownV2("Los precios fueron forzados en el motor de repricing")}` : `
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F512} ${escapeMarkdownV2("No se ejecut\xF3 nada: se requiere confirmaci\xF3n expl\xEDcita con el bot\xF3n")}`;
  return `${head}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4B5} *Compra \\(Ask\\):* \`${formatMetric(buyPrice)}\`
\u{1F4B0} *Venta \\(Bid\\):* \`${formatMetric(sellPrice)}\`${deltaLine}${footer}`;
}
var PANEL_CALLBACKS = {
  REFRESH: "PANEL_REFRESH",
  REPRICER_STOP: "PANEL_REPRICER_STOP",
  REPRICER_START: "PANEL_REPRICER_START"
};
function isPanelCallbackData(data) {
  return Object.values(PANEL_CALLBACKS).some((value) => value === data);
}
var REPRICE_CONFIRM_PREFIX = "REPRICE_CONFIRM:";
function parseCommand(text) {
  const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0);
  return { name: tokens[0] ?? "", args: tokens.slice(1) };
}
function parseFiniteNumber(token) {
  if (token === void 0 || token.length === 0) return void 0;
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function parseRepriceCallbackData(data) {
  if (typeof data !== "string" || !data.startsWith(REPRICE_CONFIRM_PREFIX)) return void 0;
  const parts = data.slice(REPRICE_CONFIRM_PREFIX.length).split(":");
  if (parts.length !== 2) return void 0;
  const buyPrice = parseFiniteNumber(parts[0]);
  const sellPrice = parseFiniteNumber(parts[1]);
  if (buyPrice === void 0 || sellPrice === void 0) return void 0;
  return { buyPrice, sellPrice };
}
function buildSentinelReplyKeyboard() {
  return {
    keyboard: [
      [{ text: "\u{1F3AF} Radar Alta Demanda" }, { text: "\u26A1 Spreads en Vivo" }],
      [{ text: "\u{1F3DB}\uFE0F Macro BCV" }, { text: "\u{1F4CA} Cupos Bancarios" }],
      [{ text: "\u{1F916} Panel Terminal" }, { text: "\u{1F6A8} Killswitch" }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}
function normalizeButtonCommand(text) {
  const raw = text.trim();
  if (!raw) return "";
  if (raw.startsWith("/pausar")) return raw;
  const norm = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const highDemandRegex = /^(?:[/]?radar\s*(?:de\s*)?alta\s*(?:de\s*)?manda|[/]?radardealtademanda|[/]?radar_alta_demanda|🎯\s*radar\s*alta\s*demanda|alta\s*(?:de\s*)?manda|radar\s*alta)/i;
  if (highDemandRegex.test(norm)) {
    const remaining = raw.replace(highDemandRegex, "").trim();
    return remaining ? `/radardealtademanda ${remaining}` : "/radardealtademanda";
  }
  if (/^(?:⚡\s*)?(?:[/]?spreads?)(?:\s*en\s*vivo)?/i.test(norm)) {
    return "/spreads";
  }
  if (/^(?:🏛️\s*)?(?:macro\s*bcv|[/]?bcv|tasa\s*bcv)/i.test(norm)) {
    return "/bcv";
  }
  if (/^(?:📊\s*)?(?:[/]?cupos?(?:\s*bancarios?)?|[/]?bancos)/i.test(norm)) {
    return "/bancos";
  }
  if (/^(?:🤖\s*)?(?:[/]?panel(?:\s*terminal)?)/i.test(norm)) {
    return "/panel";
  }
  if (/^(?:🚨\s*)?(?:[/]?killswitch|pausar|parar)/i.test(norm)) {
    return "/killswitch";
  }
  if (/^(?:▶\s*)?(?:[/]?resume|[/]?reanudar)/i.test(norm)) {
    return "/resume";
  }
  if (/^(?:📡\s*)?(?:[/]?radar(?:\s*gaps)?)$/i.test(norm)) {
    return "/radar";
  }
  if (/^(?:🔥\s*)?(?:[/]?heatmap|[/]?horarios|mapa\s*(?:de\s*)?calor)/i.test(norm)) {
    return "/heatmap";
  }
  return raw;
}
function formatRadarUsageMessage() {
  return `\u{1F4E1} *RADAR DE GAPS* \u{1F4E1}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2139\uFE0F *Formato:* \`/radar [banco] [capital]\`
\u2022 \`/radar\` ${escapeMarkdownV2("\u2192 todos los bancos, sin filtro de capital")}
\u2022 \`/radar bcv\` ${escapeMarkdownV2("\u2192 banco bcv, cualquier capital")}
\u2022 \`/radar bcv 2000\` ${escapeMarkdownV2("\u2192 banco bcv con 2000 USDT de capital")}
\u26A0\uFE0F ${escapeMarkdownV2("El banco es texto libre y el capital debe ser un n\xFAmero finito")}`;
}
function formatRepriceUsageMessage() {
  return `\u26A0\uFE0F *REPRICE \\(COMANDO DESTRUCTIVO\\)* \u26A0\uFE0F
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2139\uFE0F *Formato:* \`/reprecio <buy> <sell>\`
\u2022 ${escapeMarkdownV2("Ejemplo")}: \`/reprecio 84.5 85.2\`
\u{1F6AB} ${escapeMarkdownV2("Ambos precios son obligatorios y deben ser n\xFAmeros finitos")}`;
}
function dispatchTelegramUpdate(update, authorizedChatId) {
  const authId = Number(authorizedChatId);
  if (update.message) {
    const fromId = update.message.from.id;
    const rawText = (update.message.text || update.message.caption || "").trim();
    const text = normalizeButtonCommand(rawText);
    if (text.startsWith("/start") || text.startsWith("/menu")) {
      const isAuth = fromId === authId;
      const pairingInfo = isAuth ? escapeMarkdownV2("Tu terminal P2P ya est\xE1 vinculado a este chat.") : `\u2139\uFE0F ${escapeMarkdownV2("Para autorizar este chat, ingres\xE1 este ID")} \`${fromId}\` ${escapeMarkdownV2("en")} *${escapeMarkdownV2("Reglas de Riesgo > Telegram Sentinel")}* ${escapeMarkdownV2("o puls\xE1")} *${escapeMarkdownV2('"Detectar mi Chat ID"')}*`;
      const availableCommands = [
        ["/status", "Estado en tiempo real del terminal"],
        ["/spreads", "Monitoreo de m\xE1rgenes y arbitraje"],
        ["/bcv", "Inteligencia cambiaria y ventana BCV"],
        ["/bancos", "Cupos bancarios y l\xEDmites SUDEBAN"],
        ["/radar [banco] [capital]", "Radar de gaps con filtro por banco y capital"],
        ["/radardealtademanda [banco] [tramo]", "Radar de alta demanda (\u22651k USDT) con fee Maker y micro-postura"],
        ["/reprecio <buy> <sell>", "Forzar repricing (requiere confirmaci\xF3n)"],
        ["/macro", "Reporte macro consolidado: BCV, spread y volatilidad"],
        ["/backtest [par] [temporalidad]", "Simulaci\xF3n hist\xF3rica del par"],
        ["/panel", "Panel editable del terminal: se actualiza en el lugar"],
        ["/killswitch", "Parada de emergencia inmediata"],
        ["/resume", "Reanudar operaciones"]
      ].map(([cmd, desc]) => `\u2022 \`${cmd}\` \\- ${escapeMarkdownV2(desc)}`).join("\n");
      return {
        authorized: true,
        command: "/start",
        action: "STATUS",
        responseMarkdown: `\u{1F916} *${escapeMarkdownV2("TELEGRAM SENTINEL 2.0 CONECTADO Y OPERATIVO")}* \u{1F6E1}\uFE0F

\u2705 ${escapeMarkdownV2("Tu Telegram Chat ID es")}: \`${fromId}\`

${pairingInfo}

*${escapeMarkdownV2("Comandos disponibles")}:*
${availableCommands}

\u{1F4F8} *${escapeMarkdownV2("Auditor\xEDa de Comprobantes")}:* ${escapeMarkdownV2("Envi\xE1 una foto de un Pago M\xF3vil o transferencia y la auditar\xE9 al instante.")}`
      };
    }
    if (fromId !== authId) {
      return {
        authorized: false,
        responseMarkdown: escapeMarkdownV2(
          `\u26D4 ACCESO DENEGADO (USUARIO NO AUTORIZADO): Tu Chat ID es ${fromId}. Configuralo en tu Terminal P2P (Reglas de Riesgo > Telegram Sentinel) para autorizar este chat.`
        )
      };
    }
    if (update.message.photo && update.message.photo.length > 0) {
      const bestPhoto = update.message.photo[update.message.photo.length - 1];
      return {
        authorized: true,
        action: "AUDIT_RECEIPT",
        fileId: bestPhoto.file_id,
        responseMarkdown: `\u{1F50D} *COMPROBANTE BANCARIO RECIBIDO*

Iniciando extracci\xF3n OCR y validaci\xF3n cruzada con el Escudo Anti\\-Fraude\\.\\.\\.`
      };
    }
    if (update.message.document) {
      return {
        authorized: true,
        action: "AUDIT_RECEIPT",
        fileId: update.message.document.file_id,
        responseMarkdown: `\u{1F50D} *DOCUMENTO DE PAGO RECIBIDO*

Iniciando extracci\xF3n OCR y validaci\xF3n cruzada con el Escudo Anti\\-Fraude\\.\\.\\.`
      };
    }
    if (text.startsWith("/killswitch") || text.startsWith("/pausar")) {
      return {
        authorized: true,
        command: text.startsWith("/pausar") ? "/pausar" : "/killswitch",
        action: "KILLSWITCH",
        responseMarkdown: `\u{1F6A8} *KILLSWITCH ACTIVADO* \u{1F6A8}

Todos los bots y procesos de repricing han sido detenidos de emergencia\\.`
      };
    }
    if (text.startsWith("/resume")) {
      return {
        authorized: true,
        command: "/resume",
        action: "RESUME",
        responseMarkdown: `\u25B6 *BOTS REANUDADOS*

El sistema contin\xFAa operando con las reglas de riesgo activas\\.`
      };
    }
    if (text.startsWith("/status")) {
      return {
        authorized: true,
        command: "/status",
        action: "STATUS",
        responseMarkdown: `\u{1F4CA} *ESTADO DEL TERMINAL P2P*

\u2022 Sistema: *ONLINE*
\u2022 Auditor\xEDa Forense: *ACTIVA*
\u2022 Criptograf\xEDa: *ENCRIPTADA*`
      };
    }
    if (text.startsWith("/spreads")) {
      return {
        authorized: true,
        command: "/spreads",
        action: "SPREADS",
        responseMarkdown: `\u{1F4C8} *RADAR DE MERCADO*

Consulta el panel de Spread Monitor para ver las mejores ofertas en vivo\\.`
      };
    }
    if (text.startsWith("/bcv")) {
      return {
        authorized: true,
        command: "/bcv",
        action: "BCV",
        responseMarkdown: `\u{1F3DB}\uFE0F *CONSULTANDO CICLO CAMBIARIO BCV*\\.\\.\\.`
      };
    }
    if (text.startsWith("/bancos")) {
      return {
        authorized: true,
        command: "/bancos",
        action: "BANCOS",
        responseMarkdown: `\u{1F3E6} *CONSULTANDO CUPOS BANCARIOS SUDEBAN*\\.\\.\\.`
      };
    }
    const command = parseCommand(text);
    if (command.name === "/radar") {
      const [first, second] = command.args;
      let bank;
      let capital;
      if (first !== void 0) {
        const asCapital = parseFiniteNumber(first);
        if (asCapital !== void 0) {
          capital = asCapital;
        } else {
          bank = first;
        }
      }
      if (second !== void 0) {
        const secondCapital = parseFiniteNumber(second);
        if (secondCapital === void 0) {
          return {
            authorized: true,
            command: "/radar",
            responseMarkdown: formatRadarUsageMessage()
          };
        }
        capital = secondCapital;
      }
      const params = {};
      if (bank !== void 0) params.bank = bank;
      if (capital !== void 0) params.capital = capital;
      return {
        authorized: true,
        command: "/radar",
        action: "RADAR_SCAN",
        params,
        responseMarkdown: `\u{1F4E1} *RADAR DE GAPS ACTIVADO* \u{1F4E1}

\u{1F50E} *Filtro:* banco \`${formatCodeSpan(bank ?? "todos")}\` \u2022 capital \`${formatCodeSpan(capital === void 0 ? "sin filtro" : `${capital} USDT`)}\``
      };
    }
    if (command.name === "/radardealtademanda") {
      const [first, second] = command.args;
      let bank;
      let tierUsdt;
      let showAllTiers = true;
      const parseTierToken = (t) => {
        if (!t) return void 0;
        const norm = t.toLowerCase().trim();
        if (norm === "1k" || norm === "1000") return 1e3;
        if (norm === "2.5k" || norm === "2500") return 2500;
        if (norm === "5k" || norm === "5000") return 5e3;
        if (norm === "10k" || norm === "10000") return 1e4;
        const n = parseFiniteNumber(norm);
        return n !== void 0 && n >= 1e3 ? n : void 0;
      };
      if (first !== void 0) {
        const parsedTier = parseTierToken(first);
        if (parsedTier !== void 0) {
          tierUsdt = parsedTier;
          showAllTiers = false;
        } else if (first.toLowerCase() !== "tramos") {
          bank = first;
        }
      }
      if (second !== void 0) {
        const parsedTier = parseTierToken(second);
        if (parsedTier !== void 0) {
          tierUsdt = parsedTier;
          showAllTiers = false;
        }
      }
      const params = {
        bank,
        tierUsdt,
        showAllTiers
      };
      return {
        authorized: true,
        command: "/radardealtademanda",
        action: "RADAR_ALTA_DEMANDA",
        params,
        responseMarkdown: `\u{1F3AF} *RADAR DE ALTA DEMANDA ACTIVADO* \u{1F3AF}

\u{1F50E} *Filtro:* banco \`${formatCodeSpan(bank ?? "todos")}\` \u2022 tramo \`${formatCodeSpan(tierUsdt !== void 0 ? `${tierUsdt} USDT` : "todos (\u22651.000 USDT)")}\``
      };
    }
    if (command.name === "/autoreprice" || command.name === "/autoreprecio") {
      const mode = (command.args[0] || "status").toLowerCase();
      if (mode === "on" || mode === "activar") {
        return {
          authorized: true,
          command: command.name,
          action: "AUTOREPRICE_ON",
          params: { mode: "on" },
          responseMarkdown: `\u{1F7E2} *REPRECIO DIN\xC1MICO AUT\xD3NOMO 24/7 ACTIVADO*

El servidor ajustar\xE1 autom\xE1ticamente las posturas en el libro de \xF3rdenes respetando los pisos de seguridad y buffers de volatilidad\\.`
        };
      }
      if (mode === "off" || mode === "pausar" || mode === "detener") {
        return {
          authorized: true,
          command: command.name,
          action: "AUTOREPRICE_OFF",
          params: { mode: "off" },
          responseMarkdown: `\u23F8\uFE0F *REPRECIO DIN\xC1MICO AUT\xD3NOMO PAUSADO*

Las posturas ya no se actualizar\xE1n autom\xE1ticamente\\.`
        };
      }
      if (mode === "config" || mode === "configurar") {
        const strategy = command.args[1]?.toUpperCase() || "TOP_1";
        const minSpread = parseFiniteNumber(command.args[2]) || 0.6;
        return {
          authorized: true,
          command: command.name,
          action: "AUTOREPRICE_CONFIG",
          params: { mode: "config", strategy, minSpread },
          responseMarkdown: `\u2699\uFE0F *CONFIGURACI\xD3N DE REPRECIO ACTUALIZADA*

\u2022 Estrategia: \`${strategy}\`
\u2022 Spread M\xEDnimo: \`${minSpread.toFixed(2)}%\``
        };
      }
      return {
        authorized: true,
        command: command.name,
        action: "AUTOREPRICE_STATUS",
        params: { mode: "status" },
        responseMarkdown: `\u{1F4CA} *CONSULTANDO ESTADO DEL REPRECIADOR DIN\xC1MICO 24/7*\\.\\.\\.`
      };
    }
    if (command.name === "/reprecio") {
      if (command.args[0]?.toLowerCase() === "auto") {
        const subMode = (command.args[1] || "status").toLowerCase();
        if (subMode === "on") {
          return {
            authorized: true,
            command: "/reprecio",
            action: "AUTOREPRICE_ON",
            params: { mode: "on" },
            responseMarkdown: `\u{1F7E2} *REPRECIO DIN\xC1MICO AUT\xD3NOMO 24/7 ACTIVADO*

El servidor ajustar\xE1 autom\xE1ticamente las posturas en el libro de \xF3rdenes respetando los pisos de seguridad y buffers de volatilidad\\.`
          };
        }
        if (subMode === "off") {
          return {
            authorized: true,
            command: "/reprecio",
            action: "AUTOREPRICE_OFF",
            params: { mode: "off" },
            responseMarkdown: `\u23F8\uFE0F *REPRECIO DIN\xC1MICO AUT\xD3NOMO PAUSADO*

Las posturas ya no se actualizar\xE1n autom\xE1ticamente\\.`
          };
        }
        return {
          authorized: true,
          command: "/reprecio",
          action: "AUTOREPRICE_STATUS",
          params: { mode: "status" },
          responseMarkdown: `\u{1F4CA} *CONSULTANDO ESTADO DEL REPRECIADOR DIN\xC1MICO 24/7*\\.\\.\\.`
        };
      }
      const buyPrice = parseFiniteNumber(command.args[0]);
      const sellPrice = parseFiniteNumber(command.args[1]);
      if (buyPrice === void 0 || sellPrice === void 0) {
        return {
          authorized: true,
          command: "/reprecio",
          responseMarkdown: formatRepriceUsageMessage()
        };
      }
      return {
        authorized: true,
        command: "/reprecio",
        action: "REPRICE_REQUEST",
        params: { buyPrice, sellPrice },
        responseMarkdown: formatRepriceTelegramMessage({ buyPrice, sellPrice, confirmed: false })
      };
    }
    if (command.name === "/macro") {
      return {
        authorized: true,
        command: "/macro",
        action: "MACRO",
        responseMarkdown: `\u{1F30E} *CONSULTANDO REPORTE MACRO CONSOLIDADO*\\.\\.\\.`
      };
    }
    if (command.name === "/backtest") {
      const [pair, timeframe] = command.args;
      const params = {};
      if (pair !== void 0) params.pair = pair;
      if (timeframe !== void 0) params.timeframe = timeframe;
      const selector = formatCodeSpan(
        `${pair ?? "par por defecto"} ${timeframe ?? "temporalidad por defecto"}`
      );
      return {
        authorized: true,
        command: "/backtest",
        action: "BACKTEST_REQUEST",
        params,
        responseMarkdown: `\u{1F9EA} *BACKTEST HIST\xD3RICO EN COLA* \u{1F9EA}

\u2699\uFE0F *Selecci\xF3n:* \`${selector}\`
\u23F3 ${escapeMarkdownV2("El simulador puede tardar: el resultado arrive como mensaje posterior")}`
      };
    }
    if (command.name === "/heatmap" || command.name === "/horarios") {
      return {
        authorized: true,
        command: "/heatmap",
        action: "HEATMAP",
        responseMarkdown: `\u{1F525} *GENERANDO MAPA DE CALOR Y ESTACIONALIDAD 24/7*\\.\\.\\.`
      };
    }
    if (command.name === "/panel") {
      return {
        authorized: true,
        command: "/panel",
        action: "PANEL",
        responseMarkdown: `\u{1F6E1}\uFE0F *CONSULTANDO PANEL DEL TERMINAL*\\.\\.\\.`
      };
    }
    return {
      authorized: true,
      command: text,
      responseMarkdown: escapeMarkdownV2(
        `Comando recibido: "${text}". Comandos disponibles: /status, /spreads, /bcv, /bancos, /radar, /heatmap, /reprecio, /macro, /backtest, /panel, /killswitch, /resume o env\xEDa una foto de un comprobante bancario.`
      )
    };
  }
  if (update.callback_query) {
    const fromId = update.callback_query.from.id;
    const data = update.callback_query.data || "";
    if (fromId !== authId) {
      return {
        authorized: false,
        responseMarkdown: escapeMarkdownV2("\u26D4 ACCESO NO AUTORIZADO.")
      };
    }
    if (data.startsWith("DISPUTE_")) {
      const orderId = data.replace("DISPUTE_", "");
      return {
        authorized: true,
        action: "DISPUTE_ORDER",
        orderId,
        responseMarkdown: `\u{1F6A8} *ORDEN ${escapeMarkdownV2(orderId)} BLOQUEADA*

Se ha preparado el reclamo de disputa por terceros no autorizados\\.`
      };
    }
    if (data === "BOT_KILLSWITCH") {
      return {
        authorized: true,
        action: "KILLSWITCH",
        responseMarkdown: `\u{1F6A8} *KILLSWITCH EJECUTADO DESDE TELEGRAM*`
      };
    }
    if (data === "BOT_RESUME") {
      return {
        authorized: true,
        action: "RESUME",
        responseMarkdown: `\u25B6 *REANUDADO EXITOSAMENTE*`
      };
    }
    if (data === "BOT_STATUS") {
      return {
        authorized: true,
        action: "STATUS",
        responseMarkdown: `\u{1F4CA} *ESTADO OPERATIVO VERIFICADO*`
      };
    }
    if (isPanelCallbackData(data)) {
      if (data === PANEL_CALLBACKS.REFRESH) {
        return {
          authorized: true,
          action: "PANEL",
          responseMarkdown: `\u{1F504} *PANEL ACTUALIZADO*`
        };
      }
      if (data === PANEL_CALLBACKS.REPRICER_STOP) {
        return {
          authorized: true,
          action: "KILLSWITCH",
          responseMarkdown: `\u{1F6A8} *MOTOR DE REPRICING DETENIDO DESDE EL PANEL*`
        };
      }
      return {
        authorized: true,
        action: "RESUME",
        responseMarkdown: `\u25B6 *MOTOR DE REPRICING REANUDADO DESDE EL PANEL*`
      };
    }
    const reprice = parseRepriceCallbackData(data);
    if (reprice) {
      return {
        authorized: true,
        action: "REPRICE_EXECUTE",
        params: reprice,
        responseMarkdown: formatRepriceTelegramMessage({
          buyPrice: reprice.buyPrice,
          sellPrice: reprice.sellPrice,
          confirmed: true
        })
      };
    }
    if (data.startsWith(REPRICE_CONFIRM_PREFIX)) {
      return {
        authorized: true,
        responseMarkdown: formatRepriceUsageMessage()
      };
    }
    if (data === "REPRICE_CANCEL") {
      return {
        authorized: true,
        action: "REPRICE_CANCEL",
        responseMarkdown: `\u21A9\uFE0F *REPRICE CANCELADO*

No se forz\xF3 ning\xFAn precio\\.`
      };
    }
    if (data === "BACKTEST_RUN") {
      return {
        authorized: true,
        action: "BACKTEST_EXECUTE",
        responseMarkdown: `\u{1F9EA} *BACKTEST EJECUTADO DESDE TELEGRAM*

\u23F3 ${escapeMarkdownV2("El simulador est\xE1 corriendo: el reporte llegar\xE1 como mensaje posterior")}`
      };
    }
  }
  return {
    authorized: false,
    responseMarkdown: escapeMarkdownV2("Update no reconocido.")
  };
}

// ../../projects/core/src/lib/bcv-intervention-predictor.ts
function calculateBcvGap(parallelRate, bcvRate) {
  const unavailable = (reason) => ({
    // Se conserva la tasa que sí existe para que el operador vea qué se midió.
    parallelRate: Number.isFinite(parallelRate) ? parallelRate : null,
    bcvRate: Number.isFinite(bcvRate) ? bcvRate : null,
    gapVes: null,
    gapPct: null,
    zone: "UNAVAILABLE",
    description: "Brecha indeterminada: falta al menos una de las dos tasas. No se emite zona de riesgo porque no hay medici\xF3n.",
    actionable: false,
    unavailableReason: reason
  });
  if (parallelRate == null || !Number.isFinite(parallelRate) || parallelRate <= 0) {
    return unavailable("TASA_PARALELA_NO_DISPONIBLE");
  }
  if (bcvRate == null || !Number.isFinite(bcvRate) || bcvRate <= 0) {
    return unavailable("TASA_BCV_NO_DISPONIBLE");
  }
  const gapVes = roundMoney(parallelRate - bcvRate);
  const gapPct = Math.round((parallelRate - bcvRate) / bcvRate * 1e4) / 100;
  let zone;
  let description;
  if (gapPct < 10) {
    zone = "COMPRESSED";
    description = "Brecha comprimida (<10%). Fuerte control cambiario o post-inyecci\xF3n masiva de divisas.";
  } else if (gapPct <= 25) {
    zone = "NORMAL";
    description = "Brecha dentro del rango estructural hist\xF3rico (10% - 25%). Operativa est\xE1ndar.";
  } else if (gapPct <= 35) {
    zone = "ELEVATED";
    description = "Brecha elevada (25% - 35%). Alta presi\xF3n en paralelo; alta probabilidad de inyecci\xF3n BCV correctiva.";
  } else {
    zone = "CRITICAL_DISPERSION";
    description = "Dispersi\xF3n cr\xEDtica (>35%). Riesgo cambiario severo; inminente ajuste de tasa oficial o intervenci\xF3n urgente.";
  }
  return {
    parallelRate,
    bcvRate,
    gapVes,
    gapPct,
    zone,
    description,
    actionable: true,
    unavailableReason: null
  };
}
function getVenezuelaTimeParts(date = /* @__PURE__ */ new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 6e4;
  const vetDate = new Date(utc - 4 * 36e5);
  return {
    day: vetDate.getDay(),
    // 0=Domingo, 1=Lunes, ..., 6=Sábado
    hour: vetDate.getHours(),
    minute: vetDate.getMinutes()
  };
}
function predictBcvIntervention(now = /* @__PURE__ */ new Date()) {
  const { day, hour } = getVenezuelaTimeParts(now);
  let phase;
  let nextExpectedIntervention;
  let hoursUntilIntervention;
  let calendarNote;
  const isInterventionDay = day === 1 || day === 4;
  if (isInterventionDay && hour >= 9 && hour <= 13) {
    phase = "INTERVENTION_ACTIVE";
    nextExpectedIntervention = "En curso actualmente";
    hoursUntilIntervention = 0;
    calendarNote = "ventana de subasta bancaria";
  } else if (day === 0 && hour >= 16 || day === 1 && hour < 9 || day === 3 && hour >= 18 || day === 4 && hour < 9) {
    phase = "PRE_INTERVENTION_COMPRESSION";
    nextExpectedIntervention = day === 1 || day === 0 ? "Lunes 09:30 AM VET" : "Jueves 09:30 AM VET";
    hoursUntilIntervention = day === 1 || day === 4 ? Math.max(1, 9 - hour) : 12;
    calendarNote = "ventana previa a subasta";
  } else if (isInterventionDay && hour > 13 || day === 2 || day === 5) {
    phase = "POST_INTERVENTION_REBOUND";
    nextExpectedIntervention = day <= 2 ? "Jueves 09:30 AM VET" : "Pr\xF3ximo Lunes 09:30 AM VET";
    hoursUntilIntervention = day === 2 ? 40 : day === 5 ? 65 : 20;
    calendarNote = "ventana posterior a subasta";
  } else {
    phase = "QUIET_ACCUMULATION";
    nextExpectedIntervention = day === 3 ? "Jueves 09:30 AM VET" : "Lunes 09:30 AM VET";
    hoursUntilIntervention = day === 3 ? 18 : 36;
    calendarNote = "fuera de subastas bancarias";
  }
  return {
    vetDayOfWeek: day,
    vetHour: hour,
    phase,
    probabilityPct: null,
    probabilityBasis: "NO_MODEL",
    nextExpectedIntervention,
    hoursUntilIntervention,
    rationale: `Fase de calendario: ${calendarNote} (${day === 1 ? "Lunes" : day === 4 ? "Jueves" : "d\xEDa no h\xE1bil"}, ${String(hour).padStart(2, "0")}:00 VET). Esta herramienta no hay modelo probabil\xEDstico ni hist\xF3rico de intervenciones, por lo que no emite probabilidad de intervenci\xF3n.`,
    actionable: false
  };
}
function recommendBcvTreasuryAction(gap, window) {
  if (gap.gapPct == null) {
    const reason = gap.unavailableReason ?? "TASA_NO_DISPONIBLE";
    const measured = `Paralelo: ${gap.parallelRate ?? "s/d"} VES \xB7 BCV: ${gap.bcvRate ?? "s/d"} VES`;
    return {
      action: "UNAVAILABLE",
      confidencePct: 0,
      actionLabel: "SIN MEDICI\xD3N \u2014 NO OPERAR",
      timingNotice: "Sin instrucci\xF3n hasta disponer de ambas tasas",
      rationale: `Brecha indeterminada (${reason}): no se emite recomendaci\xF3n t\xE1ctica porque no hay medici\xF3n. ${measured}.`,
      actionable: false
    };
  }
  if (gap.zone === "CRITICAL_DISPERSION") {
    return {
      action: "DEFENSIVE_HEDGE",
      confidencePct: 92,
      actionLabel: "BLINDAJE DEFENSIVO (HEDGE USDT M\xC1XIMO)",
      timingNotice: "Inmediata \u2014 Alto riesgo cambiario",
      rationale: "La brecha supera el 35%. Riesgo inminente de devaluaci\xF3n oficial brusca o descontrol en el paralelo. Mant\xE9n el inventario 100% en USDT y minimiza exposici\xF3n a bol\xEDvares.",
      actionable: true
    };
  }
  if (window.phase === "PRE_INTERVENTION_COMPRESSION" && (gap.zone === "ELEVATED" || gap.gapPct >= 22)) {
    return {
      action: "ACCUMULATE_VES_HIGH",
      confidencePct: 88,
      actionLabel: "VENDER USDT EN M\xC1XIMOS (CAPTURA DE SPREAD)",
      timingNotice: `Vender antes de ${window.nextExpectedIntervention}`,
      rationale: "La brecha est\xE1 caliente y el BCV inyectar\xE1 divisas en breve. Liquida USDT a precios pico del paralelo antes de que la subasta enfr\xEDe moment\xE1neamente el mercado.",
      actionable: true
    };
  }
  if (window.phase === "INTERVENTION_ACTIVE" || window.phase === "POST_INTERVENTION_REBOUND") {
    return {
      action: "BUY_USDT_DIP",
      confidencePct: 85,
      actionLabel: "COMPRAR USDT EN CORTE / DIP (VENTANA DE ORO)",
      timingNotice: "Pr\xF3ximas 12-24 horas",
      rationale: "Aprovecha el freno artificial de precios producido por la inyecci\xF3n bancaria. El mercado suele rebotar con fuerza tras agotarse las divisas de la subasta.",
      actionable: true
    };
  }
  return {
    action: "AGGRESSIVE_CYCLE_VES",
    confidencePct: 80,
    actionLabel: "CICLO R\xC1PIDO DE ROTACI\xD3N (SAME-DAY CYCLE)",
    timingNotice: "Intrad\xEDa continuo",
    rationale: "Condiciones de mercado estables. Maximiza la rotaci\xF3n de capital completando ciclos de compra/venta en menos de 2 horas sin acumular saldos nocturnos en VES.",
    actionable: true
  };
}
function getBcvMarketIntelligence(parallelRate, bcvRate, now = /* @__PURE__ */ new Date()) {
  const gap = calculateBcvGap(parallelRate, bcvRate);
  const window = predictBcvIntervention(now);
  const recommendation = recommendBcvTreasuryAction(gap, window);
  return {
    gap,
    window,
    recommendation,
    timestamp: now.toISOString()
  };
}

// ../../projects/core/src/lib/heatmap-calculator.ts
var DAY_NAMES = ["Dom", "Lun", "Mar", "Mi\xE9", "Jue", "Vie", "S\xE1b"];
function computeHeatmapMatrix(ticks) {
  const cellMap = /* @__PURE__ */ new Map();
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      cellMap.set(`${d}-${h}`, {
        samples: 0,
        spreadSum: 0,
        maxSpread: Number.NEGATIVE_INFINITY,
        minSpread: Number.POSITIVE_INFINITY,
        goldenCount: 0,
        volumeSum: 0
      });
    }
  }
  let totalValidSamples = 0;
  let totalSpreadSum = 0;
  for (const tick of ticks) {
    if (!Number.isFinite(tick.timestamp) || !Number.isFinite(tick.netSpreadPct)) {
      continue;
    }
    const date = new Date(tick.timestamp);
    const day = date.getDay();
    const hour = date.getHours();
    const key = `${day}-${hour}`;
    const cell = cellMap.get(key);
    if (!cell) continue;
    cell.samples++;
    cell.spreadSum += tick.netSpreadPct;
    if (tick.netSpreadPct > cell.maxSpread) cell.maxSpread = tick.netSpreadPct;
    if (tick.netSpreadPct < cell.minSpread) cell.minSpread = tick.netSpreadPct;
    if (tick.netSpreadPct >= 0.5) cell.goldenCount++;
    if (tick.volumeUsdt && Number.isFinite(tick.volumeUsdt)) {
      cell.volumeSum += tick.volumeUsdt;
    }
    totalValidSamples++;
    totalSpreadSum += tick.netSpreadPct;
  }
  const cells = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const data = cellMap.get(`${d}-${h}`);
      const samples = data.samples;
      const avgSpread = samples > 0 ? data.spreadSum / samples : 0;
      const goldenRatio = samples > 0 ? data.goldenCount / samples : 0;
      const liquidityScore = Math.min(100, Math.round(samples * 5 + data.volumeSum / 1e3 * 2));
      const isPeak = samples >= 3 && avgSpread >= 1 && goldenRatio >= 0.7;
      cells.push({
        dayOfWeek: d,
        dayName: DAY_NAMES[d],
        hour: h,
        sampleCount: samples,
        avgNetSpreadPct: Number(avgSpread.toFixed(2)),
        maxNetSpreadPct: samples > 0 ? Number(data.maxSpread.toFixed(2)) : 0,
        minNetSpreadPct: samples > 0 ? Number(data.minSpread.toFixed(2)) : 0,
        goldenSpreadCount: data.goldenCount,
        goldenSpreadRatio: Number(goldenRatio.toFixed(2)),
        liquidityScore,
        isPeakHour: isPeak
      });
    }
  }
  const populatedCells = cells.filter((c) => c.sampleCount > 0);
  const peakHours = [...populatedCells].sort((a, b) => b.avgNetSpreadPct - a.avgNetSpreadPct).slice(0, 5);
  const deadHours = [...populatedCells].sort((a, b) => a.avgNetSpreadPct - b.avgNetSpreadPct).slice(0, 5);
  const overallAvg = totalValidSamples > 0 ? totalSpreadSum / totalValidSamples : 0;
  return {
    cells,
    peakHours,
    deadHours,
    overallAvgNetSpreadPct: Number(overallAvg.toFixed(2)),
    totalSamples: totalValidSamples
  };
}
function formatHeatmapTelegramMessage(matrix) {
  if (matrix.totalSamples === 0) {
    return `\u{1F4CA} *MAPA DE CALOR DE LIQUIDEZ Y SPREAD (24/7)*

_A\xFAn no hay suficientes ticks hist\xF3ricos registrados en el Data Lake del VPS para construir la matriz_\\.
_El servidor est\xE1 capturando datos de microestructura de forma continua cada 10s_\\.`;
  }
  let text = `\u{1F525} *MAPA DE CALOR: MEJORES HORARIOS DE ARBITRAJE*

\u2022 *Muestras Analizadas:* \`${matrix.totalSamples}\` ticks
\u2022 *Spread Neto Promedio Global:* \`${matrix.overallAvgNetSpreadPct.toFixed(2)}%\`

\u{1F3C6} *VENTANAS HORARIAS DE M\xC1XIMO RENDIMIENTO (TOP 5)*
`;
  if (matrix.peakHours.length === 0) {
    text += `_No se encontraron ventanas con m\xE1s de 3 muestras a\xFAn_\\.
`;
  } else {
    for (let i = 0; i < matrix.peakHours.length; i++) {
      const p = matrix.peakHours[i];
      const hourStr = `${String(p.hour).padStart(2, "0")}:00`;
      const nextHourStr = `${String((p.hour + 1) % 24).padStart(2, "0")}:00`;
      text += `*${i + 1}\\.* \u{1F7E2} *${p.dayName} ${hourStr}\u2013${nextHourStr}*: Spread \`${p.avgNetSpreadPct.toFixed(2)}%\` neto \\(M\xE1x \`${p.maxNetSpreadPct.toFixed(2)}%\`\\)
`;
    }
  }
  text += `
\u2744\uFE0F *HORARIOS DE BAJA LIQUIDEZ / SPREAD COMPRIMIDO*
`;
  if (matrix.deadHours.length > 0) {
    for (const d of matrix.deadHours.slice(0, 3)) {
      const hourStr = `${String(d.hour).padStart(2, "0")}:00`;
      const nextHourStr = `${String((d.hour + 1) % 24).padStart(2, "0")}:00`;
      text += `\u2022 \u{1F534} *${d.dayName} ${hourStr}\u2013${nextHourStr}*: Spread \`${d.avgNetSpreadPct.toFixed(2)}%\` neto
`;
    }
  }
  text += `
\u{1F4A1} _Consejo T\xE1ctico: Concentr\xE1 tus anuncios de venta en las ventanas verdes para acelerar la rotaci\xF3n del capital y maximizar el Sharpe Ratio diario\\._`;
  return text;
}

// ../../projects/core/src/lib/dynamic-spread-anchoring.ts
function calculateVolatilitySpreadBuffer(regime = "LOW", bcvGapPct = 0) {
  let buffer = 0;
  switch (regime) {
    case "LOW":
      buffer = 0;
      break;
    case "MEDIUM":
      buffer = 0.25;
      break;
    case "HIGH":
      buffer = 0.6;
      break;
    case "EXTREME":
      buffer = 1.2;
      break;
  }
  if (bcvGapPct >= 20) {
    buffer += 0.5;
  } else if (bcvGapPct >= 15) {
    buffer += 0.25;
  }
  return roundMoney(buffer, 2);
}
function calculateInventorySkew(currentUsdt, targetUsdt) {
  if (currentUsdt === void 0 || targetUsdt === void 0 || targetUsdt <= 0) {
    return { skew: "BALANCED", adjustmentPct: 0 };
  }
  const ratio = currentUsdt / targetUsdt;
  if (ratio > 1.25) {
    const excessPct = Math.min((ratio - 1.25) * 0.5, 0.4);
    return { skew: "HEAVY_CRYPTO", adjustmentPct: roundMoney(excessPct, 2) };
  }
  if (ratio < 0.75) {
    const deficitPct = Math.min((0.75 - ratio) * 0.5, 0.4);
    return { skew: "HEAVY_FIAT", adjustmentPct: roundMoney(deficitPct, 2) };
  }
  return { skew: "BALANCED", adjustmentPct: 0 };
}
function computeDynamicSpreadAnchors(input) {
  const {
    marketDepth,
    baseMinSpreadPct,
    strategy,
    stepVes = 0.01,
    breakEvenSellPrice,
    maxBuyPrice,
    volatilityRegime = "LOW",
    bcvGapPct = 0,
    currentInventoryUsdt,
    targetInventoryUsdt,
    bankSaturationPct = 0,
    currentBuyPrice,
    currentSellPrice,
    makerFeePct = 0.35
  } = input;
  const safetyFlags = [];
  if (bankSaturationPct >= 90) {
    safetyFlags.push("BANK_SATURATION_CRITICAL");
    return {
      action: "PAUSE",
      recommendedBuyPrice: currentBuyPrice ?? 0,
      recommendedSellPrice: currentSellPrice ?? 0,
      dynamicMinSpreadPct: baseMinSpreadPct,
      projectedGrossSpreadPct: 0,
      projectedNetSpreadPct: 0,
      spreadVes: 0,
      volatilityBufferPct: 0,
      inventorySkew: "BALANCED",
      skewAdjustmentPct: 0,
      safetyFlags,
      isSafe: false,
      reason: `Saturaci\xF3n bancaria cr\xEDtica (${bankSaturationPct.toFixed(1)}%). Operaciones pausadas para prevenir bloqueos regulatorios.`
    };
  }
  if (marketDepth.bestBuyPrice <= 0 || marketDepth.bestSellPrice <= 0) {
    safetyFlags.push("INSUFFICIENT_MARKET_DEPTH");
    return {
      action: "PAUSE",
      recommendedBuyPrice: currentBuyPrice ?? 0,
      recommendedSellPrice: currentSellPrice ?? 0,
      dynamicMinSpreadPct: baseMinSpreadPct,
      projectedGrossSpreadPct: 0,
      projectedNetSpreadPct: 0,
      spreadVes: 0,
      volatilityBufferPct: 0,
      inventorySkew: "BALANCED",
      skewAdjustmentPct: 0,
      safetyFlags,
      isSafe: false,
      reason: "Profundidad de mercado insuficiente en Binance P2P."
    };
  }
  const volatilityBuffer = calculateVolatilitySpreadBuffer(volatilityRegime, bcvGapPct);
  const { skew, adjustmentPct } = calculateInventorySkew(currentInventoryUsdt, targetInventoryUsdt);
  const dynamicMinSpreadPct = roundMoney(baseMinSpreadPct + volatilityBuffer, 2);
  let targetBuy = calculatePositionPrice(
    marketDepth.buyOffers,
    "BUY",
    strategy,
    stepVes
  );
  let targetSell = calculatePositionPrice(
    marketDepth.sellOffers,
    "SELL",
    strategy,
    stepVes
  );
  if (targetBuy <= 0) targetBuy = marketDepth.bestBuyPrice;
  if (targetSell <= 0) targetSell = marketDepth.bestSellPrice;
  if (skew === "HEAVY_CRYPTO" && adjustmentPct > 0) {
    targetSell = roundMoney(targetSell * (1 - adjustmentPct / 100), 2);
    targetBuy = roundMoney(targetBuy * (1 - adjustmentPct / 100), 2);
  } else if (skew === "HEAVY_FIAT" && adjustmentPct > 0) {
    targetBuy = roundMoney(targetBuy * (1 + adjustmentPct / 100), 2);
    targetSell = roundMoney(targetSell * (1 + adjustmentPct / 100), 2);
  }
  if (targetSell < breakEvenSellPrice) {
    safetyFlags.push("BREAK_EVEN_VIOLATION");
    targetSell = roundMoney(breakEvenSellPrice, 2);
  }
  if (maxBuyPrice && maxBuyPrice > 0 && targetBuy > maxBuyPrice) {
    safetyFlags.push("MAX_BUY_PRICE_EXCEEDED");
    targetBuy = roundMoney(maxBuyPrice, 2);
  }
  const spreadVes = roundMoney(targetSell - targetBuy, 2);
  const grossSpreadPct = targetBuy > 0 ? roundMoney(spreadVes / targetBuy * 100, 2) : 0;
  const netSpreadPct = roundMoney(grossSpreadPct - makerFeePct, 2);
  if (netSpreadPct < dynamicMinSpreadPct) {
    safetyFlags.push("SPREAD_BELOW_DYNAMIC_MINIMUM");
    return {
      action: "PAUSE",
      recommendedBuyPrice: targetBuy,
      recommendedSellPrice: targetSell,
      dynamicMinSpreadPct,
      projectedGrossSpreadPct: grossSpreadPct,
      projectedNetSpreadPct: netSpreadPct,
      spreadVes,
      volatilityBufferPct: volatilityBuffer,
      inventorySkew: skew,
      skewAdjustmentPct: adjustmentPct,
      safetyFlags,
      isSafe: false,
      reason: `Spread neto proyectado (${netSpreadPct.toFixed(2)}%) es inferior al m\xEDnimo din\xE1mico exigido (${dynamicMinSpreadPct.toFixed(2)}% con buffer de volatilidad de +${volatilityBuffer.toFixed(2)}%).`
    };
  }
  const buyChanged = currentBuyPrice !== void 0 && Math.abs(currentBuyPrice - targetBuy) >= 0.01;
  const sellChanged = currentSellPrice !== void 0 && Math.abs(currentSellPrice - targetSell) >= 0.01;
  const action = buyChanged || sellChanged || currentBuyPrice === void 0 ? "UPDATE" : "KEEP";
  return {
    action,
    recommendedBuyPrice: targetBuy,
    recommendedSellPrice: targetSell,
    dynamicMinSpreadPct,
    projectedGrossSpreadPct: grossSpreadPct,
    projectedNetSpreadPct: netSpreadPct,
    spreadVes,
    volatilityBufferPct: volatilityBuffer,
    inventorySkew: skew,
    skewAdjustmentPct: adjustmentPct,
    safetyFlags,
    isSafe: true,
    reason: action === "UPDATE" ? `Precios actualizados para estrategia ${strategy}: Compra ${targetBuy.toFixed(2)} VES / Venta ${targetSell.toFixed(2)} VES (Neto: ${netSpreadPct.toFixed(2)}%).` : "Los precios actuales de los anuncios se mantienen en la postura \xF3ptima del libro."
  };
}
function formatDynamicRepricerTelegramMessage(rec, autoModeActive) {
  const statusEmoji = autoModeActive ? "\u{1F7E2} AUT\xD3NOMO ACTIVO" : "\u{1F7E1} MANUAL / PAUSADO";
  const actionEmoji = rec.action === "UPDATE" ? "\u26A1 AJUSTE RECOMENDADO" : rec.action === "KEEP" ? "\u2705 MANTENER" : "\u{1F6D1} PAUSAR ANUNCIOS";
  const lines = [
    `\u{1F916} *MOTOR DE REPRECIO DIN\xC1MICO 24/7*`,
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
    `\u2022 *Modo de Operaci\xF3n:* \`${statusEmoji}\``,
    `\u2022 *Decisi\xF3n del Motor:* \`${actionEmoji}\``,
    `\u2022 *Compra Sugerida (BUY):* \`${rec.recommendedBuyPrice.toFixed(2)}\` VES`,
    `\u2022 *Venta Sugerida (SELL):* \`${rec.recommendedSellPrice.toFixed(2)}\` VES`,
    `\u2022 *Spread VES:* \`${rec.spreadVes.toFixed(2)}\` Bs`,
    `\u2022 *Spread Neto Estimado:* \`${rec.projectedNetSpreadPct.toFixed(2)}%\``,
    `\u2022 *Piso Spread Din\xE1mico:* \`${rec.dynamicMinSpreadPct.toFixed(2)}%\` \\(Buffer Vol: \`+${rec.volatilityBufferPct.toFixed(2)}%\`\\)`,
    `\u2022 *Sesgo de Inventario:* \`${rec.inventorySkew}\` \\(\`${rec.skewAdjustmentPct.toFixed(2)}%\`\\)`
  ];
  if (rec.safetyFlags.length > 0) {
    lines.push(`\u2022 *Banderas de Seguridad:* \`${rec.safetyFlags.join(", ")}\``);
  }
  lines.push(`
\u{1F4DD} _${rec.reason.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&")}_`);
  return lines.join("\n");
}

// ../../projects/core/src/lib/ai-proxy-gateway.ts
function normalizeSemanticPrompt(prompt) {
  if (!prompt) return "";
  let norm = prompt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿?¡!.,:;()\[\]{}"'_#+\-*\/\\|]/g, " ").trim();
  const stopWords = [
    /\b(hola|por favor|buenas|dime|cual es|como esta|que es|explicame|quiero saber)\b/g,
    /\b(hoy|ahora|actualmente|en este momento|a ver)\b/g
  ];
  for (const sw of stopWords) {
    norm = norm.replace(sw, " ");
  }
  norm = norm.replace(/\b(dolar|dolares|usd|tether)\b/g, "usdt").replace(/\b(bolivar|bolivares|bs|bsf|bss)\b/g, "ves").replace(/\b(brecha|diferencia|gap bcv)\b/g, "gap_bcv").replace(/\b(tasa oficial|bcv)\b/g, "bcv").replace(/\b(tasa paralela|paralelo|monitor)\b/g, "paralelo").replace(/\b(libro de ordenes|profundidad|orderbook)\b/g, "orderbook").replace(/\b(margen|spread|ganancia)\b/g, "spread").replace(/\s+/g, " ").trim();
  return norm;
}
var SemanticCache = class {
  entries = /* @__PURE__ */ new Map();
  maxEntries;
  defaultTtlMs;
  hits = 0;
  misses = 0;
  tokensSaved = 0;
  constructor(maxEntries = 500, defaultTtlMs = 6e4) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }
  get(prompt) {
    const key = normalizeSemanticPrompt(prompt);
    if (!key) {
      this.misses++;
      return null;
    }
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    const now = Date.now();
    if (now > entry.expiresAt) {
      this.entries.delete(key);
      this.misses++;
      return null;
    }
    entry.hitCount++;
    this.hits++;
    this.tokensSaved += entry.estimatedTokensSaved;
    return entry;
  }
  set(prompt, response, ttlMs = this.defaultTtlMs, estimatedTokens = 150) {
    const key = normalizeSemanticPrompt(prompt);
    if (!key || !response) return;
    if (this.entries.size >= this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey) this.entries.delete(firstKey);
    }
    const now = Date.now();
    const entry = {
      canonicalKey: key,
      originalPrompt: prompt,
      response,
      createdAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
      estimatedTokensSaved: estimatedTokens,
      hitCount: 0
    };
    this.entries.set(key, entry);
  }
  getStats() {
    const totalRequests = this.hits + this.misses;
    const hitRatioPct = totalRequests > 0 ? Number((this.hits / totalRequests * 100).toFixed(2)) : 0;
    return {
      totalEntries: this.entries.size,
      totalHits: this.hits,
      totalMisses: this.misses,
      hitRatioPct,
      estimatedTokensSaved: this.tokensSaved
    };
  }
  clear() {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.tokensSaved = 0;
  }
};
var AiProviderRouter = class {
  providers = [];
  cooldowns = /* @__PURE__ */ new Map();
  cooldownDurationMs = 3e4;
  constructor(providers = []) {
    this.setProviders(providers);
  }
  setProviders(providers) {
    this.providers = [...providers].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  }
  getAvailableProviders() {
    const now = Date.now();
    return this.providers.filter((p) => {
      const cd = this.cooldowns.get(p.provider) || 0;
      return now >= cd;
    });
  }
  tripProviderCooldown(provider) {
    this.cooldowns.set(provider, Date.now() + this.cooldownDurationMs);
  }
  resetCooldowns() {
    this.cooldowns.clear();
  }
  async executeWithFallback(request, callerFn) {
    const start = Date.now();
    const available = this.getAvailableProviders();
    const fallbackChain = [];
    if (available.length === 0) {
      return {
        content: "\u26A0\uFE0F No hay proveedores de IA configurados o disponibles en este momento.",
        providerUsed: "none",
        modelUsed: "none",
        cached: false,
        latencyMs: Date.now() - start
      };
    }
    for (const config of available) {
      fallbackChain.push(config.provider);
      try {
        const result = await callerFn(config, request);
        return {
          content: result,
          providerUsed: config.provider,
          modelUsed: config.model || "default",
          cached: false,
          latencyMs: Date.now() - start,
          fallbackChain: fallbackChain.length > 1 ? fallbackChain : void 0,
          tokensEstimated: Math.round((request.prompt.length + result.length) / 4)
        };
      } catch (err) {
        console.warn(`[AiProviderRouter] Fallo en proveedor ${config.provider}:`, err);
        this.tripProviderCooldown(config.provider);
      }
    }
    return {
      content: "\u274C Todos los proveedores de IA configurados fallaron en procesar la solicitud.",
      providerUsed: "none",
      modelUsed: "none",
      cached: false,
      latencyMs: Date.now() - start,
      fallbackChain
    };
  }
};

// src/data-lake.ts
import fs from "node:fs";
import path from "node:path";
var DATA_LAKE_FILE = path.resolve(process.cwd(), ".data_lake_ticks.json");
var MAX_IN_MEMORY_TICKS = 5e4;
var MicrostructureDataLake = class {
  ticks = [];
  isLoaded = false;
  constructor() {
    this.loadFromDisk();
  }
  loadFromDisk() {
    if (this.isLoaded) return;
    try {
      if (fs.existsSync(DATA_LAKE_FILE)) {
        const raw = fs.readFileSync(DATA_LAKE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.ticks = parsed;
          console.log(`[DataLake] Cargados ${this.ticks.length} ticks hist\xF3ricos de microestructura.`);
        }
      }
    } catch (err) {
      console.warn("[DataLake] Error al leer archivo del data lake:", err);
      this.ticks = [];
    }
    this.isLoaded = true;
  }
  saveToDisk() {
    try {
      if (this.ticks.length > MAX_IN_MEMORY_TICKS) {
        this.ticks = this.ticks.slice(-MAX_IN_MEMORY_TICKS);
      }
      fs.writeFileSync(DATA_LAKE_FILE, JSON.stringify(this.ticks), "utf-8");
    } catch (err) {
      console.error("[DataLake] Error al persistir ticks en disco:", err);
    }
  }
  recordTick(tick) {
    if (!Number.isFinite(tick.timestamp) || !Number.isFinite(tick.netSpreadPct)) {
      return;
    }
    this.ticks.push(tick);
    if (this.ticks.length % 10 === 0) {
      this.saveToDisk();
    }
  }
  getTicks(sinceTimestamp) {
    if (!sinceTimestamp) return [...this.ticks];
    return this.ticks.filter((t) => t.timestamp >= sinceTimestamp);
  }
  getHeatmap(daysBack = 30) {
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1e3;
    const filtered = this.getTicks(cutoff);
    return computeHeatmapMatrix(filtered);
  }
  getHeatmapTelegramText(daysBack = 30) {
    const matrix = this.getHeatmap(daysBack);
    return formatHeatmapTelegramMessage(matrix);
  }
  compact(maxDaysToKeep = 30) {
    const cutoff = Date.now() - maxDaysToKeep * 24 * 60 * 60 * 1e3;
    const initialCount = this.ticks.length;
    this.ticks = this.ticks.filter((t) => t.timestamp >= cutoff);
    this.saveToDisk();
    return initialCount - this.ticks.length;
  }
  getStats() {
    if (this.ticks.length === 0) {
      return { totalTicks: 0, oldestTickDate: null, newestTickDate: null };
    }
    const oldest = new Date(this.ticks[0].timestamp).toISOString();
    const newest = new Date(this.ticks[this.ticks.length - 1].timestamp).toISOString();
    return { totalTicks: this.ticks.length, oldestTickDate: oldest, newestTickDate: newest };
  }
};

// src/repricer-engine.ts
var RepricerEngine = class {
  state;
  minIntervalBetweenUpdatesMs;
  constructor(config = {}) {
    this.minIntervalBetweenUpdatesMs = config.minIntervalBetweenUpdatesMs ?? 6e4;
    this.state = {
      isActive: config.enabled ?? false,
      strategy: config.strategy ?? "TOP_1",
      baseMinSpreadPct: config.baseMinSpreadPct ?? 0.6,
      breakEvenSellPrice: config.breakEvenSellPrice ?? 0,
      maxBuyPrice: config.maxBuyPrice ?? 0,
      targetInventoryUsdt: config.targetInventoryUsdt ?? 2e3,
      currentInventoryUsdt: config.currentInventoryUsdt ?? 2e3,
      bankSaturationPct: config.bankSaturationPct ?? 0,
      lastDecision: null,
      lastUpdateTimestamp: 0,
      totalEvaluations: 0,
      totalUpdates: 0,
      circuitBreakerTripped: false,
      circuitTripReason: null
    };
  }
  getState() {
    return { ...this.state };
  }
  enable() {
    this.state.isActive = true;
    this.state.circuitBreakerTripped = false;
    this.state.circuitTripReason = null;
  }
  disable() {
    this.state.isActive = false;
  }
  resetCircuitBreaker() {
    this.state.circuitBreakerTripped = false;
    this.state.circuitTripReason = null;
  }
  configure(params) {
    if (params.enabled !== void 0) this.state.isActive = params.enabled;
    if (params.strategy !== void 0) this.state.strategy = params.strategy;
    if (params.baseMinSpreadPct !== void 0) this.state.baseMinSpreadPct = params.baseMinSpreadPct;
    if (params.breakEvenSellPrice !== void 0) this.state.breakEvenSellPrice = params.breakEvenSellPrice;
    if (params.maxBuyPrice !== void 0) this.state.maxBuyPrice = params.maxBuyPrice;
    if (params.targetInventoryUsdt !== void 0) this.state.targetInventoryUsdt = params.targetInventoryUsdt;
    if (params.currentInventoryUsdt !== void 0) this.state.currentInventoryUsdt = params.currentInventoryUsdt;
    if (params.bankSaturationPct !== void 0) this.state.bankSaturationPct = params.bankSaturationPct;
  }
  evaluate(marketDepth, bcvGapPct = 0, volatilityRegime = "LOW") {
    this.state.totalEvaluations++;
    const decision = computeDynamicSpreadAnchors({
      marketDepth,
      baseMinSpreadPct: this.state.baseMinSpreadPct,
      strategy: this.state.strategy,
      breakEvenSellPrice: this.state.breakEvenSellPrice,
      maxBuyPrice: this.state.maxBuyPrice > 0 ? this.state.maxBuyPrice : void 0,
      volatilityRegime,
      bcvGapPct,
      currentInventoryUsdt: this.state.currentInventoryUsdt,
      targetInventoryUsdt: this.state.targetInventoryUsdt,
      bankSaturationPct: this.state.bankSaturationPct,
      currentBuyPrice: this.state.lastDecision?.recommendedBuyPrice,
      currentSellPrice: this.state.lastDecision?.recommendedSellPrice
    });
    this.state.lastDecision = decision;
    if (!decision.isSafe && decision.safetyFlags.includes("BANK_SATURATION_CRITICAL")) {
      this.state.circuitBreakerTripped = true;
      this.state.circuitTripReason = decision.reason;
      this.state.isActive = false;
    }
    if (decision.action === "UPDATE" && this.state.isActive && !this.state.circuitBreakerTripped) {
      const now = Date.now();
      if (now - this.state.lastUpdateTimestamp >= this.minIntervalBetweenUpdatesMs) {
        this.state.lastUpdateTimestamp = now;
        this.state.totalUpdates++;
      }
    }
    return decision;
  }
  getTelegramStatusMessage() {
    if (!this.state.lastDecision) {
      return `\u{1F916} *REPRECIADOR DIN\xC1MICO 24/7*

\u2022 *Estado:* ${this.state.isActive ? "\u{1F7E2} ACTIVO" : "\u{1F534} INACTIVO"}
\u2022 *Estrategia:* \`${this.state.strategy}\`
\u2022 *Spread M\xEDnimo Base:* \`${this.state.baseMinSpreadPct.toFixed(2)}%\`
\u2022 *Evaluaciones:* \`${this.state.totalEvaluations}\`

_A\xFAn no se ha realizado ninguna evaluaci\xF3n de mercado en este ciclo\\._`;
    }
    return formatDynamicRepricerTelegramMessage(this.state.lastDecision, this.state.isActive);
  }
};

// src/ai-proxy.ts
var CloudAiProxyService = class {
  cache;
  router;
  constructor() {
    this.cache = new SemanticCache(500, 3e5);
    const providers = [];
    if (process.env["GEMINI_API_KEY"]) {
      providers.push({
        provider: "gemini",
        apiKey: process.env["GEMINI_API_KEY"].trim(),
        model: process.env["GEMINI_MODEL"]?.trim() || "gemini-2.0-flash",
        priority: 1
      });
    }
    if (process.env["OPENAI_API_KEY"]) {
      providers.push({
        provider: "openai",
        apiKey: process.env["OPENAI_API_KEY"].trim(),
        model: process.env["OPENAI_MODEL"]?.trim() || "gpt-4o-mini",
        priority: 2
      });
    }
    if (process.env["DEEPSEEK_API_KEY"]) {
      providers.push({
        provider: "deepseek",
        apiKey: process.env["DEEPSEEK_API_KEY"].trim(),
        model: process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-chat",
        priority: 3,
        baseUrl: "https://api.deepseek.com/v1"
      });
    }
    if (process.env["ANTHROPIC_API_KEY"]) {
      providers.push({
        provider: "anthropic",
        apiKey: process.env["ANTHROPIC_API_KEY"].trim(),
        model: process.env["ANTHROPIC_MODEL"]?.trim() || "claude-3-5-sonnet-20241022",
        priority: 4
      });
    }
    this.router = new AiProviderRouter(providers);
  }
  getCacheStats() {
    return this.cache.getStats();
  }
  clearCache() {
    this.cache.clear();
  }
  async ask(prompt, systemInstruction, forceRefresh = false) {
    const start = Date.now();
    if (!forceRefresh) {
      const cached = this.cache.get(prompt);
      if (cached) {
        return {
          content: cached.response,
          providerUsed: "cache",
          modelUsed: "semantic-cache",
          cached: true,
          latencyMs: Date.now() - start,
          tokensEstimated: cached.estimatedTokensSaved
        };
      }
    }
    const request = { prompt, systemInstruction };
    const response = await this.router.executeWithFallback(request, this.callProvider.bind(this));
    if (response.providerUsed !== "none" && response.content) {
      this.cache.set(prompt, response.content, 3e5, response.tokensEstimated || 150);
    }
    return response;
  }
  async callProvider(config, req) {
    const system = req.systemInstruction || "Eres Gentleman AI, un asistente de arbitraje financiero P2P.";
    switch (config.provider) {
      case "gemini": {
        const model = config.model || "gemini-2.0-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${system}

Pregunta: ${req.prompt}` }] }]
          })
        });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "No se obtuvo respuesta del modelo Gemini.";
      }
      case "openai":
      case "deepseek": {
        const baseUrl = config.baseUrl || "https://api.openai.com/v1";
        const model = config.model || (config.provider === "openai" ? "gpt-4o-mini" : "deepseek-chat");
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: req.prompt }
            ],
            temperature: 0.2
          })
        });
        if (!res.ok) throw new Error(`${config.provider} HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || `No se obtuvo respuesta del modelo ${config.provider}.`;
      }
      case "anthropic": {
        const model = config.model || "claude-3-5-sonnet-20241022";
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model,
            system,
            messages: [{ role: "user", content: req.prompt }],
            max_tokens: 1e3
          })
        });
        if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return data.content?.[0]?.text || "No se obtuvo respuesta del modelo Claude.";
      }
      default:
        throw new Error(`Proveedor ${config.provider} no soportado.`);
    }
  }
};

// src/index.ts
var BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"]?.trim() || "";
var AUTHORIZED_CHAT_ID = process.env["TELEGRAM_CHAT_ID"]?.trim() || "";
var COTIZAVE_API_KEY = process.env["COTIZAVE_API_KEY"]?.trim() || "";
var POLL_INTERVAL_MS = Number(process.env["POLL_INTERVAL_MS"]) || 2e3;
var ALPHA_SCAN_INTERVAL_SEC = Number(process.env["ALPHA_SCAN_INTERVAL_SEC"]) || 15;
var MIN_NET_SPREAD_PCT = Number(process.env["MIN_NET_SPREAD_PCT"]) || 1;
var HTTP_PORT = Number(process.env["PORT"]) || 3e3;
var OFFSET_FILE = path2.resolve(process.cwd(), ".telegram_offset");
function loadStoredOffset() {
  try {
    if (fs2.existsSync(OFFSET_FILE)) {
      const data = fs2.readFileSync(OFFSET_FILE, "utf-8").trim();
      const num = Number(data);
      if (!Number.isNaN(num) && num > 0) return num;
    }
  } catch {
  }
  return 0;
}
function saveStoredOffset(offset) {
  try {
    fs2.writeFileSync(OFFSET_FILE, String(offset), "utf-8");
  } catch {
  }
}
var dataLake = new MicrostructureDataLake();
var repricerEngine = new RepricerEngine({
  enabled: process.env["AUTOREPRICE_ENABLED"] === "true",
  baseMinSpreadPct: Number(process.env["AUTOREPRICE_MIN_SPREAD_PCT"]) || 0.6,
  breakEvenSellPrice: Number(process.env["AUTOREPRICE_BREAKEVEN_PRICE"]) || 0
});
var aiProxy = new CloudAiProxyService();
async function fetchBinanceSide(tradeType, asset = "USDT", fiat = "VES", payTypes = ["Banesco", "PagoMovil", "Mercantil"]) {
  try {
    const res = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (P2P-Decisor-Cloud-Sentinel/2.0)"
      },
      body: JSON.stringify({
        asset,
        fiat,
        tradeType,
        page: 1,
        rows: 20,
        payTypes,
        publisherType: null
      })
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.data || !Array.isArray(json.data)) return [];
    return json.data.map((item) => {
      const adv = item.adv;
      const advr = item.advertiser;
      return {
        advNo: String(adv["advNo"] || ""),
        price: Number(adv["price"]) || 0,
        surplusAmount: Number(adv["surplusAmount"]) || 0,
        minSingleTransAmount: Number(adv["minSingleTransAmount"]) || 0,
        maxSingleTransAmount: Number(adv["maxSingleTransAmount"]) || 0,
        tradeType,
        asset,
        fiatUnit: fiat,
        payMethods: Array.isArray(adv["tradeMethods"]) ? adv["tradeMethods"].map((m) => m.tradeMethodName || m.identifier) : [],
        merchantName: String(advr["nickName"] || "An\xF3nimo"),
        merchantOrders: Number(advr["monthOrderCount"]) || 0,
        merchantFinishRate: (Number(advr["monthFinishRate"]) || 0) * 100,
        isMerchant: advr["userType"] === "merchant"
      };
    });
  } catch (err) {
    console.error(`[Daemon] Error fetching Binance ${tradeType}:`, err);
    return [];
  }
}
async function fetchLiveMarketDepth() {
  try {
    const [buyOffers, sellOffers] = await Promise.all([
      fetchBinanceSide("BUY"),
      fetchBinanceSide("SELL")
    ]);
    if (buyOffers.length === 0 && sellOffers.length === 0) return null;
    return computeMarketDepth(buyOffers, sellOffers);
  } catch {
    return null;
  }
}
async function fetchCotizaveRates() {
  if (!COTIZAVE_API_KEY) return null;
  try {
    const res = await fetch("https://api.cotizave.com/v1/fx/rates", {
      headers: {
        "X-API-Key": COTIZAVE_API_KEY,
        Accept: "application/json"
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
async function sendTelegramMessage(token, chatId, text, replyMarkup) {
  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2"
    };
    if (replyMarkup) {
      payload["reply_markup"] = replyMarkup;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (err) {
    console.error("[Daemon] Error sending Telegram message:", err);
    return false;
  }
}
var isRunning = true;
var currentOffset = loadStoredOffset();
var isKillswitchActive = false;
var lastAlertTimestamp = 0;
console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
console.log("  P2P DECISOR \u2014 TELEGRAM SENTINEL 2.0 & DATA LAKE CLOUD DAEMON");
console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
console.log(`  Bot Token Configurado:  ${BOT_TOKEN ? "S\xCD (" + BOT_TOKEN.slice(0, 8) + "...)" : "NO"}`);
console.log(`  Chat ID Autorizado:     ${AUTHORIZED_CHAT_ID || "TODOS (No restringido)"}`);
console.log(`  CotizaVe API Key:       ${COTIZAVE_API_KEY ? "S\xCD" : "NO"}`);
console.log(`  Data Lake Activo:       ${dataLake.getStats().totalTicks} ticks en memoria`);
console.log(`  Repreciador Aut\xF3nomo:   ${repricerEngine.getState().isActive ? "ACTIVO" : "INACTIVO"}`);
console.log(`  HTTP API Port:          ${HTTP_PORT}`);
console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
if (!BOT_TOKEN) {
  console.error("[Daemon] FATAL: TELEGRAM_BOT_TOKEN no est\xE1 definido en el archivo .env o variables de entorno.");
  process.exit(1);
}
async function handleUpdate(update) {
  const chat = update.message?.chat || update.callback_query?.message?.chat;
  const chatId = chat?.id || AUTHORIZED_CHAT_ID;
  if (!chatId) return;
  const dispatch = dispatchTelegramUpdate(update, AUTHORIZED_CHAT_ID);
  if (!dispatch.authorized) {
    await sendTelegramMessage(BOT_TOKEN, chatId, dispatch.responseMarkdown);
    console.warn(`[Daemon] Intento de acceso no autorizado desde Chat ID ${chatId}`);
    return;
  }
  console.log(`[Daemon] Comando recibido: action=${dispatch.action}, rawText="${update.message?.text || update.callback_query?.data || ""}"`);
  switch (dispatch.action) {
    case "KILLSWITCH": {
      isKillswitchActive = true;
      repricerEngine.disable();
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `\u{1F6A8} *KILLSWITCH EJECUTADO EN EL SERVIDOR VPS*

Todos los procesos de monitoreo y alertas autom\xE1ticas fueron pausados inmediatamente\\.`
      );
      break;
    }
    case "RESUME": {
      isKillswitchActive = false;
      repricerEngine.resetCircuitBreaker();
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `\u2705 *CENTINELA REANUDADO EN EL SERVIDOR VPS*

El monitoreo continuo de arbitraje y tasas en vivo est\xE1 activo nuevamente\\.`
      );
      break;
    }
    case "STATUS": {
      const depth = await fetchLiveMarketDepth();
      const bcvRates = await fetchCotizaveRates();
      const bcvRate = bcvRates?.rates?.bcv?.price || 0;
      const parallelRate = depth?.bestBuyPrice || bcvRates?.rates?.parallel?.price || 0;
      const spreadPct = depth?.grossSpreadPct || 0;
      const stats = dataLake.getStats();
      const repricerState = repricerEngine.getState();
      const statusText = `\u{1F4E1} *ESTADO DEL CENTINELA VPS 24/7*

\u2022 *Servidor:* Linux Cloud VPS
\u2022 *Estado Centinela:* ${isKillswitchActive ? "\u{1F534} PAUSADO (Kill-Switch)" : "\u{1F7E2} OPERATIVO Y MONITOREANDO"}
\u2022 *Repreciador 24/7:* ${repricerState.isActive ? "\u{1F7E2} ACTIVO" : "\u26AA INACTIVO"}
\u2022 *Binance P2P Buy:* \`${depth?.bestBuyPrice?.toFixed(2) || "N/D"}\` VES
\u2022 *Binance P2P Sell:* \`${depth?.bestSellPrice?.toFixed(2) || "N/D"}\` VES
\u2022 *Spread Bruto:* \`${spreadPct.toFixed(2)}%\`
\u2022 *Tasa Oficial BCV:* \`${bcvRate ? bcvRate.toFixed(2) : "N/D"}\` VES
\u2022 *Data Lake:* \`${stats.totalTicks}\` ticks capturados

_Escrib\xED /heatmap para ver horarios de arbitraje o /autoreprice para gestionar el reprecio aut\xF3nomo\\._`;
      await sendTelegramMessage(BOT_TOKEN, chatId, statusText, buildSentinelReplyKeyboard());
      break;
    }
    case "AUTOREPRICE_ON": {
      repricerEngine.enable();
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `\u{1F7E2} *REPRECIO DIN\xC1MICO AUT\xD3NOMO 24/7 ACTIVADO*

El servidor ajustar\xE1 autom\xE1ticamente las posturas en el libro de \xF3rdenes respetando los pisos de seguridad y buffers de volatilidad\\.`
      );
      break;
    }
    case "AUTOREPRICE_OFF": {
      repricerEngine.disable();
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `\u23F8\uFE0F *REPRECIO DIN\xC1MICO AUT\xD3NOMO PAUSADO*

Las posturas ya no se actualizar\xE1n autom\xE1ticamente\\.`
      );
      break;
    }
    case "AUTOREPRICE_CONFIG": {
      const params = dispatch.params;
      repricerEngine.configure({
        strategy: params?.strategy,
        baseMinSpreadPct: params?.minSpread
      });
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `\u2699\uFE0F *CONFIGURACI\xD3N DE REPRECIO ACTUALIZADA*

\u2022 Estrategia: \`${params?.strategy || "TOP_1"}\`
\u2022 Spread M\xEDnimo: \`${(params?.minSpread || 0.6).toFixed(2)}%\``
      );
      break;
    }
    case "AUTOREPRICE_STATUS": {
      const depth = await fetchLiveMarketDepth();
      const bcvRates = await fetchCotizaveRates();
      const bcvRate = bcvRates?.rates?.bcv?.price || 0;
      const parallelRate = depth?.bestBuyPrice || 0;
      const bcvGapPct = bcvRate > 0 && parallelRate > 0 ? (parallelRate - bcvRate) / bcvRate * 100 : 0;
      if (depth) {
        repricerEngine.evaluate(depth, bcvGapPct, "LOW");
      }
      const msg = repricerEngine.getTelegramStatusMessage();
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }
    case "HEATMAP": {
      const msg = dataLake.getHeatmapTelegramText(30);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }
    case "BCV_INTELLIGENCE": {
      const depth = await fetchLiveMarketDepth();
      const bcvRates = await fetchCotizaveRates();
      const bcvRate = bcvRates?.rates?.bcv?.price || 0;
      const parallelRate = depth?.bestBuyPrice || bcvRates?.rates?.parallel?.price || 0;
      const intel = getBcvMarketIntelligence(bcvRate, parallelRate, /* @__PURE__ */ new Date());
      const msg = formatBcvIntelligenceTelegramMessage(intel, /* @__PURE__ */ new Date());
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }
    case "RADAR_SCAN": {
      const depth = await fetchLiveMarketDepth();
      if (!depth) {
        await sendTelegramMessage(BOT_TOKEN, chatId, "\u26A0\uFE0F *No se pudo obtener el libro de \xF3rdenes en vivo de Binance P2P*\\. Reintent\xE1 en unos segundos\\.");
        break;
      }
      const params = dispatch.params || {
        filterBank: "TODOS",
        ticketAmount: 1e3,
        isCustomTicket: false
      };
      const rows = [
        {
          paymentMethod: "Banesco",
          buyPrice: depth.bestBuyPrice,
          sellPrice: depth.bestSellPrice,
          grossSpreadPct: depth.grossSpreadPct,
          netSpreadPct: depth.grossSpreadPct - 0.35,
          recommendedAction: depth.grossSpreadPct - 0.35 >= 0.5 ? "OPERAR" : "ESPERAR",
          minTicket: 50,
          maxTicket: 2500
        }
      ];
      const msg = formatRadarTelegramMessage(rows, params);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }
    case "RADAR_ALTA_DEMANDA": {
      const buyOffers = await fetchBinanceSide("BUY");
      const sellOffers = await fetchBinanceSide("SELL");
      const scan = computeHighDemandScan(buyOffers, sellOffers);
      const params = dispatch.params || {
        filterBank: "TODOS",
        tierUsdt: 1e3,
        showAllTiers: true
      };
      const msg = formatRadarAltaDemandaTelegramMessage(scan, params);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }
    case "MACRO_INTEL": {
      const depth = await fetchLiveMarketDepth();
      const bcvRates = await fetchCotizaveRates();
      const bcvRate = bcvRates?.rates?.bcv?.price || 0;
      const parallelRate = depth?.bestBuyPrice || bcvRates?.rates?.parallel?.price || 0;
      const snapshot = {
        bcvRate,
        parallelRate,
        gapPct: bcvRate > 0 ? (parallelRate - bcvRate) / bcvRate * 100 : 0,
        riskZone: "MODERADO",
        volatilityTrend: "ESTABLE",
        liquidityWindow: "ABIERTA",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      const msg = formatMacroTelegramMessage(snapshot);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }
    default: {
      const raw = (update.message?.text || "").trim();
      if (raw.startsWith("/ask ") || raw.startsWith("/ai ") || raw.startsWith("/ia ")) {
        const query = raw.replace(/^\/(ask|ai|ia)\s+/i, "").trim();
        if (query) {
          await sendTelegramMessage(BOT_TOKEN, chatId, `\u{1F9E0} *CONSULTANDO A GENTLEMAN AI*\\.\\.\\.`);
          try {
            const answer = await aiProxy.ask(query);
            const badge = answer.cached ? `\u26A1 _Respuesta servida desde Cach\xE9 Sem\xE1ntico_` : `\u{1F916} _Respuesta v\xEDa ${answer.providerUsed} (${answer.latencyMs}ms)_`;
            const text = `\u{1F4A1} *GENTLEMAN AI*

${escapeMarkdownV2(answer.content)}

${escapeMarkdownV2(badge)}`;
            await sendTelegramMessage(BOT_TOKEN, chatId, text);
          } catch (err) {
            await sendTelegramMessage(BOT_TOKEN, chatId, `\u274C *Error al consultar IA:* ${escapeMarkdownV2(err?.message || "Fallo desconocido")}`);
          }
          break;
        }
      }
      if (dispatch.responseMarkdown) {
        await sendTelegramMessage(BOT_TOKEN, chatId, dispatch.responseMarkdown);
      }
      break;
    }
  }
}
async function startPolling() {
  console.log("[Daemon] Iniciando bucle de Long-Polling con Telegram Bot API...");
  while (isRunning) {
    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${currentOffset}&timeout=20`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[Daemon] Telegram HTTP ${res.status}. Reintentando en 5s...`);
        await new Promise((r) => setTimeout(r, 5e3));
        continue;
      }
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          currentOffset = Math.max(currentOffset, update.update_id + 1);
          saveStoredOffset(currentOffset);
          await handleUpdate(update);
        }
      }
    } catch (err) {
      console.error("[Daemon] Error en loop de polling:", err);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}
async function startAlphaWatcher() {
  console.log(`[Daemon] Iniciando Data Lake Ingestion y Alpha Watcher (${ALPHA_SCAN_INTERVAL_SEC}s)...`);
  while (isRunning) {
    await new Promise((r) => setTimeout(r, ALPHA_SCAN_INTERVAL_SEC * 1e3));
    try {
      const depth = await fetchLiveMarketDepth();
      if (!depth) continue;
      const netSpread = depth.grossSpreadPct - 0.35;
      const now = Date.now();
      dataLake.recordTick({
        timestamp: now,
        buyPrice: depth.bestBuyPrice,
        sellPrice: depth.bestSellPrice,
        grossSpreadPct: depth.grossSpreadPct,
        netSpreadPct: netSpread,
        volumeUsdt: depth.totalBuyVolumeUsdt + depth.totalSellVolumeUsdt
      });
      if (repricerEngine.getState().isActive && !isKillswitchActive) {
        const bcvRates = await fetchCotizaveRates();
        const bcvRate = bcvRates?.rates?.bcv?.price || 0;
        const bcvGapPct = bcvRate > 0 ? (depth.bestBuyPrice - bcvRate) / bcvRate * 100 : 0;
        const decision = repricerEngine.evaluate(depth, bcvGapPct, "LOW");
        if (repricerEngine.getState().circuitBreakerTripped && AUTHORIZED_CHAT_ID) {
          const tripMsg = `\u{1F6A8} *CIRCUIT BREAKER ACTIVADO EN REPRECIADOR 24/7*

El motor paus\xF3 autom\xE1ticamente las operaciones debido a:
_${escapeMarkdownV2(decision.reason)}_`;
          await sendTelegramMessage(BOT_TOKEN, AUTHORIZED_CHAT_ID, tripMsg);
          console.warn(`[Daemon] Repricer Circuit Breaker activado: ${decision.reason}`);
        }
      }
      if (isKillswitchActive || !AUTHORIZED_CHAT_ID) continue;
      if (netSpread >= MIN_NET_SPREAD_PCT && now - lastAlertTimestamp > 6e5) {
        lastAlertTimestamp = now;
        const alertMsg = `\u26A1 *OPORTUNIDAD DE ARBITRAJE DETECTADA POR CENTINELA VPS*

\u2022 *Spread Neto Estimado:* \`${netSpread.toFixed(2)}%\` \\(Regla de Oro \\>= ${MIN_NET_SPREAD_PCT.toFixed(2)}%\\)
\u2022 *Compra (BUY):* \`${depth.bestBuyPrice.toFixed(2)}\` VES
\u2022 *Venta (SELL):* \`${depth.bestSellPrice.toFixed(2)}\` VES
\u2022 *Ruta:* Banesco / Pago M\xF3vil

_Envi\xE1 /heatmap para consultar la estacionalidad horaria o /status para libros en vivo\\._`;
        await sendTelegramMessage(BOT_TOKEN, AUTHORIZED_CHAT_ID, alertMsg);
        console.log(`[Daemon] Alerta proactiva enviada: Spread Neto ${netSpread.toFixed(2)}%`);
      }
    } catch (err) {
      console.error("[Daemon] Error en ciclo de Alpha Watcher:", err);
    }
  }
}
function startHttpServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime(), isKillswitchActive }));
      return;
    }
    if (url.pathname === "/api/market/heatmap") {
      const days = Number(url.searchParams.get("days")) || 30;
      const heatmap = dataLake.getHeatmap(days);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(heatmap));
      return;
    }
    if (url.pathname === "/api/market/stats") {
      const stats = dataLake.getStats();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stats));
      return;
    }
    if (url.pathname === "/api/repricer/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(repricerEngine.getState()));
      return;
    }
    if (url.pathname === "/api/repricer/toggle" && req.method === "POST") {
      if (repricerEngine.getState().isActive) {
        repricerEngine.disable();
      } else {
        repricerEngine.enable();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(repricerEngine.getState()));
      return;
    }
    if (url.pathname === "/api/ai/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(aiProxy.getCacheStats()));
      return;
    }
    if (url.pathname === "/api/ai/cache/clear" && req.method === "POST") {
      aiProxy.clearCache();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", message: "Cach\xE9 sem\xE1ntico limpiado exitosamente." }));
      return;
    }
    if (url.pathname === "/api/ai/chat" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          if (!parsed.prompt) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: 'El campo "prompt" es obligatorio.' }));
            return;
          }
          const response = await aiProxy.ask(
            parsed.prompt,
            parsed.systemInstruction,
            Boolean(parsed.forceRefresh)
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err?.message || "Error interno en AI Proxy" }));
        }
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Endpoint no encontrado" }));
  });
  server.listen(HTTP_PORT, () => {
    console.log(`[Daemon] HTTP REST API activo en puerto ${HTTP_PORT}`);
  });
}
function shutdown(signal) {
  console.log(`
[Daemon] Recibida se\xF1al ${signal}. Deteniendo servicios de forma segura...`);
  isRunning = false;
  saveStoredOffset(currentOffset);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
startHttpServer();
void startPolling();
void startAlphaWatcher();
