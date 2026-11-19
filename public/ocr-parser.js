/**
 * ============================================================================
 * AIMEX MULTI-COURIER AUSTRALIAN TRACKING SLIP PARSER + CERTAINTY SCORING
 * ============================================================================
 * Extracts:
 *   - customerName + customerNameCertainty (0-100)
 *   - trackingNumber + trackingNumberCertainty (0-100)
 *   - orderDate (YYYY-MM-DD if printed on label, otherwise '')
 *
 * Supports: CouriersPlease (Standard & Amazon), Australia Post / eParcel,
 * StarTrack, Aramex / Fastway, Team Global Express / Toll, Sendle, TNT,
 * FedEx, DHL Express & eCommerce, Direct Freight, Allied Express, Hunter, Border.
 *
 * Works in Browser (`window.AimexLabelParser`) and Node.js (`module.exports`).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AimexLabelParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

  const SENDER_KEYWORDS = [
    /\ba[i1l]mex\b/i,
    /m[ceoa]?cred[i1l]e/i,
    /\b26\s*\/\s*191\b/,
    /\b191\s+m[ceoa]?cred/i,
    /(?:smithfield|shtmied|shithfield).*2164/i,
    /\b(?:nsw\s*2164|2164\s*nsw)\b/i,
    /undeliverable\s*add?r?ess|return\s*add?r?ess|if\s*undeliverable|ship\s*from|dispatched\s*(?:by|from)/i,
    /aviation\s*security|dangerous\s*goods|false\s*declaration|criminal\s*offence|prohibited\s*goods/i,
    /^from\s*[:;]/i,
    /^sender\b/i
  ];

  const NON_NAME_LINE_PATTERNS = [
    /\b(?:phone|ph|tel|mobile|mob|contact|fax)\b/i,
    /\+?\b61\s*\d{2,3}\s*\d{3}\s*\d{3}\b/,
    /\b0[23478]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/,
    /^(?:deliver\s*to|ship\s*[t1][o0]|deliver\s*[t1][o0]|send\s*to|receiver|recipient|consignee|attention|attn|customer|buyer|[t1]o)\b/i,
    /couriers?\s*p[l1i]ease|cowniers/i,
    /australia\s*post|auspost|eparcel|parcel\s*post|express\s*post/i,
    /startrack|star\s*track|aramex|fastway|allied\s*express|direct\s*freight|sendle|fedex|\btnt\b|\bdhl\b|team\s*global|my\s*toll|\btoll\b|border\s*express|hunter\s*express|amazon|ebay|shopify|shippit|interparcel|dai\s*post|hi-?trans/i,
    /^(?:connote|conn0te|con\s*no|con\s*note|consignment|tracking|ap\s*article|article\s*id|label\s*no|awb|waybill|sscc)\b/i,
    /^\d+(?:\.\d+)?\s*(?:g|gram|kg)\b/i,
    /\d+(?:\.\d+)?\s*[*x×"•]\s*\d+(?:\.\d+)?/,
    /^special\s*instructions|^delivery\s*instructions|^signature\b/i,
    /\b(?:residential|commercial|authority\s*to\s*leave|leave\s*in\s*a\s*safe\s*place|safe\s*place)\b/i,
    /^pkg\s*\d+\s*of\s*\d+/i,
    /^item\s*\d+\s*of\s*\d+/i,
    /^parcel\s*\d+/i,
    /^order\s*(?:id|no|number|#)/i,
    /^reference\b/i,
    /^destination\s*[:;]/i,
    /^australia$/i,
    /\bfragile\b|handle\s*with|^care\b|^atl\b/i,
    /^[a-z]\d[a-z]\d{3}$/i,
    /^(?:cube|weight|items?|qty|date)\s*[:;]/i
  ];

  function cleanLine(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/[|¦｜[\]{}]/g, ' ')
      .replace(/^[\s\-_=•*.,:;]+/, '')
      .replace(/[\s\-_=•*]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Splits a raw OCR row into logical horizontal columns BEFORE collapsing whitespace.
   * Prevents right-column metadata (weights, Pkg 1 of 1, Phone) from bleeding into recipient names.
   */
  function splitRowColumns(rawLine) {
    if (!rawLine) return [];
    const parts = String(rawLine)
      .split(/\t| {3,}/)
      .map(cleanLine)
      .filter((c) => c.length > 0);
    return parts;
  }

  /**
   * Strips inline courier/phone/QR/dimension artifacts from a candidate recipient name.
   */
  function cleanRecipientFragment(str) {
    return (str || '')
      .replace(/\b(?:phone|ph|tel|mobile|contact)\s*[:;.]?\s*\+?\d[\d\s-]{6,16}.*$/i, '')
      .replace(/\b\d+\s*Gram\s*Parcel\b/gi, '')
      .replace(/\bPkg\s*\d+\s*of\s*\d+\b/gi, '')
      .replace(/\b(?:RESIDENTIAL|COMMERCIAL|LEAVE IN A SAFE PLACE|AUTHORITY TO LEAVE)\b/gi, '')
      .replace(/\bOrder\s*(?:Id|No|#)\s*[:;]?\s*[A-Z0-9-]*$/gi, '')
      .replace(/\b\d+(?:\.\d+)?\s*kg\.?\b.*$/gi, '')
      .replace(/\b\d+(?:\.\d+)?\s*[*x×"•]\s*\d+(?:\.\d+)?(?:\s*[*x×"•]\s*\d+(?:\.\d+)?)?.*$/gi, '')
      .replace(/\b[A-Z]\d[A-Z]\d{3}\b/g, '')
      .replace(/\bATL\b$/g, '')
      .replace(/\b(?:500g|1kg|3kg|5kg)\b/gi, '')
      .replace(/[\u00A5\u2122\u00A9\u00AE=~_|]+/g, ' ')
      .replace(/\s+[A-Z]{2}$/, (m) => {
        // Keep common Asian/short surnames (Li, Wu, Ng, Yu, Ho, Do, Le, Ko, Xu, He, An)
        const tok = m.trim();
        if (/^(?:LI|WU|NG|YU|HO|DO|LE|KO|XU|HE|AN|MA|LU|HA|SU|TO|YE|HU|QI|GU)$/i.test(tok)) return m;
        // Strip likely column-bleed noise tokens like " RB"
        if (/^(?:RB|SB|EB|QL|NT)$/i.test(tok)) return '';
        return m;
      })
      .replace(/\s+[=~_¥•*-]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function looksLikeStreetAddress(line) {
    return (
      /^\d+[A-Z]?(?:\/\d+[A-Z]?)?(?:-\d+)?\s+[A-Z]/i.test(line) ||
      /^(?:unit|apt|suite|lot|level|lvl|u\s*\d+|po\s*box|parcel\s*locker|shop)\b/i.test(line) ||
      /\b(?:way|street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|crescent|cres|parade|pde|highway|hwy|circuit|cct|close|cl|terrace|tce)\b/i.test(line)
    );
  }

  function isSuburbPostcodeLine(line, prevLine) {
    if (!line) return false;
    // Reject sender postcode 2164 alongside Smithfield / NSW
    if (/(?:smithfield|shtmied|shithfield|nsw)/i.test(line) && /\b2164\b/.test(line)) return false;

    const stateRe = new RegExp(`\\b(${AU_STATES.join('|')})\\b`, 'i');
    const postcodeRe = /\b\d{4}\b/;

    if (stateRe.test(line) && postcodeRe.test(line)) {
      return true;
    }

    // Two-line CouriersPlease / Amazon style: prevLine "Destination : VIC" + "CHIRNSIDE PARK 3116 AUSTRALIA"
    if (postcodeRe.test(line)) {
      if (/\bAUSTRALIA\b/i.test(line)) return true;
      if (prevLine && /^destination\s*[:;]\s*[A-Z]{2,3}\b/i.test(prevLine)) return true;
    }

    return false;
  }

  /**
   * Scores how much a string looks like a real person or company name (0..100).
   */
  function scoreNameLikeness(name) {
    if (!name || name.length < 3) return 0;
    if (NON_NAME_LINE_PATTERNS.some((p) => p.test(name))) return 10;
    if (SENDER_KEYWORDS.some((p) => p.test(name))) return 0;
    if (looksLikeStreetAddress(name) || isSuburbPostcodeLine(name)) return 15;

    const words = name.split(/\s+/).filter(Boolean);
    // Reject all-lowercase short gibberish where every word is <= 2 chars (e.g. "lh mn")
    if (words.every((w) => w.replace(/[^a-zA-Z]/g, '').length <= 2) && name === name.toLowerCase()) {
      return 0;
    }
    const longWords = words.filter((w) => w.replace(/[^a-zA-Z]/g, '').length >= 3);
    const capWords = words.filter((w) => /^[A-Z]/.test(w));
    if (longWords.length === 0 && capWords.length < 2) return 15;

    const letters = (name.match(/[a-zA-Z]/g) || []).length;
    const digits = (name.match(/\d/g) || []).length;
    const letterRatio = letters / name.length;

    let score = 40;
    if (letterRatio >= 0.78) score += 30;
    else if (letterRatio >= 0.6) score += 15;
    else score -= 25;

    if (digits === 0) score += 15;
    else if (digits <= 2) score += 5;
    else score -= 30;

    if (words.length >= 2 && words.length <= 7) score += 15;
    else if (words.length === 1 && name.length >= 4) score += 5;

    // Bonus for Title Case or ALL CAPS multi-word names
    if (words.length >= 2 && (name === name.toUpperCase() || capWords.length >= Math.min(2, words.length))) {
      score += 8;
    }

    return Math.max(0, Math.min(100, score));
  }

  function normalizeTrackingCode(rawCode) {
    let code = String(rawCode || '')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '');

    // CouriersPlease standard: CP + 5 alpha + 6-9 digits (e.g. CPCTOZE0000179, CPBHZST1575833)
    const cpMatch = code.match(/^CP([A-Z0185]{5})([0-9OISBZ]{6,9})$/);
    if (cpMatch) {
      const alphaPart = cpMatch[1]
        .replace(/0/g, 'O')
        .replace(/1/g, 'I')
        .replace(/8/g, 'B')
        .replace(/5/g, 'S');
      const numPart = cpMatch[2]
        .replace(/O/g, '0')
        .replace(/I/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/Z/g, '2');
      return 'CP' + alphaPart + numPart;
    }

    // Australia Post eParcel / Article ID / Con No: 2 digits + 2-3 letters + 7-20 digits
    // (e.g. 39BCX500052901000931505, 33PKH509928101000930904, 39BCX5000529)
    const apMatch = code.match(/^([0-9OISBZ]{2})([A-Z0185]{2,3})([0-9OISBZ]{7,20})$/);
    if (apMatch) {
      const leadDigits = apMatch[1]
        .replace(/O/g, '0')
        .replace(/I/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/Z/g, '2');
      const midAlpha = apMatch[2]
        .replace(/0/g, 'O')
        .replace(/1/g, 'I')
        .replace(/8/g, 'B')
        .replace(/5/g, 'S');
      const tailDigits = apMatch[3]
        .replace(/O/g, '0')
        .replace(/I/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/Z/g, '2');
      return leadDigits + midAlpha + tailDigits;
    }

    // UPU S10 International (e.g. EB123456789AU)
    const s10Match = code.match(/^([A-Z0185]{2})([0-9OISBZ]{9})([A-Z]{2})$/);
    if (s10Match) {
      const prefix = s10Match[1].replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B').replace(/5/g, 'S');
      const digits = s10Match[2].replace(/O/g, '0').replace(/I/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
      return prefix + digits + s10Match[3];
    }

    // Aramex / Fastway (2 letters + 10 digits)
    const aramexMatch = code.match(/^([A-Z]{2})([0-9OISBZ]{10})$/);
    if (aramexMatch) {
      const digits = aramexMatch[2].replace(/O/g, '0').replace(/I/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
      return aramexMatch[1] + digits;
    }

    return code;
  }

  function extractCodeCandidate(fragment) {
    if (!fragment) return '';
    // Stop before trailing short numeric footer codes (e.g. "1118") or trailing noise words
    let cleaned = String(fragment)
      .trim()
      .replace(/^(?:[:;#.\-=|\s])+/, '')
      .replace(/\s+(?:item|parcel|weight|cube|page)\b.*$/i, '')
      .replace(/\s+\d{1,5}(?:\s+.*)?$/, '')
      .trim();

    // Check first continuous or space-split alphanumeric sequence (at least 6 chars)
    const m = cleaned.match(/^([A-Z0-9][A-Z0-9-]{4,34}(?:\s+[0-9OISBZ]{5,18})?)/i);
    if (!m || !m[1]) return '';
    return normalizeTrackingCode(m[1].replace(/\s+/g, ''));
  }

  function isFalseTrackingToken(code, allowSendleShort = false) {
    if (!code) return true;
    if (/[_/]/.test(code)) return true;
    // Allow 6-char Sendle references when explicitly tagged
    const minLen = allowSendleShort && /^S[A-Z0-9]{5,7}$/i.test(code) ? 6 : 7;
    if (code.length < minLen) return true;
    // Depot routing codes like D4A270, T4A259
    if (/^[A-Z]\d[A-Z]\d{3}$/i.test(code)) return true;
    // Amazon / retail hyphenated order IDs like 503-0624319-3869418
    if (/^\d{3}-\d{7}-\d{7}$/.test(code)) return true;
    if (/^(?:PARCEL|EXPRESS|GRAM|WEIGHT|NUMBER|ARTICLE|CONNOTE|SENDER|DELIVER|SHIPPING|RESIDENTIAL|AUSTRALIA|COMMERCIAL)$/i.test(code)) return true;
    // Ignore AU mobile/landline phone numbers mistaken as tracking
    if (/^(?:614\d{8}|04\d{8}|61[2378]\d{8})$/.test(code)) return true;
    return false;
  }

  function isOrderOrRefLine(line) {
    return /\b(?:order\s*(?:id|no|number|#)|po\s*(?:no|number|#)|invoice\s*(?:no|#)?|reference)\b/i.test(line);
  }

  function isCarrierTrackingFormat(code) {
    if (!code || isFalseTrackingToken(code)) return false;
    return (
      /^[0-9]{2}[A-Z]{2,3}[0-9]{7,20}$/.test(code) || // AusPost eParcel
      /^CP[A-Z]{5}[0-9]{6,9}$/.test(code) ||        // CouriersPlease
      /^[A-Z]{2}\d{9}AU$/.test(code) ||               // UPU S10 AU
      /^(?:MP|FW|QQ|AZ|NZ|RZ|SZ|PX|CW|SY|ML|BN)\d{10}$/.test(code) || // Aramex / Fastway
      /^(?:JD01|JJD|GM)\d{10,20}$/.test(code) ||      // DHL eCommerce / Express
      /^G[ED]\d{9}(?:AU)?$/.test(code)                // TNT
    );
  }

  /**
   * Extracts Connote / Tracking Number + certainty score.
   */
  function extractTrackingNumber(rawText, lines, rowCells) {
    // Ordered by specificity: AP Article Id > Connote/Tracking/Waybill/Sendle > Label/SSCC > Con No > Barcode
    const headerRules = [
      {
        priority: 6,
        allowSendleShort: false,
        labelOnlyRe: /^(?:ap\s*)?art[i1l]c[l1i]e\s*[i1l1]?[do]\s*[:;#.-]*$/i,
        inlineRe: /(?:(?:ap|tap)\s*)?a[rf]t[i1l]c[l1i]e\s*(?:[i1l1]?[do]|no)\s*[:;#.-]*\s+([A-Z0-9][A-Z0-9 -]{6,34})/i
      },
      {
        priority: 5,
        allowSendleShort: true,
        labelOnlyRe: /^(?:c[o0]nn[o0l1mt]{2,4}e?|con\s*note|consignment(?:\s*n[o0]|\s*#)?|track[i1l]ng(?:\s*n[o0]|\s*number|\s*#|\s*[i1l]d)?|trk\s*#?|(?:air\s*)?waybill|awb|sendle(?:\s*ref)?)\s*[:;#.-]*$/i,
        inlineRe: /(?:c[o0]nn[o0l1mt]{2,4}e?|con\s*note|c[o0]ns[i1l]gnment(?:\s*n[o0]|\s*#)?|track[i1l]ng(?:\s*n[o0]|\s*number|\s*#|\s*[i1l]d)?|trk\s*#?|(?:air\s*)?waybill|awb|sendle(?:\s*ref)?)\s*[:;#.-]*\s+([A-Z0-9][A-Z0-9 -]{5,34})/i
      },
      {
        priority: 4,
        allowSendleShort: false,
        labelOnlyRe: /^(?:label\s*n[o0]|parcel\s*(?:id|n[o0])|item\s*(?:id|n[o0])|sscc|cn\s*n[o0])\s*[:;#.-]*$/i,
        inlineRe: /(?:label\s*n[o0]|parcel\s*(?:id|n[o0])|item\s*(?:id|n[o0])|sscc|cn\s*n[o0])\s*[:;#.-]*\s+([A-Z0-9][A-Z0-9 -]{6,34})/i
      },
      {
        priority: 2,
        allowSendleShort: false,
        labelOnlyRe: /^c[o0]n\s*n[o0]\.?\s*[:;#.-]*$/i,
        inlineRe: /\bc[o0]n\s*n[o0]\.?\s*[:;#.-]*\s+([A-Z0-9][A-Z0-9-]{6,24})/i
      },
      {
        priority: 1,
        allowSendleShort: false,
        labelOnlyRe: null,
        inlineRe: /^BARCODE_PAYLOAD\s*:\s*([A-Z0-9_-]{7,36})/i
      }
    ];

    const candidates = [];
    const effectiveCells = Array.isArray(rowCells) ? rowCells : lines.map((l) => [l]);

    // Scan each cell AND each full line so column boundaries never block or pollute matches
    const scanSources = [];
    for (let i = 0; i < lines.length; i++) {
      const cells = effectiveCells[i] || [lines[i]];
      for (const cell of cells) {
        scanSources.push({ text: cell, rowIndex: i, nextText: i + 1 < lines.length ? lines[i + 1] : '' });
      }
      if (cells.length > 1) {
        scanSources.push({ text: lines[i], rowIndex: i, nextText: i + 1 < lines.length ? lines[i + 1] : '' });
      }
    }

    for (const src of scanSources) {
      const text = src.text;
      // Do not treat Order Id / PO / Reference lines as header-based tracking numbers
      const skipNonBarcode = isOrderOrRefLine(text);

      for (const rule of headerRules) {
        if (skipNonBarcode && rule.priority > 1) continue;

        const inlineMatch = text.match(rule.inlineRe);
        if (inlineMatch && inlineMatch[1]) {
          if (rule.priority === 1) {
            const rawPayload = inlineMatch[1].trim();
            // Reject DataMatrix payloads with underscores or mixed lowercase letters like SDrlMx0wVr_001_v
            if (/[_]/.test(rawPayload) || (/[a-z]/.test(rawPayload) && /[A-Z]/.test(rawPayload))) {
              continue;
            }
            const code = normalizeTrackingCode(rawPayload);
            if (!isFalseTrackingToken(code) && /\d/.test(code)) {
              const bumpedPriority = isCarrierTrackingFormat(code) ? 3 : 1;
              candidates.push({ code, priority: bumpedPriority, explicit: false });
            }
          } else {
            const code = extractCodeCandidate(inlineMatch[1]);
            if (!isFalseTrackingToken(code, rule.allowSendleShort) && /\d/.test(code)) {
              candidates.push({ code, priority: rule.priority, explicit: true });
            }
          }
          continue;
        }
        if (rule.labelOnlyRe && rule.labelOnlyRe.test(text) && src.nextText) {
          const nextCode = extractCodeCandidate(src.nextText);
          if (!isFalseTrackingToken(nextCode, rule.allowSendleShort) && /\d/.test(nextCode)) {
            candidates.push({ code: nextCode, priority: rule.priority, explicit: true });
          }
        }
      }
    }

    // 2. Carrier-specific patterns anywhere in text (Priority 3: beats generic BARCODE_PAYLOAD!)
    const normalizedAll = rawText.toUpperCase();

    // 2a. Australia Post Article ID / eParcel Con No (2 digits + 3 letters + 7-20 digits)
    const apRe = /\b([0-9OISBZ]{2}[A-Z0185]{3}[0-9OISBZ]{7,20})\b/gi;
    let m;
    while ((m = apRe.exec(normalizedAll)) !== null) {
      const norm = normalizeTrackingCode(m[1]);
      if (!isFalseTrackingToken(norm) && /^[0-9]{2}[A-Z]{3}[0-9]{7,20}$/.test(norm)) {
        candidates.push({ code: norm, priority: 3, explicit: false, carrierBonus: norm.length >= 16 ? 92 : 86 });
      }
    }

    // 2b. CouriersPlease standard/Amazon pattern (CP + 5 letters + 6-9 digits)
    const cpRe = /\b(CP[A-Z0185]{5}[0-9OISBZ]{6,9})\b/gi;
    while ((m = cpRe.exec(normalizedAll)) !== null) {
      const norm = normalizeTrackingCode(m[1]);
      if (!isFalseTrackingToken(norm) && /^CP[A-Z]{5}\d{6,9}$/.test(norm)) {
        candidates.push({ code: norm, priority: 3, explicit: false, carrierBonus: 90 });
      }
    }

    // 2c. UPU S10 International (e.g. EB123456789AU)
    const s10Re = /\b([A-Z]{2}\d{9}AU)\b/gi;
    while ((m = s10Re.exec(normalizedAll)) !== null) {
      const norm = normalizeTrackingCode(m[1]);
      if (!isFalseTrackingToken(norm)) {
        candidates.push({ code: norm, priority: 3, explicit: false, carrierBonus: 88 });
      }
    }

    // 2d. Aramex / Fastway (e.g. MP0012983471)
    const aramexRe = /\b((?:MP|FW|QQ|AZ|NZ|RZ|SZ|PX|CW|SY|ML|BN)[0-9OISBZ]{10})\b/gi;
    while ((m = aramexRe.exec(normalizedAll)) !== null) {
      const norm = normalizeTrackingCode(m[1]);
      if (!isFalseTrackingToken(norm) && /^[A-Z]{2}\d{10}$/.test(norm)) {
        candidates.push({ code: norm, priority: 3, explicit: false, carrierBonus: 88 });
      }
    }

    // 2e. StarTrack
    const hasStartrack = /startrack|star\s*track/i.test(normalizedAll);
    const stRe = hasStartrack
      ? /\b([A-Z0-9]{3,4}Z?\d{8}(?:\d{3})?)\b/gi
      : /\b(\d[A-Z]{2,3}\d{8,11})\b/gi;
    while ((m = stRe.exec(normalizedAll)) !== null) {
      const norm = normalizeTrackingCode(m[1]);
      if (!isFalseTrackingToken(norm) && /[A-Z]/.test(norm) && /\d{8}/.test(norm)) {
        candidates.push({ code: norm, priority: 3, explicit: false, carrierBonus: 86 });
      }
    }

    // 2f. DHL eCommerce / Express & TNT
    const dhlTntRe = /\b((?:JD01|JJD|GM)\d{10,20}|G[ED]\d{9}(?:AU)?)\b/gi;
    while ((m = dhlTntRe.exec(normalizedAll)) !== null) {
      const norm = normalizeTrackingCode(m[1]);
      if (!isFalseTrackingToken(norm)) {
        candidates.push({ code: norm, priority: 3, explicit: false, carrierBonus: 86 });
      }
    }

    if (candidates.length > 0) {
      // Highest priority first, then longest code (e.g. full AP Article Id over short Con No)
      candidates.sort((a, b) => (b.priority - a.priority) || (b.code.length - a.code.length));
      const best = candidates[0];
      const hasAlphaAndDigit = /[A-Z]/.test(best.code) && /\d/.test(best.code);
      const baseCertainty = best.explicit
        ? (hasAlphaAndDigit && best.code.length >= 10 ? 95 : 86)
        : (best.carrierBonus || 84);
      return { trackingNumber: best.code, baseCertainty };
    }

    // 3. Standalone alphanumeric tracking / barcode token fallback
    for (const line of lines) {
      if (SENDER_KEYWORDS.some((k) => k.test(line))) continue;
      if (isOrderOrRefLine(line)) continue;
      if (NON_NAME_LINE_PATTERNS.slice(0, 3).some((k) => k.test(line))) continue;
      const alnum = line.match(/\b([A-Z]{2,5}[0-9]{6,18}[A-Z0-9]*|\d{2}[A-Z]{2,4}\d{7,18})\b/i);
      if (alnum) {
        const code = normalizeTrackingCode(alnum[1]);
        if (!isFalseTrackingToken(code)) return { trackingNumber: code, baseCertainty: 72 };
      }
      const numBarcode = line.match(/\b(\d{12,24})\b/);
      if (numBarcode && !isFalseTrackingToken(numBarcode[1])) {
        return { trackingNumber: numBarcode[1], baseCertainty: 64 };
      }
    }

    return { trackingNumber: '', baseCertainty: 0 };
  }

  /**
   * Extracts Customer / Recipient Name + certainty score.
   */
  function extractCustomerName(lines, rowCells) {
    const effectiveCells = Array.isArray(rowCells) ? rowCells : lines.map((l) => [l]);
    const headerPrefixRe = /^(?:deliver\s*[t1][o0]|ship\s*[t1][o0]|send\s*to|receiver|recipient|consignee|attention|attn|customer|buyer|[t1][o0])(?:\s*[:;.-]|\s+)(.*)$/i;
    const invertedHeaderRe = /^(.*?)\b(?:deliver\s*[t1][o0]|ship\s*[t1][o0]|consignee)\s*[:;.-]*(?:\s|$)/i;

    // 1. Explicit recipient headers across column cells and full lines
    for (let i = 0; i < lines.length; i++) {
      const cells = effectiveCells[i] || [lines[i]];
      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        if (SENDER_KEYWORDS.some((k) => k.test(cell))) continue;

        const toHeader = cell.match(headerPrefixRe);
        if (toHeader) {
          // 1a. Check inline text after the header in this cell
          const inlineCandidate = cleanRecipientFragment(toHeader[1]);
          const inlineScore = scoreNameLikeness(inlineCandidate);
          if (inlineScore >= 70) {
            return {
              customerName: inlineCandidate,
              baseCertainty: Math.min(96, 55 + Math.round(inlineScore * 0.42))
            };
          }

          // 1b. Inspect next 1-4 rows in the SAME column cell first, then fallback to row line
          for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
            const nextCells = effectiveCells[j] || [lines[j]];
            const probeList = c < nextCells.length ? [nextCells[c], nextCells[0], lines[j]] : [nextCells[0], lines[j]];

            for (const rawNext of probeList) {
              if (!rawNext) continue;
              const candidate = cleanRecipientFragment(rawNext);
              if (!candidate) continue;
              if (SENDER_KEYWORDS.some((k) => k.test(candidate))) break;
              if (looksLikeStreetAddress(candidate) || isSuburbPostcodeLine(candidate, lines[j - 1])) {
                // Stop scanning further down once we hit the destination street address
                j = lines.length;
                break;
              }

              const nextScore = scoreNameLikeness(candidate);
              if (nextScore >= 58) {
                return {
                  customerName: candidate,
                  baseCertainty: Math.min(96, 55 + Math.round(nextScore * 0.42))
                };
              }
            }
          }
        }

        // 1c. Handle inverted merged lines like "JAKE DURY SHIP TO:" when Vision/WinRT reads columns side-by-side
        const invMatch = cell.match(invertedHeaderRe);
        if (invMatch && invMatch[1]) {
          const beforeCandidate = cleanRecipientFragment(invMatch[1]);
          const beforeScore = scoreNameLikeness(beforeCandidate);
          if (beforeScore >= 70) {
            return {
              customerName: beforeCandidate,
              baseCertainty: Math.min(94, 52 + Math.round(beforeScore * 0.42))
            };
          }
        }
      }
    }

    // 2. Structural fallback: find non-sender Suburb+Postcode+State line and scan upward
    for (let i = 0; i < lines.length; i++) {
      const cells = effectiveCells[i] || [lines[i]];
      const prevLine = i > 0 ? lines[i - 1] : '';
      const matchedSuburb =
        isSuburbPostcodeLine(cells[0], prevLine) || isSuburbPostcodeLine(lines[i], prevLine);

      if (matchedSuburb) {
        let bestCandidate = '';
        let bestScore = 0;

        for (let k = Math.max(0, i - 5); k < i; k++) {
          const kCells = effectiveCells[k] || [lines[k]];
          // Try cell 0 (left recipient column) first, then check whether right column had a name
          const probes = kCells.length > 1 ? [kCells[0], kCells[1]] : [kCells[0]];
          for (const rawProbe of probes) {
            const candidate = cleanRecipientFragment(
              rawProbe.replace(/^(?:deliver\s*[t1][o0]|ship\s*[t1][o0]|to)\s*[:;.-]?\s*/i, '')
            );
            if (!candidate) continue;
            const sc = scoreNameLikeness(candidate);
            if (sc > bestScore && sc >= 58) {
              bestScore = sc;
              bestCandidate = candidate;
              break; // Take topmost valid name above the street address
            }
          }
          if (bestCandidate) break;
        }

        if (bestCandidate) {
          return {
            customerName: bestCandidate,
            baseCertainty: Math.min(88, 40 + Math.round(bestScore * 0.45))
          };
        }
      }
    }

    return { customerName: '', baseCertainty: 0 };
  }

  function extractOrderDate(lines) {
    const MONTHS = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };

    for (const line of lines) {
      if (!/(?:date|despatch|dispatch|order)/i.test(line)) continue;

      const iso = line.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
      if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

      const au = line.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
      if (au) return `${au[3]}-${au[2].padStart(2, '0')}-${au[1].padStart(2, '0')}`;

      const textDate = line.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b/i);
      if (textDate) {
        const mm = MONTHS[textDate[2].slice(0, 3).toLowerCase()];
        if (mm) return `${textDate[3]}-${mm}-${textDate[1].padStart(2, '0')}`;
      }
    }
    return '';
  }

  /**
   * Parses raw OCR text and returns extracted fields + 0-100 certainty percentages.
   * @param {string} rawText
   * @param {number} engineConfidence Optional 0-100 OCR engine confidence (e.g. Tesseract data.confidence)
   */
  function parseTrackingSlipText(rawText, engineConfidence = 90) {
    if (!rawText || typeof rawText !== 'string') {
      return {
        customerName: '',
        customerNameCertainty: 0,
        trackingNumber: '',
        trackingNumberCertainty: 0,
        orderDate: '',
        rawText: ''
      };
    }

    const rowCells = [];
    const lines = [];
    for (const rawLine of rawText.split(/\r?\n/)) {
      const cells = splitRowColumns(rawLine);
      if (cells.length > 0) {
        rowCells.push(cells);
        lines.push(cells.join(' '));
      }
    }

    const engFactor = Math.max(0.72, Math.min(1.03, ((Number(engineConfidence) || 85) + 22) / 100));

    const nameRes = extractCustomerName(lines, rowCells);
    const trackRes = extractTrackingNumber(rawText, lines, rowCells);
    const orderDate = extractOrderDate(lines);

    const customerNameCertainty = nameRes.customerName
      ? Math.max(15, Math.min(99, Math.round(nameRes.baseCertainty * engFactor)))
      : 0;

    const trackingNumberCertainty = trackRes.trackingNumber
      ? Math.max(15, Math.min(99, Math.round(trackRes.baseCertainty * engFactor)))
      : 0;

    return {
      customerName: nameRes.customerName,
      customerNameCertainty,
      trackingNumber: trackRes.trackingNumber,
      trackingNumberCertainty,
      orderDate,
      rawText
    };
  }

  return {
    parseTrackingSlipText,
    extractCustomerName,
    extractTrackingNumber,
    extractOrderDate,
    normalizeTrackingCode,
    scoreNameLikeness
  };
});
