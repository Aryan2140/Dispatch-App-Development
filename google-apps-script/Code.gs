/**
 * ============================================================================
 * AIMEX AUSTRALIA — WAREHOUSE DISPATCH GOOGLE SHEETS & DRIVE INTEGRATION
 * ============================================================================
 *
 * SETUP:
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Paste this entire file into Code.gs and Save.
 * 3. Run "setupSheet" once from the Apps Script toolbar to format tabs.
 * 4. Click Deploy -> New deployment -> Web app:
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 5. Paste the Web app URL (/exec) into Admin Settings in the Dispatch Web App.
 * ============================================================================
 */

const CONFIG = {
  DISPATCH_SHEET_NAME: 'Dispatches',
  SEARCH_SHEET_NAME: 'Search & Dashboard',
  PRODUCTS_SHEET_NAME: 'Products',
  DRIVE_MAIN_FOLDER_NAME: 'Aimex Dispatch Photos',
  TIMEZONE: 'Australia/Sydney'
};

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let dispatchSheet = ss.getSheetByName(CONFIG.DISPATCH_SHEET_NAME);
  if (!dispatchSheet) {
    dispatchSheet = ss.insertSheet(CONFIG.DISPATCH_SHEET_NAME);
  }
  formatDispatchSheet_(dispatchSheet);

  let productsSheet = ss.getSheetByName(CONFIG.PRODUCTS_SHEET_NAME);
  if (!productsSheet) {
    productsSheet = ss.insertSheet(CONFIG.PRODUCTS_SHEET_NAME);
  }
  formatProductsSheet_(productsSheet);

  let searchSheet = ss.getSheetByName(CONFIG.SEARCH_SHEET_NAME);
  if (!searchSheet) {
    searchSheet = ss.insertSheet(CONFIG.SEARCH_SHEET_NAME, 0);
  }
  formatSearchSheet_(searchSheet);

  const mainFolder = getOrCreateMainDriveFolder_();

  return {
    success: true,
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    driveFolderUrl: mainFolder.getUrl(),
    message: 'Aimex Dispatch Sheet and Drive folder initialized.'
  };
}

function formatDispatchSheet_(sheet) {
  const headers = [
    'Dispatch ID',
    'Logged Timestamp (AEST)',
    'Order Date',
    'Tracking Number',
    'Customer Name',
    'Products Packed',
    'Total Qty',
    'Staff Name',
    'Tracking Slip Photo',
    'Tracking Slip Preview',
    'Packaging Photos',
    'Packaging Preview',
    'Drive Folder',
    'Products JSON',
    'Order Number',
    'Carrier'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#001e34')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontFamily('Inter, Arial, sans-serif')
    .setFontSize(10)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');

  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1);

  const widths = [140, 160, 115, 185, 220, 300, 90, 150, 160, 110, 180, 110, 150, 180, 130, 140];
  widths.forEach((w, idx) => sheet.setColumnWidth(idx + 1, w));

  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), headers.length).createFilter();
  }
}

function formatProductsSheet_(sheet) {
  const headers = ['SKU', 'Product Name', 'Category', 'Default Unit', 'Active'];

  if (sheet.getLastRow() <= 1) {
    const starterProducts = getStarterCatalogRows_();
    const allRows = [headers].concat(starterProducts);
    sheet.getRange(1, 1, allRows.length, headers.length).setValues(allRows);
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#001e34')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle');

  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 380);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 85);
}

function formatSearchSheet_(sheet) {
  sheet.clear();

  sheet.getRange('A1:M1').merge()
    .setValue('AIMEX AUSTRALIA — DISPATCH SEARCH & LOG')
    .setBackground('#001e34')
    .setFontColor('#fdd400')
    .setFontWeight('bold')
    .setFontSize(13)
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 42);

  sheet.getRange('A3').setValue('Search:')
    .setFontWeight('bold')
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle')
    .setBackground('#f1f5f9');

  sheet.getRange('B3:D3').merge()
    .setValue('')
    .setBackground('#fefce8')
    .setBorder(true, true, true, true, false, false, '#ca8a04', SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setFontWeight('bold')
    .setFontSize(11)
    .setVerticalAlignment('middle')
    .setNote('Enter any Customer Name, Tracking Number, Order Date, Product/SKU, or Staff Name to filter.');

  sheet.getRange('E3:I3').merge()
    .setValue('Type Customer Name, Tracking #, Order Date, Product/SKU, or Staff Name in B3 (leave blank for all)')
    .setFontColor('#475569')
    .setFontStyle('italic')
    .setVerticalAlignment('middle');

  sheet.getRange('A4').setValue('Total Dispatches:').setFontWeight('bold').setHorizontalAlignment('right');
  sheet.getRange('B4').setFormula(`=COUNTA('${CONFIG.DISPATCH_SHEET_NAME}'!A2:A)`).setFontWeight('bold').setFontColor('#001e34').setHorizontalAlignment('left');

  sheet.getRange('C4').setValue('Total Units:').setFontWeight('bold').setHorizontalAlignment('right');
  sheet.getRange('D4').setFormula(`=SUM('${CONFIG.DISPATCH_SHEET_NAME}'!G2:G)`).setFontWeight('bold').setFontColor('#001e34').setHorizontalAlignment('left');

  sheet.setRowHeight(3, 34);
  sheet.setRowHeight(4, 28);

  const resultHeaders = [
    'Dispatch ID',
    'Logged Timestamp (AEST)',
    'Order Date',
    'Tracking Number',
    'Customer Name',
    'Products Packed',
    'Total Qty',
    'Staff Name',
    'Tracking Slip Photo',
    'Tracking Slip Preview',
    'Packaging Photos',
    'Packaging Preview',
    'Drive Folder'
  ];

  sheet.getRange(6, 1, 1, resultHeaders.length).setValues([resultHeaders])
    .setBackground('#0a2d47')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(6, 34);
  sheet.setFrozenRows(6);

  const dSheet = `'${CONFIG.DISPATCH_SHEET_NAME}'`;
  const searchFormula = `=IFERROR(SORT(FILTER(${dSheet}!A2:M, (${dSheet}!A2:A <> "") * (IF(ISBLANK(B3), TRUE, REGEXMATCH(LOWER(${dSheet}!A2:A & " " & ${dSheet}!C2:C & " " & ${dSheet}!D2:D & " " & ${dSheet}!E2:E & " " & ${dSheet}!F2:F & " " & ${dSheet}!H2:H), LOWER(TRIM(B3)))))), 2, FALSE), "No matching dispatches found.")`;
  sheet.getRange('A7').setFormula(searchFormula);

  const widths = [140, 160, 115, 185, 220, 300, 90, 150, 160, 110, 180, 110, 150];
  widths.forEach((w, idx) => sheet.setColumnWidth(idx + 1, w));
}

function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action || 'ping';
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'init') {
      return jsonResponse_(setupSheet());
    }

    if (action === 'products') {
      return jsonResponse_({
        success: true,
        products: getProductsList_(ss)
      });
    }

    if (action === 'search') {
      const query = (params.q || '').toLowerCase().trim();
      const limit = parseInt(params.limit || '50', 10);
      return jsonResponse_({
        success: true,
        dispatches: searchDispatches_(ss, query, limit)
      });
    }

    let dispatchSheet = ss.getSheetByName(CONFIG.DISPATCH_SHEET_NAME);
    if (!dispatchSheet) {
      setupSheet();
      dispatchSheet = ss.getSheetByName(CONFIG.DISPATCH_SHEET_NAME);
    }

    return jsonResponse_({
      success: true,
      status: 'connected',
      spreadsheetName: ss.getName(),
      spreadsheetUrl: ss.getUrl(),
      totalDispatches: Math.max(0, dispatchSheet.getLastRow() - 1),
      products: getProductsList_(ss)
    });
  } catch (err) {
    return jsonResponse_({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action || 'createDispatch';
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'initSheet') {
      return jsonResponse_(setupSheet());
    }

    if (action === 'addProduct') {
      let productsSheet = ss.getSheetByName(CONFIG.PRODUCTS_SHEET_NAME);
      if (!productsSheet) {
        setupSheet();
        productsSheet = ss.getSheetByName(CONFIG.PRODUCTS_SHEET_NAME);
      }
      const sku = (body.sku || '').trim() || ('AIM-' + Math.floor(100 + Math.random() * 900));
      const name = (body.name || '').trim();
      const category = (body.category || 'General').trim();
      const unit = (body.unit || 'Unit').trim();
      if (!name) {
        return jsonResponse_({ success: false, error: 'Product name is required' });
      }
      productsSheet.appendRow([sku, name, category, unit, 'TRUE']);
      return jsonResponse_({ success: true, products: getProductsList_(ss) });
    }

    if (action === 'sendDailySummary') {
      const seenEmails = {};
      const emailList = [];
      const addEmails = (raw) => {
        String(raw || '').split(/[,;]+/).forEach((part) => {
          const e = part.trim();
          if (e && !seenEmails[e.toLowerCase()]) {
            seenEmails[e.toLowerCase()] = true;
            emailList.push(e);
          }
        });
      };
      if (Array.isArray(body.recipients)) {
        body.recipients.forEach((r) => addEmails(typeof r === 'string' ? r : (r && r.email)));
      }
      addEmails(body.adminEmail);

      if (emailList.length === 0) {
        return jsonResponse_({ success: false, error: 'At least one recipient email is required.' });
      }
      const toAddress = emailList.join(',');
      const dateStr = String(body.date || Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd')).trim();
      const summary = body.summary || aggregateDayFromSheet_(ss, dateStr);
      sendSummaryEmail_(toAddress, dateStr, summary, ss.getUrl());
      return jsonResponse_({
        success: true,
        sentTo: emailList.join(', '),
        date: dateStr,
        totalOrders: summary.totalOrders || 0,
        totalUnits: summary.totalUnits || 0
      });
    }

    if (action === 'uploadDraftPhoto') {
      if (!body.imageBase64) {
        return jsonResponse_({ success: false, error: 'imageBase64 is required.' });
      }
      const draftsFolder = getOrCreateDraftsFolder_();
      const draftId = String(body.draftId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
      const saved = saveBase64ImageToFolder_(draftsFolder, body.imageBase64, `Draft_${draftId}.jpg`);
      if (!saved) {
        return jsonResponse_({ success: false, error: 'Failed to save draft photo to Drive.' });
      }
      return jsonResponse_({ success: true, draftId: draftId, fileId: saved.id, url: saved.url });
    }

    if (action === 'deleteDraftPhoto') {
      const fileId = String(body.fileId || '').trim();
      if (fileId) {
        try {
          DriveApp.getFileById(fileId).setTrashed(true);
        } catch (e) {}
      }
      return jsonResponse_({ success: true });
    }

    if (action === 'createDispatch') {
      let dispatchSheet = ss.getSheetByName(CONFIG.DISPATCH_SHEET_NAME);
      if (!dispatchSheet) {
        setupSheet();
        dispatchSheet = ss.getSheetByName(CONFIG.DISPATCH_SHEET_NAME);
      }

      const now = new Date();
      const timestampStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
      const dateFolderPrefix = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy-MM-dd');

      const dispatchId = body.dispatchId || ('DSP-' + Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss'));
      const orderNumber = String(body.orderNumber || '').trim();
      const orderDate = (body.orderDate || dateFolderPrefix).trim();
      const trackingNumber = (body.trackingNumber || body.connote || '').trim();
      const carrier = String(body.carrier || '').trim();
      const customerName = (body.customerName || '').trim();
      const staffName = (body.staffName || body.staffMember || '').trim();
      const products = Array.isArray(body.products) ? body.products : [];

      let totalQty = 0;
      const productLines = products.map((p) => {
        const q = Number(p.quantity) || 1;
        totalQty += q;
        const skuPart = p.sku ? `[${p.sku}] ` : '';
        const locPart = p.location ? ` (Loc: ${String(p.location).trim()})` : '';
        return `${q}x ${skuPart}${p.name}${locPart}`;
      });
      const productsSummary = productLines.join('\n');

      const mainFolder = getOrCreateMainDriveFolder_();
      const safeTrack = (trackingNumber || dispatchId).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 35);
      const safeCustomer = (customerName || 'Customer').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 25);
      const folderName = `${orderDate}_${safeTrack}_${safeCustomer}`;
      const dispatchFolder = mainFolder.createFolder(folderName);

      try {
        dispatchFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (sharingErr) {
        try {
          dispatchFolder.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (e2) {}
      }

      let trackingSlipDriveUrl = '';
      let trackingSlipThumbId = '';

      if (body.preUploadedTrackingSlip && body.preUploadedTrackingSlip.fileId) {
        try {
          const slipFile = DriveApp.getFileById(String(body.preUploadedTrackingSlip.fileId));
          slipFile.moveTo(dispatchFolder);
          slipFile.setName(`TrackingSlip_${safeTrack}.jpg`);
          trackingSlipDriveUrl = slipFile.getUrl();
          trackingSlipThumbId = slipFile.getId();
        } catch (e) {
          if (body.preUploadedTrackingSlip.url) {
            trackingSlipDriveUrl = String(body.preUploadedTrackingSlip.url);
          }
        }
      } else if (body.trackingSlipImage) {
        const savedSlip = saveBase64ImageToFolder_(
          dispatchFolder,
          body.trackingSlipImage,
          `TrackingSlip_${safeTrack}.jpg`
        );
        if (savedSlip) {
          trackingSlipDriveUrl = savedSlip.url;
          trackingSlipThumbId = savedSlip.id;
        }
      }

      const packagingDriveUrls = [];
      let firstPackagingThumbId = '';

      if (Array.isArray(body.preUploadedPackaging)) {
        const moved = moveDraftFilesToFolder_(dispatchFolder, body.preUploadedPackaging, safeTrack, 1);
        moved.urls.forEach((u) => packagingDriveUrls.push(u));
        if (moved.firstThumbId) firstPackagingThumbId = moved.firstThumbId;
      }

      if (Array.isArray(body.packagingImages)) {
        const offset = packagingDriveUrls.length;
        body.packagingImages.forEach((imgBase64, index) => {
          if (!imgBase64) return;
          const savedPkg = saveBase64ImageToFolder_(
            dispatchFolder,
            imgBase64,
            `Packaging_${offset + index + 1}_${safeTrack}.jpg`
          );
          if (savedPkg) {
            packagingDriveUrls.push(savedPkg.url);
            if (!firstPackagingThumbId) {
              firstPackagingThumbId = savedPkg.id;
            }
          }
        });
      }

      const nextRow = dispatchSheet.getLastRow() + 1;

      const rowValues = [
        dispatchId,
        timestampStr,
        orderDate,
        trackingNumber,
        customerName,
        productsSummary,
        totalQty,
        staffName,
        trackingSlipDriveUrl || 'None',
        '',
        packagingDriveUrls.join('\n') || 'None',
        '',
        dispatchFolder.getUrl(),
        JSON.stringify(products),
        orderNumber,
        carrier
      ];

      dispatchSheet.getRange(nextRow, 1, 1, rowValues.length).setValues([rowValues]);

      if (trackingSlipDriveUrl) {
        dispatchSheet.getRange(nextRow, 9).setFormula(
          `=HYPERLINK("${trackingSlipDriveUrl}", "View Tracking Slip")`
        );
      }
      if (trackingSlipThumbId) {
        dispatchSheet.getRange(nextRow, 10).setFormula(
          `=IMAGE("https://drive.google.com/thumbnail?id=${trackingSlipThumbId}&sz=w400")`
        );
      }

      if (packagingDriveUrls.length > 0) {
        if (packagingDriveUrls.length === 1) {
          dispatchSheet.getRange(nextRow, 11).setFormula(
            `=HYPERLINK("${packagingDriveUrls[0]}", "View Packaging Photo")`
          );
        } else {
          dispatchSheet.getRange(nextRow, 11).setValue(packagingDriveUrls.join('\n'));
        }
      }
      if (firstPackagingThumbId) {
        dispatchSheet.getRange(nextRow, 12).setFormula(
          `=IMAGE("https://drive.google.com/thumbnail?id=${firstPackagingThumbId}&sz=w400")`
        );
      }

      dispatchSheet.getRange(nextRow, 13).setFormula(
        `=HYPERLINK("${dispatchFolder.getUrl()}", "Open Folder (${(trackingSlipDriveUrl ? 1 : 0) + packagingDriveUrls.length})")`
      );

      dispatchSheet.setRowHeight(nextRow, 72);
      dispatchSheet.getRange(nextRow, 1, 1, rowValues.length).setVerticalAlignment('middle');
      dispatchSheet.getRange(nextRow, 4).setFontFamily('Roboto Mono, Courier New, monospace').setFontWeight('bold');

      return jsonResponse_({
        success: true,
        dispatchId: dispatchId,
        rowNumber: nextRow,
        timestamp: timestampStr,
        driveFolderUrl: dispatchFolder.getUrl(),
        trackingSlipUrl: trackingSlipDriveUrl,
        packagingImageUrls: packagingDriveUrls
      });
    }

    if (action === 'deleteDispatch') {
      const dispatchId = String(body.dispatchId || '').trim();
      if (!dispatchId) {
        return jsonResponse_({ success: false, error: 'dispatchId is required.' });
      }
      const dispatchSheet = ss.getSheetByName(CONFIG.DISPATCH_SHEET_NAME);
      if (!dispatchSheet || dispatchSheet.getLastRow() < 2) {
        return jsonResponse_({ success: true, deleted: false, message: 'Dispatch sheet is empty.' });
      }
      const lastRow = dispatchSheet.getLastRow();
      const ids = dispatchSheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
      let deleted = false;
      for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0] || '').trim() === dispatchId) {
          dispatchSheet.deleteRow(i + 2);
          deleted = true;
          break;
        }
      }
      return jsonResponse_({ success: true, deleted: deleted, dispatchId: dispatchId });
    }

    if (action === 'updateDispatch') {
      const dispatchId = String(body.dispatchId || '').trim();
      if (!dispatchId) {
        return jsonResponse_({ success: false, error: 'dispatchId is required.' });
      }
      const dispatchSheet = ss.getSheetByName(CONFIG.DISPATCH_SHEET_NAME);
      if (!dispatchSheet || dispatchSheet.getLastRow() < 2) {
        return jsonResponse_({ success: false, error: 'Dispatch sheet is empty.' });
      }

      const lastRow = dispatchSheet.getLastRow();
      const ids = dispatchSheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
      let targetRow = -1;
      for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0] || '').trim() === dispatchId) {
          targetRow = i + 2;
          break;
        }
      }
      if (targetRow === -1) {
        return jsonResponse_({ success: false, error: 'Dispatch not found in sheet: ' + dispatchId });
      }

      const orderNumber = String(body.orderNumber || '').trim();
      const orderDate = String(body.orderDate || '').trim();
      const trackingNumber = String(body.trackingNumber || body.connote || '').trim();
      const carrier = String(body.carrier || '').trim();
      const customerName = String(body.customerName || '').trim();
      const staffName = String(body.staffName || body.staffMember || '').trim();
      const products = Array.isArray(body.products) ? body.products : [];

      let totalQty = 0;
      const productLines = products.map((p) => {
        const q = Number(p.quantity) || 1;
        totalQty += q;
        const skuPart = p.sku ? `[${p.sku}] ` : '';
        const locPart = p.location ? ` (Loc: ${String(p.location).trim()})` : '';
        return `${q}x ${skuPart}${p.name}${locPart}`;
      });
      const productsSummary = productLines.join('\n');

      if (orderDate) dispatchSheet.getRange(targetRow, 3).setValue(orderDate);
      dispatchSheet.getRange(targetRow, 4).setValue(trackingNumber);
      dispatchSheet.getRange(targetRow, 5).setValue(customerName);
      dispatchSheet.getRange(targetRow, 6).setValue(productsSummary);
      dispatchSheet.getRange(targetRow, 7).setValue(totalQty);
      dispatchSheet.getRange(targetRow, 8).setValue(staffName);
      dispatchSheet.getRange(targetRow, 14).setValue(JSON.stringify(products));
      dispatchSheet.getRange(targetRow, 15).setValue(orderNumber);
      dispatchSheet.getRange(targetRow, 16).setValue(carrier);

      // Attach any newly added photos into the dispatch's Drive folder if provided
      let driveFolderUrl = '';
      const existingFormula = String(dispatchSheet.getRange(targetRow, 13).getFormula() || dispatchSheet.getRange(targetRow, 13).getValue() || '');
      const urlMatch = existingFormula.match(/https:\/\/drive\.google\.com\/[^\s"']+/);
      if (urlMatch) driveFolderUrl = urlMatch[0];

      const hasNewSlip = Boolean(body.trackingSlipImage);
      const hasNewPkg =
        (Array.isArray(body.preUploadedPackaging) && body.preUploadedPackaging.length > 0) ||
        (Array.isArray(body.packagingImages) && body.packagingImages.length > 0);

      if (hasNewSlip || hasNewPkg) {
        let dispatchFolder = null;
        const folderIdMatch = driveFolderUrl.match(/[-\w]{25,}/);
        if (folderIdMatch) {
          try {
            dispatchFolder = DriveApp.getFolderById(folderIdMatch[0]);
          } catch (e) {}
        }
        if (!dispatchFolder) {
          const mainFolder = getOrCreateMainDriveFolder_();
          const safeTrack = (trackingNumber || dispatchId).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 35);
          const safeCustomer = (customerName || 'Customer').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 25);
          dispatchFolder = mainFolder.createFolder(`${orderDate || 'Updated'}_${safeTrack}_${safeCustomer}`);
          try {
            dispatchFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          } catch (e) {}
          driveFolderUrl = dispatchFolder.getUrl();
          dispatchSheet.getRange(targetRow, 13).setFormula(`=HYPERLINK("${driveFolderUrl}", "Open Folder")`);
        }

        const safeTrack = (trackingNumber || dispatchId).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 35);
        if (hasNewSlip) {
          const savedSlip = saveBase64ImageToFolder_(dispatchFolder, body.trackingSlipImage, `TrackingSlip_${safeTrack}.jpg`);
          if (savedSlip) {
            dispatchSheet.getRange(targetRow, 9).setFormula(`=HYPERLINK("${savedSlip.url}", "View Tracking Slip")`);
            dispatchSheet.getRange(targetRow, 10).setFormula(`=IMAGE("https://drive.google.com/thumbnail?id=${savedSlip.id}&sz=w400")`);
          }
        }
        if (hasNewPkg) {
          const addedUrls = [];
          let firstNewThumb = '';
          if (Array.isArray(body.preUploadedPackaging)) {
            const moved = moveDraftFilesToFolder_(dispatchFolder, body.preUploadedPackaging, safeTrack, 1);
            moved.urls.forEach((u) => addedUrls.push(u));
            if (moved.firstThumbId) firstNewThumb = moved.firstThumbId;
          }
          if (Array.isArray(body.packagingImages)) {
            body.packagingImages.forEach((imgB64, idx) => {
              if (!imgB64) return;
              const savedPkg = saveBase64ImageToFolder_(dispatchFolder, imgB64, `Packaging_${addedUrls.length + idx + 1}_${safeTrack}.jpg`);
              if (savedPkg) {
                addedUrls.push(savedPkg.url);
                if (!firstNewThumb) firstNewThumb = savedPkg.id;
              }
            });
          }
          if (addedUrls.length > 0 && !String(dispatchSheet.getRange(targetRow, 12).getFormula() || '')) {
            dispatchSheet.getRange(targetRow, 11).setValue(addedUrls.join('\n'));
            if (firstNewThumb) {
              dispatchSheet.getRange(targetRow, 12).setFormula(`=IMAGE("https://drive.google.com/thumbnail?id=${firstNewThumb}&sz=w400")`);
            }
          }
        }
      }

      return jsonResponse_({
        success: true,
        dispatchId: dispatchId,
        rowNumber: targetRow,
        driveFolderUrl: driveFolderUrl
      });
    }

    return jsonResponse_({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse_({ success: false, error: err.toString() });
  }
}

function detectCarrierFallback_(carrierVal, trackingNumber) {
  const raw = String(carrierVal || '').trim();
  if (raw) return raw;
  const code = String(trackingNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return 'Unspecified';
  if (/^CP[A-Z0-9]{6,}$/.test(code)) return 'CouriersPlease';
  if (/^997\d{15,22}$/.test(code) || /^\d{2}[A-Z]{2,3}\d{7,20}$/.test(code)) return 'Australia Post';
  if (/^G[ED]\d{9}(?:AU)?$/.test(code)) return 'TNT / FedEx';
  if (/^[A-Z]{2}\d{9}AU$/.test(code)) return 'Australia Post';
  if (/^(?:MP|FW|QQ|AZ|NZ|RZ|SZ|PX|CW|SY|ML|BN)\d{10}$/.test(code)) return 'Aramex';
  if (/^(?:JD01|JJD|GM)\d{10,20}$/.test(code)) return 'DHL';
  return 'Unspecified';
}

/**
 * Aggregates all products packaged for a given YYYY-MM-DD date from the Dispatches sheet.
 */
function aggregateDayFromSheet_(ss, dateStr) {
  const sheet = ss.getSheetByName(CONFIG.DISPATCH_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    return { date: dateStr, totalOrders: 0, totalUnits: 0, byCourier: [], entries: [], products: [], byStaff: [] };
  }

  const numCols = Math.max(16, sheet.getLastColumn());
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getDisplayValues();
  const productMap = {};
  const staffMap = {};
  const courierMap = {};
  const entries = [];
  let totalOrders = 0;
  let totalUnits = 0;

  values.forEach((r) => {
    const loggedFull = String(r[1] || '').trim();
    const loggedDate = loggedFull.slice(0, 10);
    const orderDate = String(r[2] || '').slice(0, 10);
    if (loggedDate !== dateStr && orderDate !== dateStr) return;

    const timeMatch = loggedFull.match(/\b(\d{2}:\d{2})/);
    const loggedTime = timeMatch ? timeMatch[1] : '-';

    totalOrders++;
    const resolvedCarrier = detectCarrierFallback_(r[15], r[3]);
    if (!courierMap[resolvedCarrier]) {
      courierMap[resolvedCarrier] = { carrier: resolvedCarrier, parcels: 0 };
    }
    courierMap[resolvedCarrier].parcels++;

    const staff = String(r[7] || 'Unknown').trim() || 'Unknown';
    if (!staffMap[staff]) staffMap[staff] = { staffName: staff, orders: 0, units: 0 };
    staffMap[staff].orders++;

    let prods = [];
    try {
      prods = JSON.parse(r[13] || '[]');
    } catch (e) {}

    prods.forEach((p) => {
      const qty = Math.max(0, Number(p.quantity) || 0);
      const sku = String(p.sku || '').trim();
      const name = String(p.name || '').trim();
      const location = String(p.location || '').trim();
      if (!name || !qty) return;

      totalUnits += qty;
      staffMap[staff].units += qty;

      entries.push({
        time: loggedTime,
        sku: sku,
        name: name,
        quantity: qty,
        location: location || '-'
      });

      const key = (sku + '::' + name).toLowerCase();
      if (!productMap[key]) {
        productMap[key] = { sku: sku, name: name, quantity: 0, locations: {} };
      }
      productMap[key].quantity += qty;
      if (location) productMap[key].locations[location] = true;
    });
  });

  const products = Object.values(productMap)
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      quantity: p.quantity,
      location: Object.keys(p.locations).join(', ') || '-'
    }))
    .sort((a, b) => b.quantity - a.quantity);
  const byStaff = Object.values(staffMap).sort((a, b) => b.units - a.units);
  const byCourier = Object.values(courierMap).sort((a, b) => b.parcels - a.parcels);

  return {
    date: dateStr,
    totalOrders: totalOrders,
    totalUnits: totalUnits,
    byCourier: byCourier,
    entries: entries,
    products: products,
    byStaff: byStaff
  };
}

/**
 * Formats and sends the daily Aimex dispatch summary email via MailApp.
 */
function sendSummaryEmail_(adminEmail, dateStr, summary, sheetUrl) {
  const products = Array.isArray(summary.products) ? summary.products : [];
  const entries = (Array.isArray(summary.entries) && summary.entries.length > 0)
    ? summary.entries
    : products.map((p) => ({
        time: p.time || '-',
        sku: p.sku || '',
        name: p.name || '',
        quantity: p.quantity || 0,
        location: p.location || '-'
      }));
  const byStaff = Array.isArray(summary.byStaff) ? summary.byStaff : [];
  const byCourier = Array.isArray(summary.byCourier) ? summary.byCourier : [];
  const totalOrders = summary.totalOrders || 0;
  const totalUnits = summary.totalUnits || 0;

  const subject = `Aimex Daily Dispatch Summary — ${dateStr} (${totalUnits} units / ${totalOrders} orders)`;

  const plainLines = [
    `AIMEX AUSTRALIA — DAILY DISPATCH SUMMARY (${dateStr})`,
    `Total Orders: ${totalOrders}`,
    `Total Units Packaged: ${totalUnits}`,
    ''
  ];

  plainLines.push('PARCELS DISPATCHED BY COURIER:');
  if (byCourier.length === 0) {
    plainLines.push('  No parcels dispatched today.');
  } else {
    byCourier.forEach((c) => {
      plainLines.push(`  - ${c.carrier || 'Unspecified'}: ${c.parcels} parcel(s)`);
    });
  }
  plainLines.push('');

  plainLines.push('PRODUCTS PACKAGED (Time | Product | Quantity | Location):');

  if (entries.length === 0) {
    plainLines.push('  No products packaged today.');
  } else {
    entries.forEach((e) => {
      const skuPart = e.sku ? `[${e.sku}] ` : '';
      plainLines.push(`  - ${e.time || '-'} | ${skuPart}${e.name} | Qty: ${e.quantity} | Location: ${e.location || '-'}`);
    });
  }

  if (byStaff.length > 0) {
    plainLines.push('', 'BY STAFF:');
    byStaff.forEach((s) => {
      plainLines.push(`  - ${s.staffName}: ${s.orders} orders (${s.units} units)`);
    });
  }

  plainLines.push('', 'COURIER PARCEL TOTALS:');
  if (byCourier.length === 0) {
    plainLines.push('  No parcels dispatched today.');
  } else {
    byCourier.forEach((c) => {
      plainLines.push(`  - ${c.carrier || 'Unspecified'}: ${c.parcels} parcel(s)`);
    });
  }

  if (sheetUrl) {
    plainLines.push('', `Google Sheet: ${sheetUrl}`);
  }

  const tableRowsHtml = entries.length === 0
    ? '<tr><td colspan="4" style="padding:12px;color:#64748b;text-align:center;">No products packaged today.</td></tr>'
    : entries.map((e) => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-family:monospace;color:#334155;white-space:nowrap;">${escapeHtml_(e.time || '-')}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#001e34;">
          <div style="font-weight:600;">${escapeHtml_(e.name)}</div>
          ${e.sku ? `<div style="font-size:11px;font-family:monospace;color:#64748b;">${escapeHtml_(e.sku)}</div>` : ''}
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#001e34;">${e.quantity}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;color:#334155;">${escapeHtml_(e.location || '-')}</td>
      </tr>
    `).join('');

  const staffRowsHtml = byStaff.map((s) => `
    <tr>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;color:#001e34;">${escapeHtml_(s.staffName)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${s.orders}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">${s.units}</td>
    </tr>
  `).join('');

  const courierRowsHtml = byCourier.length === 0
    ? '<tr><td colspan="2" style="padding:10px 12px;color:#64748b;text-align:center;">No parcels dispatched today.</td></tr>'
    : byCourier.map((c) => `
      <tr>
        <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;color:#001e34;font-weight:600;">${escapeHtml_(c.carrier || 'Unspecified')}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#001e34;">${c.parcels}</td>
      </tr>
    `).join('');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
      <div style="background:#001e34;color:#ffffff;padding:18px 22px;border-bottom:3px solid #fdd400;">
        <div style="font-size:12px;letter-spacing:2px;color:#fdd400;font-weight:bold;">AIMEX AUSTRALIA</div>
        <h2 style="margin:4px 0 0;font-size:19px;">Daily Dispatch Summary — ${escapeHtml_(dateStr)}</h2>
      </div>
      <div style="padding:18px 22px;background:#ffffff;">
        <p style="margin:0 0 16px;color:#334155;font-size:14px;">
          <strong>Total Orders:</strong> ${totalOrders} &nbsp;|&nbsp;
          <strong>Total Units Packaged:</strong> ${totalUnits}
        </p>

        <h3 style="margin:0 0 8px;font-size:14px;color:#001e34;text-transform:uppercase;">Parcels Dispatched by Courier</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
          <thead>
            <tr style="background:#fef9c3;color:#001e34;text-align:left;">
              <th style="padding:8px 12px;">Courier</th>
              <th style="padding:8px 12px;text-align:right;">Parcels</th>
            </tr>
          </thead>
          <tbody>${courierRowsHtml}</tbody>
        </table>

        <h3 style="margin:0 0 8px;font-size:14px;color:#001e34;text-transform:uppercase;">Products Packaged</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
          <thead>
            <tr style="background:#f1f5f9;color:#475569;text-align:left;">
              <th style="padding:8px 12px;">Time</th>
              <th style="padding:8px 12px;">Product</th>
              <th style="padding:8px 12px;text-align:right;">Quantity</th>
              <th style="padding:8px 12px;">Location</th>
            </tr>
          </thead>
          <tbody>${tableRowsHtml}</tbody>
        </table>

        ${byStaff.length > 0 ? `
          <h3 style="margin:0 0 8px;font-size:14px;color:#001e34;text-transform:uppercase;">Staff Breakdown</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
            <thead>
              <tr style="background:#f1f5f9;color:#475569;text-align:left;">
                <th style="padding:8px 12px;">Staff</th>
                <th style="padding:8px 12px;text-align:right;">Orders</th>
                <th style="padding:8px 12px;text-align:right;">Units</th>
              </tr>
            </thead>
            <tbody>${staffRowsHtml}</tbody>
          </table>
        ` : ''}

        <h3 style="margin:0 0 8px;font-size:14px;color:#001e34;text-transform:uppercase;">Courier Parcel Totals</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
          <thead>
            <tr style="background:#fef9c3;color:#001e34;text-align:left;">
              <th style="padding:8px 12px;">Courier</th>
              <th style="padding:8px 12px;text-align:right;">Parcels</th>
            </tr>
          </thead>
          <tbody>${courierRowsHtml}</tbody>
        </table>

        ${sheetUrl ? `<p style="margin:12px 0 0;"><a href="${sheetUrl}" style="display:inline-block;background:#001e34;color:#fdd400;text-decoration:none;padding:9px 14px;border-radius:6px;font-weight:bold;font-size:13px;">Open Google Sheet</a></p>` : ''}
      </div>
    </div>
  `;

  MailApp.sendEmail({
    to: adminEmail,
    subject: subject,
    body: plainLines.join('\n'),
    htmlBody: htmlBody
  });
}

function escapeHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getProductsList_(ss) {
  let sheet = ss.getSheetByName(CONFIG.PRODUCTS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  const products = [];
  values.forEach((row) => {
    const sku = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const category = String(row[2] || '').trim();
    const unit = String(row[3] || 'Unit').trim();
    const active = String(row[4] || 'TRUE').toUpperCase() !== 'FALSE';
    if (name && active) {
      products.push({ sku, name, category, unit });
    }
  });
  return products;
}

function searchDispatches_(ss, query, limit) {
  const sheet = ss.getSheetByName(CONFIG.DISPATCH_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const numCols = Math.max(16, sheet.getLastColumn());
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getDisplayValues();
  const results = [];

  for (let i = values.length - 1; i >= 0; i--) {
    const r = values[i];
    if (!query || r.join(' ').toLowerCase().indexOf(query) !== -1) {
      let parsedProducts = [];
      try {
        parsedProducts = JSON.parse(r[13] || '[]');
      } catch (e) {}
      results.push({
        dispatchId: r[0],
        orderNumber: r[14] || '',
        carrier: r[15] || '',
        timestamp: r[1],
        orderDate: r[2],
        trackingNumber: r[3],
        customerName: r[4],
        productsSummary: r[5],
        totalQty: Number(r[6]) || 0,
        staffName: r[7],
        driveFolderUrl: r[12],
        products: Array.isArray(parsedProducts) ? parsedProducts : []
      });
      if (results.length >= limit) break;
    }
  }
  return results;
}

function getOrCreateMainDriveFolder_() {
  const folders = DriveApp.getFoldersByName(CONFIG.DRIVE_MAIN_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(CONFIG.DRIVE_MAIN_FOLDER_NAME);
}

function getOrCreateDraftsFolder_() {
  const main = getOrCreateMainDriveFolder_();
  const subs = main.getFoldersByName('_Drafts');
  if (subs.hasNext()) return subs.next();
  return main.createFolder('_Drafts');
}

function moveDraftFilesToFolder_(dispatchFolder, preUploadedList, safeTrack, startIndex) {
  const urls = [];
  let firstThumbId = '';
  let idx = startIndex || 1;
  (preUploadedList || []).forEach((item) => {
    if (!item || !item.fileId) return;
    try {
      const file = DriveApp.getFileById(String(item.fileId));
      file.moveTo(dispatchFolder);
      file.setName(`Packaging_${idx}_${safeTrack}.jpg`);
      urls.push(file.getUrl());
      if (!firstThumbId) firstThumbId = file.getId();
      idx++;
    } catch (e) {
      if (item.url) {
        urls.push(item.url);
        idx++;
      }
    }
  });
  return { urls: urls, firstThumbId: firstThumbId };
}

function saveBase64ImageToFolder_(folder, dataUrl, filename) {
  try {
    let mimeType = 'image/jpeg';
    let base64Data = dataUrl;
    if (dataUrl.indexOf('base64,') !== -1) {
      const parts = dataUrl.split('base64,');
      base64Data = parts[1];
      const mimeMatch = parts[0].match(/data:(.*?);/);
      if (mimeMatch && mimeMatch[1]) mimeType = mimeMatch[1];
    }
    const decoded = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decoded, mimeType, filename);
    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {}
    return { id: file.getId(), url: file.getUrl() };
  } catch (err) {
    Logger.log('Error saving image: ' + err);
    return null;
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getStarterCatalogRows_() {
  return [
    ['AIM310FS', 'Free Standing Cooler Black and Silver', 'Water Coolers', 'Unit', 'TRUE'],
    ['AIM310TB', 'Bench Top Cooler Black and Silver', 'Water Coolers', 'Unit', 'TRUE'],
    ['AIME20', 'E20', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMG128STAGE', 'G12 With 3 8 Stage Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMG12AA', 'G12 With 3 AA Stage Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMG12WHITE', 'G12 With 3 White Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMEXA20', 'A20 With 3 8 Stage Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMG124X', 'G12 With 4 8 Stage Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMA20AA', 'A20 With 3 AA Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMA20WHITE', 'A20 With 3 White Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMA204X', 'A20 With 4 8 Stage Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMA204XAA', 'A20 With 4 AA Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMA204WHITE', 'A20 With 4 White Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMG124AA', 'G12 With 4 AA Filters', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIMG124XWHITE', 'G12 With 4 White Filters', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIME20AA', 'E20 AA', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIME20WHITE', 'E20 White', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['AIM8STAGE', '8 Stage Filter X 1', 'Filters', 'Pack', 'TRUE'],
    ['AIM8STG2', '8 Stage Filter X 2', 'Filters', 'Pack', 'TRUE'],
    ['AIM8STG3', '8 Stage Filter X 3', 'Filters', 'Pack', 'TRUE'],
    ['AIM8STG4', '8 Stage Filter X 4', 'Filters', 'Pack', 'TRUE'],
    ['AIM8STG5', '8 Stage Filter X 5', 'Filters', 'Pack', 'TRUE'],
    ['AIM8STG6', '8 Stage Filter X 6', 'Filters', 'Pack', 'TRUE'],
    ['AIMAA1', 'AA Filter X 1', 'Filters', 'Pack', 'TRUE'],
    ['AIMAA2', 'AA Filter X 2', 'Filters', 'Pack', 'TRUE'],
    ['AIMAA3', 'AA Filter X 3', 'Filters', 'Pack', 'TRUE'],
    ['AIMAA4', 'AA Filter X 4', 'Filters', 'Pack', 'TRUE'],
    ['AIMAA5', 'AA Filter X 5', 'Filters', 'Pack', 'TRUE'],
    ['AIMAA6', 'AA Filter X 6', 'Filters', 'Pack', 'TRUE'],
    ['AIMWHT1', 'White Filter X 1', 'Filters', 'Pack', 'TRUE'],
    ['AIMWHT2', 'White Filter X 2', 'Filters', 'Pack', 'TRUE'],
    ['AIMWHT3', 'White Filter X 3', 'Filters', 'Pack', 'TRUE'],
    ['AIMWHT4', 'White Filter X 4', 'Filters', 'Pack', 'TRUE'],
    ['AIMWHT5', 'White Filter X 5', 'Filters', 'Pack', 'TRUE'],
    ['AIMWHT6', 'White Filter X 6', 'Filters', 'Pack', 'TRUE'],
    ['AIMFLOAT', 'Float Valve', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMPLDOME', 'Plastic Dome', 'Filters & Domes', 'Unit', 'TRUE'],
    ['AIMMAIFAN', 'Maifan Stone', 'Filters & Domes', 'Unit', 'TRUE'],
    ['AIMEXL630', 'L630', 'Portable Filters', 'Unit', 'TRUE'],
    ['AIMEXL600', 'L600', 'Portable Filters', 'Unit', 'TRUE'],
    ['AIMWHITEPITCH', 'White Pitcher', 'Pitchers', 'Unit', 'TRUE'],
    ['AIMPITFILTER1', 'Pitcher Filter X 1', 'Pitchers', 'Pack', 'TRUE'],
    ['AIMPITFILTER2', 'Pitcher Filter X 2', 'Pitchers', 'Pack', 'TRUE'],
    ['AIMPITFILTER3', 'Pitcher Filter X 3', 'Pitchers', 'Pack', 'TRUE'],
    ['vacuuminsulate', 'Vacuum Insulated Lunch Box', 'Lunch Boxes & Home', 'Unit', 'TRUE'],
    ['FOODJAR', 'Mari Food Jar', 'Lunch Boxes & Home', 'Unit', 'TRUE'],
    ['AIMWHITEPITCH3FILTR', 'White Pitcher with 3 filters', 'Pitchers', 'Unit', 'TRUE'],
    ['AIMTAPMAG', 'Tap - Magnetic', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMEX8STG12', '8 Stage Filter X 12', 'Filters', 'Pack', 'TRUE'],
    ['Pads', 'Aimex Felt Pads', 'Parts & Accessories', 'Pack', 'TRUE'],
    ['OZ105', 'Thermometer Forehead and ear (Green box) OZ105', 'Health', 'Unit', 'TRUE'],
    ['OZ102', 'Thermometer Forehead (Blue box) OZ102', 'Health', 'Unit', 'TRUE'],
    ['AIMCARAVAN', 'Caravan Bundle', 'Car & Marine Care', 'Bundle', 'TRUE'],
    ['AIMA20LOWERTNK', 'A20 Lower Tank', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['MARIBLUEBENTO', 'BLUE Lunch Box', 'Lunch Boxes & Home', 'Unit', 'TRUE'],
    ['AIMEXPPSEDIMENT', 'PP Filter Sediment', 'Filters', 'Unit', 'TRUE'],
    ['AIM8STG&', '8 Stage Filter X 7', 'Filters', 'Pack', 'TRUE'],
    ['AIMRUBYRED', 'Ruby Red Car Wheel Cleaner', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['AIMJU309500', 'Ceramic Glaze', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['AIMJU265500', 'Waterless Xpress 500ml', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['WWW1', 'Xpress CarWash with 2X Microfibre Cloth', 'Car & Marine Care', 'Pack', 'TRUE'],
    ['MARIDUALSS', 'Mari Twin Pack Vacuum Insulated Lunch Box', 'Lunch Boxes & Home', 'Pack', 'TRUE'],
    ['AIMG12LWRTNK', 'G12 Lower Tank', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['Washer', 'Aimex washer', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMPP5MICRON', 'PP Filter', 'Filters', 'Unit', 'TRUE'],
    ['AIME20LOWER', 'E20 Lower Tank', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMCARKT7', 'Car Kit 7 Pcs', 'Car & Marine Care', 'Kit', 'TRUE'],
    ['AIMG12UPPER', 'G12 Upper Tank', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMAA7', 'AA Filter X 7', 'Filters', 'Pack', 'TRUE'],
    ['AIMAA12', 'AA Filter X 12', 'Filters', 'Pack', 'TRUE'],
    ['AIMCERAMICDM', 'Ceramic Dome', 'Filters & Domes', 'Unit', 'TRUE'],
    ['AIMHOTTNK', 'Hot Water Tank', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMSEALNSHINE', 'Seal & Shine 500 ml', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['AIMA20UPPER', 'A20 Upper Tank', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMMAXFOAM', 'Max Foam Shampoo', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['AIMEXE20UP', 'E20 Upper Tank', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMEXAA10', 'AA Filter X 10', 'Filters', 'Pack', 'TRUE'],
    ['AIMGREYADT', 'Grey Adapter For Cooler', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIM8STG8', '8 Stage Filter X 8', 'Filters', 'Pack', 'TRUE'],
    ['AIMEXA20MIDLERING', 'A20 Middle Ring', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIM8STAGE9', '8 Stage Filter X 9', 'Filters', 'Pack', 'TRUE'],
    ['AIMAA9X', 'AA Filter X 9', 'Filters', 'Pack', 'TRUE'],
    ['AIMEXLEATHERSHIELD', 'LEATHER FEED', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['AIMSSGRVT8STG', 'Aimex Water SS304 Gravity Multi-Stage Purifier', 'Stainless Steel Purifiers', 'Unit', 'TRUE'],
    ['AIMEXSSFLUORIDE', 'Aimex Water SS304 Fluoride Gravity Multi-Stage Purifier', 'Stainless Steel Purifiers', 'Unit', 'TRUE'],
    ['AIMEXSSWHITE', 'Aimex Water SS304 White Gravity Multi-Stage Purifier', 'Stainless Steel Purifiers', 'Unit', 'TRUE'],
    ['AIMEXCOOLERTAP', 'TAP FOR AIMEX WATER COOLER FREE STANDING AND BENCH TOP', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['LCPCG', 'Lyocell Pillow Cover Grey', 'Lunch Boxes & Home', 'Unit', 'TRUE'],
    ['LCPCW', 'Lyocell Pillow Cover White', 'Lunch Boxes & Home', 'Unit', 'TRUE'],
    ['AIMEXBASERINGSS', 'Base Ring for SS Unit', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMEXSSBOTTOMTNK', 'SS Bottom Tank', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMEXWATERLESS5L', 'Water Less Wax 5 L', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['AIMEXSSGVITWASHER', 'Aimex SS Gravity Washer', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMEX8STG10', '8 Stage Filter X 10', 'Filters', 'Pack', 'TRUE'],
    ['AIMEXACB', 'ACB Block for SS Gravity', 'Filters', 'Unit', 'TRUE'],
    ['G12MR', 'Middle Ring G12', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['G12LID', 'Lid G12', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['G12BSTAND', 'Bottom Stand G12', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMRINSENSHINE', 'Rinse & Shine 217-500', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['DB34', 'Alloy Wheel Protector', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['AIMEXBOTTOMA20', 'A20 Bottom Stand', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMEXKSD301ND301G', 'Switches KSD 301 and 301G', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMEXACB3', 'ACB Block for SS Gravity X 3', 'Filters', 'Pack', 'TRUE'],
    ['AIMAA11', 'AA Filter X 11', 'Filters', 'Pack', 'TRUE'],
    ['MAGBEAM', 'Magnetic Tap Beam', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['G12LC', 'G12 Lid Cover', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['JUMBOSPOUNGE', 'JUMBO SPONGE', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['A201WHT', 'A20 with 1 White Filter', 'Gravity Purifiers', 'Unit', 'TRUE'],
    ['MR29500', 'Marine Protection', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['P17C2D2', 'Phoenix 8L + Smart Carbon Filter', 'Phoenix Series', 'Unit', 'TRUE'],
    ['POSTreat- F', 'POSTreat steel fluoride reduction filter removes > 95% of fluoride 2 Pack', 'Phoenix Series', 'Pack', 'TRUE'],
    ['PC2', 'Phoenix Smart Carbon Cartridges', 'Phoenix Series', 'Pack', 'TRUE'],
    ['P17C2F2D1', 'Phoenix 8L Fluoride + Smart Carbon Filter', 'Phoenix Series', 'Unit', 'TRUE'],
    ['PTSFRRL', 'POSTreat FluoRid Media Refill', 'Phoenix Series', 'Unit', 'TRUE'],
    ['AIMEXSSGRVTFDCH', 'Aimex SS 304 8L Carbon and Fluoride', 'Stainless Steel Purifiers', 'Unit', 'TRUE'],
    ['P24C2D2', 'Phoenix 12L SS Smart Carbon', 'Phoenix Series', 'Unit', 'TRUE'],
    ['PGNTWS-8', 'Teak Wood Stand 8L', 'Phoenix Series', 'Unit', 'TRUE'],
    ['P1P5C1', 'Phoenix 1 Litre Portable', 'Phoenix Series', 'Unit', 'TRUE'],
    ['PSSP17', 'Stainless Steel Tap For Stainless Steel Water Dispensers', 'Phoenix Series', 'Unit', 'TRUE'],
    ['P12C2F2D0', '6L filter +Postreat', 'Phoenix Series', 'Unit', 'TRUE'],
    ['PGSS-8', 'Phoenix 8L SS Stand', 'Phoenix Series', 'Unit', 'TRUE'],
    ['P12C2D0', 'Phoenix Water Filter - 6L Carbon Filter', 'Phoenix Series', 'Unit', 'TRUE'],
    ['WFS02', 'Phoenix Gravity Water Filter Wingnuts & Washers (Replacement Set)', 'Phoenix Series', 'Set', 'TRUE'],
    ['DOMENUT12', 'Dome Nut', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['PLASTICTAPSS', 'Aimex Tap Plastic for SS', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['P12C2F2SSD0', 'Phoenix Stainless Steel 6L with Fluoride SS Stand Smart Carbon Filter', 'Phoenix Series', 'Unit', 'TRUE'],
    ['PGSSVT10', 'Phoenix Vision Tap- Stainless Steel', 'Phoenix Series', 'Unit', 'TRUE'],
    ['PGNTWS-6', 'Phoenix Gravity Teak Wood Stand 6L', 'Phoenix Series', 'Unit', 'TRUE'],
    ['PGNTWS-12', 'Teak Wood Stand 12L', 'Phoenix Series', 'Unit', 'TRUE'],
    ['MR 36-100', 'Rainscreen Marine Water Screen', 'Car & Marine Care', 'Unit', 'TRUE'],
    ['PSSVT7', 'Phoenix Gravity stainless steel vision Tap 6L-8L', 'Phoenix Series', 'Unit', 'TRUE'],
    ['P17C2F2SSD2', 'Phoenix Gravity 8Litres with Postreat (Fluoride) and stainless Steel stand', 'Phoenix Series', 'Unit', 'TRUE'],
    ['WFS01', 'PP Plugs for Phoenix Gravity Water Filter Unit', 'Phoenix Series', 'Pack', 'TRUE'],
    ['PHNXPOSTCAP', 'Postreat CAP', 'Phoenix Series', 'Unit', 'TRUE'],
    ['WFS03', 'Phoenix Gravity Air Lock Clip', 'Phoenix Series', 'Pack', 'TRUE'],
    ['AIMEXA20LID', 'A20 Lid', 'Parts & Accessories', 'Unit', 'TRUE'],
    ['AIMSHRCART1', 'PureRain Shower Filter Cartridge', 'Shower Filters', 'Unit', 'TRUE'],
    ['PPTS2ND', 'POSTreat™ Steel Fluoride V 2.0', 'Phoenix Series', 'Pack', 'TRUE'],
    ['AW-SF-PR-SLV', 'Aimex Water PureRain Metal Shower Filter', 'Shower Filters', 'Unit', 'TRUE']
  ];
}
