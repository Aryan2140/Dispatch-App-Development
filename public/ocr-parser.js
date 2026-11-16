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

    // CouriersPlease standard: CP + 5 alpha + 7 digits
    const cpMatch = code.match(/^CP([A-Z01]{5})([0-9OI]{6,8})$/);
    if (cpMatch) {
      const alphaPart = cpMatch[1].replace(/0/g, 'O').replace(/1/g, 'I');
      const numPart = cpMatch[2].replace(/O/g, '0').replace(/I/g, '1');
      code = 'CP' + alphaPart + numPart;
    }
    return code;
  }

  /**
   * Extracts Connote / Tracking Number + certainty score.
   */
  function extractTrackingNumber(rawText, lines) {
    // 1. High-priority explicit labels (AP Article Id, Connote, Tracking, Consignment, Con No, Label No, AWB)
    const explicitPatterns = [
      /(?:ap\s*article\s*id|article\s*id|c[o0]nn[o0]te|consignment(?:\s*no|\s*#)?|tracking(?:\s*no|\s*#|\s*id|\s*number)?|label\s*no|awb)\s*[:;#.-]?\s*([A-Z0-9-]{8,30})/i,
      /\bcon\s*no\.?\s*[:;#.-]?\s*([A-Z0-9-]{7,24})/i
    ];

    const candidates = [];

    for (const line of lines) {
      for (let pIdx = 0; pIdx < explicitPatterns.length; pIdx++) {
        const m = line.match(explicitPatterns[pIdx]);
        if (m && m[1]) {
          const code = normalizeTrackingCode(m[1]);
          if (code.length >= 7 && !/^(PARCEL|EXPRESS|GRAM|WEIGHT|NUMBER|ITEM)$/i.test(code)) {
            candidates.push({ code, explicit: true, priority: pIdx === 0 ? 2 : 1 });
          }
        }
      }
    }

    if (candidates.length > 0) {
      // Prefer longer explicit tracking ID (e.g. AusPost AP Article Id over shorter Con No, or Connote over short)
      candidates.sort((a, b) => (b.priority - a.priority) || (b.code.length - a.code.length));
      const best = candidates[0];
      const hasDigit = /\d/.test(best.code);
      const formatScore = hasDigit && best.code.length >= 10 ? 92 : hasDigit ? 82 : 55;
      return { trackingNumber: best.code, baseCertainty: formatScore };
    }

    // 2. CouriersPlease pattern anywhere
    const cpMatches = rawText.match(/\b(CP[A-Z01]{4,6}[0-9OI]{5,9})\b/gi);
    if (cpMatches && cpMatches.length > 0) {
      return {
        trackingNumber: normalizeTrackingCode(cpMatches[0]),
        baseCertainty: 78
      };
    }

    // 3. Standalone alphanumeric tracking / barcode token
    for (const line of lines) {
      const m = line.match(/\b([A-Z0-9]{2,5}[0-9]{6,18}[A-Z0-9]*)\b/i);
      if (m) {
        const code = normalizeTrackingCode(m[1]);
        if (code.length >= 10) return { trackingNumber: code, baseCertainty: 68 };
      }
      const numBarcode = line.match(/\b(\d{12,24})\b/);
      if (numBarcode) return { trackingNumber: numBarcode[1], baseCertainty: 62 };
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
