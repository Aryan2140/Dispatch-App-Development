/**
 * ============================================================================
 * AIMEX MULTI-COURIER AUSTRALIAN TRACKING SLIP PARSER + CERTAINTY SCORING
 * ============================================================================
 * Extracts:
 *   - customerName + customerNameCertainty (0-100)
 *   - trackingNumber + trackingNumberCertainty (0-100)
 *   - orderDate (YYYY-MM-DD if printed on label, otherwise '')
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
    /aimex\s+australia/i,
    /191\s+mccredie/i,
    /smithfield\s+(?:nsw\s*)?2164/i,
    /aviation\s+security/i,
    /dangerous\s+goods/i,
    /false\s+declaration/i,
    /^from\s*[:;]/i,
    /^sender\b/i
  ];

  const NON_NAME_LINE_PATTERNS = [
    /\b(?:phone|ph|tel|mobile|mob|contact|fax)\b/i,
    /\+?\b61\s*\d{2,3}\s*\d{3}\s*\d{3}\b/,
    /\b0[23478]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/,
    /^(?:deliver\s*to|ship\s*to|receiver|consignee|to)\b/i,
    /couriers\s*please/i,
    /australia\s*post|auspost|eparcel|parcel\s*post|express\s*post/i,
    /startrack|aramex|fastway|allied\s*express|direct\s*freight|sendle|fedex|\btnt\b|\bdhl\b/i,
    /^(?:connote|conn0te|con\s*no|consignment|tracking|ap\s*article|article\s*id|label\s*no|awb)\b/i,
    /^\d+(?:\.\d+)?\s*(?:g|gram|kg)\b/i,
    /^special\s*instructions|^delivery\s*instructions|^signature\b/i
  ];

  function cleanLine(raw) {
    if (!raw) return '';
    return raw
      .replace(/[|¦｜[\]{}]/g, ' ')
      .replace(/^[\s\-_=•*.,:;]+/, '')
      .replace(/[\s\-_=•*]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Strips inline courier/phone/QR artifacts from a candidate recipient name.
   */
  function cleanRecipientFragment(str) {
    return (str || '')
      .replace(/\b(?:phone|ph|tel|mobile|contact)\s*[:;.]?\s*\+?\d[\d\s-]{6,16}.*$/i, '')
      .replace(/\b\d+\s*Gram\s*Parcel\b/gi, '')
      .replace(/\bT\d[A-Z]\d{3}\b/g, '')
      .replace(/\bATL\b$/g, '')
      .replace(/\b(?:500g|1kg|3kg|5kg)\b/gi, '')
      .replace(/[=~_]+$/g, '')
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

  function isSuburbPostcodeLine(line) {
    const stateRe = new RegExp(`\\b(${AU_STATES.join('|')})\\b`, 'i');
    const postcodeRe = /\b\d{4}\b/;
    if (!stateRe.test(line) || !postcodeRe.test(line)) return false;
    if (/smithfield\s+(?:nsw\s*)?2164/i.test(line)) return false;
    return true;
  }

  /**
   * Scores how much a string looks like a real person or company name (0..100).
   */
  function scoreNameLikeness(name) {
    if (!name || name.length < 3) return 0;
    if (NON_NAME_LINE_PATTERNS.some((p) => p.test(name))) return 10;
    if (SENDER_KEYWORDS.some((p) => p.test(name))) return 0;
    if (looksLikeStreetAddress(name) || isSuburbPostcodeLine(name)) return 15;

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

    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 7) score += 15;
    else if (words.length === 1 && name.length >= 4) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  function normalizeTrackingCode(rawCode) {
    let code = String(rawCode || '')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '');

    // CouriersPlease standard: CP + 5 alpha + 6-8 digits (e.g. CPCTOZE0000179)
    const cpMatch = code.match(/^CP([A-Z0185]{5})([0-9OISBZ]{6,8})$/);
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
    const apMatch = code.match(/^([0-9OISBZ]{2})([A-Z0185]{3})([0-9OISBZ]{7,20})$/);
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

    // Check first continuous or space-split alphanumeric sequence (at least 7 chars)
    const m = cleaned.match(/^([A-Z0-9][A-Z0-9-]{5,32}(?:\s+[0-9OISBZ]{5,18})?)/i);
    if (!m || !m[1]) return '';
    return normalizeTrackingCode(m[1].replace(/\s+/g, ''));
  }

  function isFalseTrackingToken(code) {
    if (!code || code.length < 7) return true;
    if (/^(?:PARCEL|EXPRESS|GRAM|WEIGHT|NUMBER|ARTICLE|CONNOTE|SENDER|DELIVER|SHIPPING)$/i.test(code)) return true;
    // Ignore AU mobile/landline phone numbers mistaken as tracking
    if (/^(?:614\d{8}|04\d{8}|61[2378]\d{8})$/.test(code)) return true;
    return false;
  }

  /**
   * Extracts Connote / Tracking Number + certainty score.
   */
  function extractTrackingNumber(rawText, lines) {
    // Ordered by specificity: explicit ID headers > short Con No > decoded barcode payload
    const headerRules = [
      {
        priority: 5,
        labelOnlyRe: /^(?:ap\s*)?art[i1l]c[l1i]e\s*[i1l1]?d\s*[:;#.-]*$/i,
        inlineRe: /(?:(?:ap|tap)\s*)?art[i1l]c[l1i]e\s*[i1l1]?d\s*[:;#.-]*\s+([A-Z0-9][A-Z0-9 -]{6,34})/i
      },
      {
        priority: 4,
        labelOnlyRe: /^(?:c[o0]nn[o0l1mt]{2,4}e?|consignment(?:\s*n[o0]|\s*#)?|track[i1l]ng(?:\s*n[o0]|\s*#|\s*[i1l]d|\s*number)?|label\s*n[o0]|awb)\s*[:;#.-]*$/i,
        inlineRe: /(?:c[o0]nn[o0l1mt]{2,4}e?|c[o0]ns[i1l]gnment(?:\s*n[o0]|\s*#)?|track[i1l]ng(?:\s*n[o0]|\s*#|\s*[i1l]d|\s*number)?|label\s*n[o0]|awb)\s*[:;#.-]*\s+([A-Z0-9][A-Z0-9 -]{6,34})/i
      },
      {
        priority: 2,
        labelOnlyRe: /^c[o0]n\s*n[o0]\.?\s*[:;#.-]*$/i,
        inlineRe: /\bc[o0]n\s*n[o0]\.?\s*[:;#.-]*\s+([A-Z0-9][A-Z0-9-]{6,24})/i
      },
      {
        priority: 1,
        labelOnlyRe: null,
        inlineRe: /^BARCODE_PAYLOAD\s*:\s*([A-Z0-9-]{7,32})/i
      }
    ];

    const candidates = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const rule of headerRules) {
        const inlineMatch = line.match(rule.inlineRe);
        if (inlineMatch && inlineMatch[1]) {
          const code = rule.priority === 1
            ? normalizeTrackingCode(inlineMatch[1])
            : extractCodeCandidate(inlineMatch[1]);
          if (!isFalseTrackingToken(code) && /\d/.test(code)) {
            candidates.push({ code, priority: rule.priority, explicit: rule.priority > 1 });
          }
          continue;
        }
        if (rule.labelOnlyRe && rule.labelOnlyRe.test(line) && i + 1 < lines.length) {
          const nextCode = extractCodeCandidate(lines[i + 1]);
          if (!isFalseTrackingToken(nextCode) && /\d/.test(nextCode)) {
            candidates.push({ code: nextCode, priority: rule.priority, explicit: true });
          }
        }
      }
    }

    if (candidates.length > 0) {
      // Highest priority first, then longest code (e.g. full AP Article Id over short Con No)
      candidates.sort((a, b) => (b.priority - a.priority) || (b.code.length - a.code.length));
      const best = candidates[0];
      const hasAlphaAndDigit = /[A-Z]/.test(best.code) && /\d/.test(best.code);
      const baseCertainty = best.explicit
        ? (hasAlphaAndDigit && best.code.length >= 10 ? 95 : 86)
        : 84;
      return { trackingNumber: best.code, baseCertainty };
    }

    // 2. Carrier-specific patterns anywhere in text (handles obscured header labels in shadow)
    const normalizedAll = rawText.toUpperCase();

    // 2a. Australia Post Article ID / eParcel Con No (2 digits + 3 letters + 7-20 digits)
    const apMatches = [];
    const apRe = /\b([0-9OISBZ]{2}[A-Z0185]{3}[0-9OISBZ]{7,20})\b/gi;
    let m;
    while ((m = apRe.exec(normalizedAll)) !== null) {
      const norm = normalizeTrackingCode(m[1]);
      if (!isFalseTrackingToken(norm) && /^[0-9]{2}[A-Z]{3}[0-9]{7,20}$/.test(norm)) {
        apMatches.push(norm);
      }
    }
    if (apMatches.length > 0) {
      apMatches.sort((a, b) => b.length - a.length);
      return {
        trackingNumber: apMatches[0],
        baseCertainty: apMatches[0].length >= 16 ? 92 : 86
      };
    }

    // 2b. CouriersPlease standard pattern anywhere (CP + 5 letters + 6-8 digits)
    const cpMatches = normalizedAll.match(/\b(CP[A-Z0185]{5}[0-9OISBZ]{6,8})\b/gi);
    if (cpMatches && cpMatches.length > 0) {
      return {
        trackingNumber: normalizeTrackingCode(cpMatches[0]),
        baseCertainty: 90
      };
    }

    // 3. Standalone alphanumeric tracking / barcode token
    for (const line of lines) {
      if (SENDER_KEYWORDS.some((k) => k.test(line))) continue;
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
  function extractCustomerName(lines) {
    // 1. Find explicit "DELIVER TO" / "TO:" / "SHIP TO:" / "CONSIGNEE:" header
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (SENDER_KEYWORDS.some((k) => k.test(line))) continue;

      const toHeader = line.match(
        /^(?:deliver\s*to|ship\s*to|receiver|consignee|[t7][o0])(?:\s*[:;.-]|\s+)(.*)$/i
      );
      if (toHeader) {
        // First check if inline text after "TO:" is a valid name (ignoring "PHONE :+61..." on the same line!)
        const inlineCandidate = cleanRecipientFragment(toHeader[1]);
        const inlineScore = scoreNameLikeness(inlineCandidate);
        if (inlineScore >= 70) {
          return { customerName: inlineCandidate, baseCertainty: Math.min(96, 55 + Math.round(inlineScore * 0.42)) };
        }

        // Otherwise inspect the next 1-3 lines under the "DELIVER TO" header
        for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
          const nextCandidate = cleanRecipientFragment(lines[j]);
          if (!nextCandidate) continue;
          if (SENDER_KEYWORDS.some((k) => k.test(nextCandidate))) break;
          if (looksLikeStreetAddress(nextCandidate) || isSuburbPostcodeLine(nextCandidate)) break;

          const nextScore = scoreNameLikeness(nextCandidate);
          if (nextScore >= 55) {
            return {
              customerName: nextCandidate,
              baseCertainty: Math.min(96, 55 + Math.round(nextScore * 0.42))
            };
          }
        }
      }
    }

    // 2. Structural fallback: find non-sender Suburb+Postcode+State line and scan upward
    for (let i = 0; i < lines.length; i++) {
      if (isSuburbPostcodeLine(lines[i])) {
        let bestCandidate = '';
        let bestScore = 0;

        for (let k = Math.max(0, i - 4); k < i; k++) {
          const candidate = cleanRecipientFragment(
            lines[k].replace(/^(?:deliver\s*to|ship\s*to|to)\s*[:;.-]?\s*/i, '')
          );
          if (!candidate) continue;
          const sc = scoreNameLikeness(candidate);
          if (sc > bestScore && sc >= 55) {
            bestScore = sc;
            bestCandidate = candidate;
            break; // Take the topmost valid name above the street address
          }
        }

        if (bestCandidate) {
          return {
            customerName: bestCandidate,
            baseCertainty: Math.min(88, 40 + Math.round(bestScore * 0.45))
          };
        }
        break;
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

    const lines = rawText
      .split(/\r?\n/)
      .map(cleanLine)
      .filter((l) => l.length > 0);

    const engFactor = Math.max(0.72, Math.min(1.03, ((Number(engineConfidence) || 85) + 22) / 100));

    const nameRes = extractCustomerName(lines);
    const trackRes = extractTrackingNumber(rawText, lines);
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
