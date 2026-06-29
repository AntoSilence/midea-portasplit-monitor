const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SETTINGS = {
  maxPrice: 1100,
  timezone: 'Europe/Paris',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID
};

const DOCS_DIR = path.join(__dirname, 'docs');
const STATUS_FILE = path.join(DOCS_DIR, 'status.json');
const STATE_FILE = path.join(__dirname, 'state.json');

const SITES = [
  {
    name: 'Boulanger',
    url: 'https://www.boulanger.com/ref/1216685',
    strictSeller: false,
    trustedSellerWords: ['boulanger', 'midea', 'optimea']
  },
  {
    name: 'Amazon',
    url: 'https://www.amazon.fr/Climatiseur-Climatisation-rafra%C3%AEchisseur-d%C3%A9shumidificateur-ventilateur/dp/B0CY2YW8BT',
    strictSeller: true,
    trustedSellerWords: ['vendu par amazon', 'expédié par amazon', 'expedie par amazon', 'amazon.fr']
  },
  {
    name: 'Darty',
    url: 'https://www.darty.com/nav/achat/gros_electromenager/chauffage_climatisation/climatiseur/midea_mmcs-12hrn8-qrd0.html',
    strictSeller: false,
    trustedSellerWords: ['darty', 'midea']
  },
  {
    name: 'ManoMano',
    url: 'https://www.manomano.fr/p/midea-climatiseur-split-mobile-reversible-froid-chaud-3500w12000btu-wifi-deshumidificateur-ventilateur-jusqua-40m2-kit-fenetre-inclus-83810402',
    strictSeller: true,
    trustedSellerWords: ['manomano', 'midea', 'optimea']
  },
  {
    name: 'Leroy Merlin',
    url: 'https://www.leroymerlin.fr/produits/climatiseur-split-mobile-reversible-portasplit-midea-par-optimea-93857579.html',
    strictSeller: true,
    trustedSellerWords: ['leroy merlin', 'midea', 'optimea']
  },
  {
    name: 'Castorama',
    url: 'https://www.castorama.fr/climatiseur-portasplit-midea-reversible-3500w/8431312260509_CAFR.prd',
    strictSeller: true,
    trustedSellerWords: ['castorama', 'midea']
  },
  {
    name: 'Bricoman',
    url: 'https://www.bricoman.fr/produits/climatiseur-mobile-reversible-portasplit-midea-25088072.html',
    strictSeller: false,
    trustedSellerWords: ['bricoman', 'midea']
  }
];

const UNAVAILABLE_WORDS = [
  'actuellement indisponible',
  'temporairement indisponible',
  'non disponible',
  'indisponible',
  'rupture de stock',
  'rupture',
  'épuisé',
  'epuise',
  'plus disponible',
  'bientôt disponible',
  'bientot disponible',
  'me prévenir',
  'me prevenir',
  'm’avertir',
  'm avertir',
  'alerte disponibilité',
  'alerte disponibilite',
  'stock : 0',
  'stock: 0',
  'sold out',
  'currently unavailable'
];

const DELIVERY_POSITIVE_WORDS = [
  'livraison disponible',
  'livraison à domicile disponible',
  'livraison a domicile disponible',
  'disponible en livraison',
  'livrable',
  'expédition disponible',
  'expedition disponible'
];

const PICKUP_POSITIVE_WORDS = [
  'retrait disponible',
  'retrait magasin disponible',
  'disponible en magasin',
  'click and collect disponible',
  'click & collect disponible',
  'drive disponible'
];

const IDF_WORDS = [
  'ile-de-france',
  'île-de-france',
  'paris',
  'seine-et-marne',
  'yvelines',
  'essonne',
  'hauts-de-seine',
  'seine-saint-denis',
  'val-de-marne',
  'val-d’oise',
  "val-d'oise",
  'val d’oise',
  "val d'oise",
  'boulogne',
  'nanterre',
  'créteil',
  'creteil',
  'versailles',
  'évry',
  'evry',
  'pontoise',
  'bobigny',
  'melun',
  'cergy',
  'saint-denis',
  'place de clichy'
];

async function main() {
  ensureDirectory(DOCS_DIR);

  const state = readJson(STATE_FILE, { sites: {} });

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox'
    ]
  });

  const context = await browser.newContext({
    locale: 'fr-FR',
    timezoneId: SETTINGS.timezone,
    viewport: { width: 1365, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  const results = [];

  for (const site of SITES) {
    const page = await context.newPage();

    let result;

    try {
      result = await checkSite(page, site);
    } catch (error) {
      result = makeResult(site, 'CHECK_MANUAL', '🟠 À vérifier manuellement', null, `Erreur technique : ${error.message}`);
    } finally {
      await page.close().catch(() => {});
    }

    result.checkedAt = new Date().toISOString();

    const previous = state.sites[site.name] || {
      lastAvailable: false,
      lastAlertAt: null
    };

    result.alertSent = false;
    result.alertError = null;

    if (result.code === 'AVAILABLE_OK') {
      if (previous.lastAvailable !== true) {
        try {
          await sendTelegramAlert(result);
          result.alertSent = true;

          state.sites[site.name] = {
            lastAvailable: true,
            lastAlertAt: new Date().toISOString(),
            lastStatus: result.code
          };
        } catch (error) {
          result.alertError = error.message;

          state.sites[site.name] = {
            lastAvailable: false,
            lastAlertAt: previous.lastAlertAt || null,
            lastStatus: result.code
          };
        }
      } else {
        state.sites[site.name] = {
          lastAvailable: true,
          lastAlertAt: previous.lastAlertAt || null,
          lastStatus: result.code
        };
      }
    } else if (result.code === 'UNAVAILABLE' || result.code === 'REJECTED') {
      state.sites[site.name] = {
        lastAvailable: false,
        lastAlertAt: previous.lastAlertAt || null,
        lastStatus: result.code
      };
    } else {
      state.sites[site.name] = {
        lastAvailable: previous.lastAvailable === true,
        lastAlertAt: previous.lastAlertAt || null,
        lastStatus: result.code
      };
    }

    result.lastKnownAvailable = state.sites[site.name].lastAvailable;
    result.lastAlertAt = state.sites[site.name].lastAlertAt;

    console.log(`${site.name} => ${result.status} / ${result.detail}`);
    results.push(result);
  }

  await browser.close();

  const status = {
    generatedAt: new Date().toISOString(),
    maxPrice: SETTINGS.maxPrice,
    results
  };

  writeJson(STATUS_FILE, status);
  writeJson(STATE_FILE, state);
}

async function checkSite(page, site) {
  console.log(`Checking ${site.name}`);

  const response = await page.goto(site.url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  const httpStatus = response ? response.status() : null;

  if (httpStatus && httpStatus >= 400) {
    return makeResult(site, 'CHECK_MANUAL', '🟠 À vérifier manuellement', null, `HTTP ${httpStatus} : page bloquée ou inaccessible.`);
  }

  await acceptCookies(page);

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const rawText = await page.locator('body').innerText({ timeout: 15000 });
  const text = normalizeText(rawText);

  if (!text || text.length < 500) {
    return makeResult(site, 'CHECK_MANUAL', '🟠 À vérifier manuellement', null, 'Page vide ou texte trop court.');
  }

  const price = extractPrice(text);

  if (site.name === 'Castorama') {
    return analyseCastorama(site, text, price);
  }

  return analyseGeneric(site, text, price);
}

async function acceptCookies(page) {
  const buttonNames = [
    'Tout accepter',
    'Accepter',
    'J’accepte',
    "J'accepte",
    'Accepter et fermer',
    'OK',
    'Accept all',
    'I agree'
  ];

  for (const name of buttonNames) {
    try {
      await page.getByRole('button', { name: new RegExp(name, 'i') }).first().click({ timeout: 1500 });
      await page.waitForTimeout(500);
      return;
    } catch (_) {
      // bouton absent : on continue
    }
  }
}

function analyseCastorama(site, text, price) {
  const stockZero =
    /stock\s*:\s*0\s*pi[eè]ce/.test(text) ||
    /stock\s*:\s*0\s*pièces/.test(text) ||
    /stock\s*:\s*0\s*pieces/.test(text);

  const deliveryUnavailable =
    /livraison.{0,120}non disponible/.test(text) ||
    /livraison à domicile.{0,120}non disponible/.test(text) ||
    /livraison a domicile.{0,120}non disponible/.test(text);

  const pickupUnavailable =
    /en magasin.{0,180}non disponible/.test(text) ||
    /retrait.{0,180}non disponible/.test(text);

  if (stockZero || deliveryUnavailable || pickupUnavailable) {
    return makeResult(
      site,
      'UNAVAILABLE',
      '🔴 Indisponible',
      price,
      'Castorama : stock, livraison ou magasin explicitement non disponible.'
    );
  }

  const stockPositive =
    /stock\s*:\s*[1-9]\d*\s*pi[eè]ce/.test(text) ||
    /stock\s*:\s*[1-9]\d*\s*pièces/.test(text) ||
    /stock\s*:\s*[1-9]\d*\s*pieces/.test(text);

  const deliveryAvailable = hasCleanPositive(text, DELIVERY_POSITIVE_WORDS);
  const pickupAvailableInIdf = hasCleanPositive(text, PICKUP_POSITIVE_WORDS) && includesAny(text, IDF_WORDS);

  if (!stockPositive && !deliveryAvailable && !pickupAvailableInIdf) {
    return makeResult(
      site,
      'CHECK_MANUAL',
      '🟠 À vérifier manuellement',
      price,
      'Castorama : aucun signal positif fiable de disponibilité.'
    );
  }

  return finalizeAvailability(site, text, price, 'Castorama : disponibilité positive détectée.');
}

function analyseGeneric(site, text, price) {
  const hardUnavailable = includesAny(text, UNAVAILABLE_WORDS);

  const deliveryAvailable = hasCleanPositive(text, DELIVERY_POSITIVE_WORDS);
  const pickupAvailableInIdf = hasCleanPositive(text, PICKUP_POSITIVE_WORDS) && includesAny(text, IDF_WORDS);
  const stockPositive = hasPositiveStock(text);

  const positiveSignal = deliveryAvailable || pickupAvailableInIdf || stockPositive;

  if (hardUnavailable && !positiveSignal) {
    return makeResult(
      site,
      'UNAVAILABLE',
      '🔴 Indisponible',
      price,
      'Indisponibilité détectée.'
    );
  }

  if (!positiveSignal) {
    return makeResult(
      site,
      'CHECK_MANUAL',
      '🟠 À vérifier manuellement',
      price,
      'Aucun signal positif fiable de disponibilité.'
    );
  }

  return finalizeAvailability(site, text, price, 'Disponibilité positive détectée.');
}

function finalizeAvailability(site, text, price, baseDetail) {
  if (price === null) {
    return makeResult(
      site,
      'CHECK_MANUAL',
      '🟠 À vérifier manuellement',
      null,
      `${baseDetail} Prix non détecté.`
    );
  }

  if (price > SETTINGS.maxPrice) {
    return makeResult(
      site,
      'REJECTED',
      '⚪ Prix trop élevé',
      price,
      `Prix détecté supérieur à ${SETTINGS.maxPrice} €.`
    );
  }

  if (site.strictSeller && !includesAny(text, site.trustedSellerWords)) {
    return makeResult(
      site,
      'REJECTED',
      '⚪ Vendeur non retenu',
      price,
      'Vendeur fiable non confirmé automatiquement.'
    );
  }

  return makeResult(
    site,
    'AVAILABLE_OK',
    '🟢 Disponible sous 1 100 €',
    price,
    baseDetail
  );
}

function makeResult(site, code, status, price, detail) {
  return {
    site: site.name,
    url: site.url,
    code,
    status,
    price,
    priceText: price === null ? '—' : formatPrice(price),
    detail
  };
}

function hasPositiveStock(text) {
  if (/stock\s*:\s*[1-9]\d*/.test(text)) {
    return true;
  }

  if (/\b[1-9]\d*\s*pi[eè]ces?\s+disponibles?\b/.test(text)) {
    return true;
  }

  if (text.includes('en stock') && !text.includes('me prévenir') && !text.includes('me prevenir')) {
    return true;
  }

  return false;
}

function hasCleanPositive(text, phrases) {
  for (const phrase of phrases) {
    const index = text.indexOf(phrase);

    if (index === -1) {
      continue;
    }

    const before = text.slice(Math.max(0, index - 80), index + phrase.length + 80);

    if (
      !before.includes('non disponible') &&
      !before.includes('indisponible') &&
      !before.includes('rupture')
    ) {
      return true;
    }
  }

  return false;
}

function includesAny(text, words) {
  return words.some(word => text.includes(word.toLowerCase()));
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function extractPrice(text) {
  const regex = /(\d{1,3}(?:[\s\u00A0]\d{3})*|\d{3,4})(?:[,.](\d{2}))?\s*€/g;
  const prices = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const euros = match[1].replace(/[\s\u00A0]/g, '');
    const cents = match[2] || '00';
    const price = Number(`${euros}.${cents}`);

    if (price >= 250 && price <= 2000) {
      prices.push(price);
    }
  }

  if (prices.length === 0) {
    return null;
  }

  return Math.min(...prices);
}

function formatPrice(price) {
  return `${Number(price).toFixed(2).replace('.', ',')} €`;
}

async function sendTelegramAlert(result) {
  if (!SETTINGS.telegramBotToken || !SETTINGS.telegramChatId) {
    throw new Error('Secrets Telegram manquants.');
  }

  const text =
    `Midea PortaSplit disponible chez ${result.site} — Prix : ${result.priceText} — ${result.url}`;

  const url = `https://api.telegram.org/bot${SETTINGS.telegramBotToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: SETTINGS.telegramChatId,
      text,
      disable_web_page_preview: false
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram HTTP ${response.status} : ${body}`);
  }
}

function ensureDirectory(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
