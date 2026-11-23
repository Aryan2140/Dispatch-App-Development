/**
 * Unit tests for Aimex Multi-Courier Tracking Slip Parser
 */

const assert = require('assert');
const parser = require('./public/ocr-parser.js');

console.log('Running Aimex Tracking Slip Parser tests...\n');

// Test 1: Standard CouriersPlease label
const cpText = `
CouriersPlease 500 Gram Parcel
Connote: CPCTOZE0000179
To: Mohsen Pourghorbani Dinachali
8 Positano Way
LALOR 3075 VIC
Special Instructions: FRAGILE HANDLE WITH T4A259
CARE ATL
Reference: 14282 Aimex Website
CPCTOZS0000181
From: Aimex Australia Pty Ltd
191 McCredie Road
SMITHFIELD 2164 NSW
`;

const res1 = parser.parseTrackingSlipText(cpText);
console.log('Test 1 (CouriersPlease):', res1);
assert.strictEqual(res1.customerName, 'Mohsen Pourghorbani Dinachali');
assert.strictEqual(res1.trackingNumber, 'CPCTOZE0000179');
assert.strictEqual(res1.carrier, 'CouriersPlease');

// Test 2: Noisy OCR (0 vs O in Connote, T0 instead of To, trailing 500 Gram Parcel)
const noisyCpText = `
CouriersPlease
Conn0te: CPCT0ZE0000179
T0: Mohsen Pourghorbani Dinachali 500 Gram Parcel
8 Positano Way
LALOR 3075 VIC
`;
const res2 = parser.parseTrackingSlipText(noisyCpText);
console.log('Test 2 (Noisy OCR):', res2);
assert.strictEqual(res2.customerName, 'Mohsen Pourghorbani Dinachali');
assert.strictEqual(res2.trackingNumber, 'CPCTOZE0000179');
assert.strictEqual(res2.carrier, 'CouriersPlease');

// Test 3: Australia Post with Order Date
const ausPostText = `
Australia Post Parcel Post
Order Date: 16/11/2026
AP Article ID: 33PKH509928101000930904
Deliver To: Sarah Jenkins
Unit 4, 22 George Street
PARRAMATTA NSW 2150
Sender: Aimex Australia Pty Ltd
191 McCredie Road SMITHFIELD 2164 NSW
`;
const res3 = parser.parseTrackingSlipText(ausPostText);
console.log('Test 3 (AusPost + Date):', res3);
assert.strictEqual(res3.customerName, 'Sarah Jenkins');
assert.strictEqual(res3.trackingNumber, '33PKH509928101000930904');
assert.strictEqual(res3.orderDate, '2026-11-16');
assert.strictEqual(res3.carrier, 'Australia Post');

// Test 4: Structural fallback without "To:" prefix
const noPrefixText = `
Aramex
Label No: MP0012983471
Melbourne Auto Supplies Pty Ltd
145 Industrial Drive
DANDENONG SOUTH 3175 VIC
`;
const res4 = parser.parseTrackingSlipText(noPrefixText);
console.log('Test 4 (Fallback):', res4);
assert.strictEqual(res4.customerName, 'Melbourne Auto Supplies Pty Ltd');
assert.strictEqual(res4.trackingNumber, 'MP0012983471');
assert.strictEqual(res4.carrier, 'Aramex');

// Test 5: Shadowed Australia Post eParcel with "DELIVER TO  PHONE :+61..." on same line
const shadowedAusPostText = `
Australia Post eParcel
DELIVER TO PHONE :+61 481 710 708 wage
Pearl Li Aspace Property Pty Ltd =
Pearl Li Aspace Property Pty Ltd
3/56-58 Santa Cruz Boulevard
CLEAR ISLAND WATERS QLD 4226
Signature NOT required [Con No 39BCX5000529
AP Article Id: 39BCX500052901000931505
SENDER
Aimex Australia Pty Ltd
`;
const res5 = parser.parseTrackingSlipText(shadowedAusPostText, 68);
console.log('Test 5 (Shadowed AusPost eParcel):', res5);
assert.strictEqual(res5.customerName, 'Pearl Li Aspace Property Pty Ltd');
assert.strictEqual(res5.trackingNumber, '39BCX500052901000931505');
assert.strictEqual(res5.carrier, 'Australia Post');
assert.ok(res5.customerNameCertainty >= 75);
assert.ok(res5.trackingNumberCertainty >= 75);

// Test 6: OCR-corrupted "AP Article ld" + split-line + spaces + obscured headers
const trickyAusPost = `
Australia Post eParcel
DELIVER TO
Jamie Tan
12 High Street
SYDNEY NSW 2000
AP Article ld: 39BCX5000529 01000931505 1118
`;
const res6 = parser.parseTrackingSlipText(trickyAusPost, 78);
console.log('Test 6 (Corrupted header + spaced ID + footer 1118):', res6);
assert.strictEqual(res6.trackingNumber, '39BCX500052901000931505');
assert.strictEqual(res6.carrier, 'Australia Post');

// Test 7: Split-line "Connote:" header and darkened label prefix
const splitLineCp = `
CouriersPlease
Connote:
CPCT0ZE0000179
To: Priya Patel
44 Station Rd
AUBURN NSW 2144
`;
const res7 = parser.parseTrackingSlipText(splitLineCp, 88);
console.log('Test 7 (Split-line Connote):', res7);
assert.strictEqual(res7.trackingNumber, 'CPCTOZE0000179');
assert.strictEqual(res7.customerName, 'Priya Patel');
assert.strictEqual(res7.carrier, 'CouriersPlease');

// Test 8: Missing header label completely (carrier pattern rescue)
const headlessAusPost = `
Australia Post
DELIVER TO
Liam Chen
88 Pitt St
SYDNEY NSW 2000
398CX500052901000931505
`;
const res8 = parser.parseTrackingSlipText(headlessAusPost, 85);
console.log('Test 8 (Obscured header pattern rescue):', res8);
assert.strictEqual(res8.trackingNumber, '39BCX500052901000931505');
assert.strictEqual(res8.carrier, 'Australia Post');

// Test 9: CouriersPlease Amazon label (with column tab separation + DataMatrix barcode payload noise)
const cpAmazonText = [
  'UNDELIVERABLE ADDRESS:\tRESIDENTIAL',
  'Aimex Australia',
  '26/191 McCredie Road\tCouriersPlease',
  'SMITHFIELD NSW 2164',
  'Australia\tPkg 1 of 1',
  'SHIP TO:',
  'JAKE DURY\t4.86 kg. 43.1 * 27.8 * 27.4',
  '60 YARRA VALLEY BOULEVARD\tLEAVE IN A SAFE PLACE',
  'Destination : VIC',
  'CHIRNSIDE PARK 3116 AUSTRALIA\tOrder Id: 503-0624319-3869418',
  'CPBHZST1575833',
  'D4A270',
  'BARCODE_PAYLOAD: SDrlMx0wVr_001_v'
].join('\n');
const res9 = parser.parseTrackingSlipText(cpAmazonText, 90);
console.log('Test 9 (CouriersPlease Amazon):', res9);
assert.strictEqual(res9.customerName, 'JAKE DURY');
assert.strictEqual(res9.trackingNumber, 'CPBHZST1575833');
assert.strictEqual(res9.carrier, 'CouriersPlease');

// Test 10: CouriersPlease Amazon with inverted same-line header "JAKE DURY   SHIP TO:"
const cpAmazonInverted = [
  'UNDELIVERABLE ADDRESS: Aimex Australia\tRESIDENTIAL',
  'SMITHFIELD NSW 2164 26/191 McCredie Road',
  'JAKE DURY   SHIP TO:\t4.86 kg. 43.1 * 27.8 * 27.4',
  'Destination : VIC   60 YARRA VALLEY BOULEVARD\tLEAVE IN A SAFE PLACE',
  'CHIRNSIDE PARK 3116 AUSTRALIA\tOrder Id: 503-0624319-3869418',
  'CPBHZST1575833',
  'D4A270',
  'BARCODE_PAYLOAD: SDrlMx0wVr_001_v'
].join('\n');
const res10 = parser.parseTrackingSlipText(cpAmazonInverted, 90);
console.log('Test 10 (CouriersPlease Amazon inverted SHIP TO):', res10);
assert.strictEqual(res10.customerName, 'JAKE DURY');
assert.strictEqual(res10.trackingNumber, 'CPBHZST1575833');
assert.strictEqual(res10.carrier, 'CouriersPlease');

// Test 11: Noisy Tesseract on Amazon label ("lh mn" garbage + "SHTMIED" + "SHIP 10:" + "CPBHZSTI575833")
const noisyTesseractAmazon = `
lh      mn
26/191 McCredie Road                      Er
SHTMIED NSW 2164
ralia
SHIP 10:                       Pkg 1 of 1
JAKE DURY
60 YARRA VALLEY BOULEVARD         Liha, Ke
Destination : VIC                        JRL EAVEINAL
CHIRNSIDE PARK 3116 AUSTRALIA   Order Id: 503-062
CPBHZSTI575833                    |
D4A270
`;
const res11 = parser.parseTrackingSlipText(noisyTesseractAmazon, 59);
console.log('Test 11 (Noisy Tesseract Amazon):', res11);
assert.strictEqual(res11.customerName, 'JAKE DURY');
assert.strictEqual(res11.trackingNumber, 'CPBHZST1575833');
assert.strictEqual(res11.carrier, 'CouriersPlease');

// Test 12: Australia Post International S10 + Multi-carrier suite (StarTrack, Sendle, Toll/TGE, TNT, DHL, Allied, Direct Freight)
const intlAusPost = `
Australia Post Express International
DELIVER TO: Daniel Nguyen
14 Collins Street
MELBOURNE VIC 3000
Tracking No: EB123456789AU
`;
const res12a = parser.parseTrackingSlipText(intlAusPost, 90);
assert.strictEqual(res12a.customerName, 'Daniel Nguyen');
assert.strictEqual(res12a.trackingNumber, 'EB123456789AU');
assert.strictEqual(res12a.carrier, 'Australia Post');

const starTrackLabel = `
StarTrack Express
Consignment: 2ATZ12345678
Deliver To: Emma Watson
55 George Street
BRISBANE QLD 4000
`;
const res12b = parser.parseTrackingSlipText(starTrackLabel, 90);
assert.strictEqual(res12b.customerName, 'Emma Watson');
assert.strictEqual(res12b.trackingNumber, '2ATZ12345678');
assert.strictEqual(res12b.carrier, 'StarTrack');

const sendleLabel = `
Sendle
Sendle Ref: S3NDL9
To: Olivia Brown
99 Harbour Esplanade
DOCKLANDS VIC 3008
`;
const res12c = parser.parseTrackingSlipText(sendleLabel, 90);
assert.strictEqual(res12c.customerName, 'Olivia Brown');
assert.strictEqual(res12c.trackingNumber, 'S3NDL9');
assert.strictEqual(res12c.carrier, 'Sendle');

const tollTgeLabel = `
Team Global Express
Connote: 887766554433
Consignee: Lucas Miller
101 St Georges Terrace
PERTH WA 6000
`;
const res12d = parser.parseTrackingSlipText(tollTgeLabel, 90);
assert.strictEqual(res12d.customerName, 'Lucas Miller');
assert.strictEqual(res12d.trackingNumber, '887766554433');
assert.strictEqual(res12d.carrier, 'Team Global Express');

const tntFedexDhl = `
DHL Express
Waybill: JD014600001234567890
Recipient: Hannah Kim
200 Hindley Street
ADELAIDE SA 5000
`;
const res12e = parser.parseTrackingSlipText(tntFedexDhl, 90);
assert.strictEqual(res12e.customerName, 'Hannah Kim');
assert.strictEqual(res12e.trackingNumber, 'JD014600001234567890');
assert.strictEqual(res12e.carrier, 'DHL');

const tntLabel = `
TNT Express
Consignment No: GE123456789AU
Deliver To: Noah Wilson
75 Salamanca Place
HOBART TAS 7000
`;
const res12f = parser.parseTrackingSlipText(tntLabel, 90);
assert.strictEqual(res12f.customerName, 'Noah Wilson');
assert.strictEqual(res12f.trackingNumber, 'GE123456789AU');
assert.strictEqual(res12f.carrier, 'TNT / FedEx');

const directAllied = `
Direct Freight Express
Consignment Note: DFE998877665
Receiver: Ethan Davis
12 Northbourne Ave
CANBERRA ACT 2601
`;
const res12g = parser.parseTrackingSlipText(directAllied, 90);
assert.strictEqual(res12g.customerName, 'Ethan Davis');
assert.strictEqual(res12g.trackingNumber, 'DFE998877665');
assert.strictEqual(res12g.carrier, 'Direct Freight');

// Test 13: Australia Post MyPost Business (vertical AP Article Id: 997..., PO Box 5001 Greystanes sender)
const myPostText = `
Parcel Post MyPost Business
To:
Zaza Horstmans
Zaza Horstmans
123 Taylors Rd
NASHUA NSW 2479
Packaging Small Satchel Up to 5kg
Ref: 14557 Aimex Website
Sender: 63512384
Aimex Australia Pty Ltd
Po Box 5001
GREYSTANES NSW 2145
AP Article Id: 99724133483201008320904 1123
`;
const res13 = parser.parseTrackingSlipText(myPostText, 90);
console.log('Test 13 (MyPost Business):', res13);
assert.strictEqual(res13.customerName, 'Zaza Horstmans');
assert.strictEqual(res13.trackingNumber, '99724133483201008320904');
assert.strictEqual(res13.carrier, 'Australia Post');

// Test 14: Tracking-number fallback carrier detection & variant grouping
assert.strictEqual(parser.detectCarrierFromTracking('CPCTOZS0000330'), 'CouriersPlease');
assert.strictEqual(parser.detectCarrierFromTracking('CPBHZST1590729'), 'CouriersPlease');
assert.strictEqual(parser.detectCarrierFromTracking('CPCTOZE0000179'), 'CouriersPlease');
assert.strictEqual(parser.detectCarrierFromTracking('99724133483201008320904'), 'Australia Post');
assert.strictEqual(parser.detectCarrierFromTracking('39BCX500052901000931505'), 'Australia Post');
assert.strictEqual(parser.detectCarrierFromTracking('33PKH509928101000930904'), 'Australia Post');
assert.strictEqual(parser.normalizeCarrierName('MyPost Business'), 'Australia Post');
assert.strictEqual(parser.normalizeCarrierName('Parcel Post'), 'Australia Post');
assert.strictEqual(parser.normalizeCarrierName('Express Post'), 'Australia Post');
assert.strictEqual(parser.normalizeCarrierName('eParcel'), 'Australia Post');
assert.strictEqual(parser.normalizeCarrierName('Couriers Please'), 'CouriersPlease');
console.log('Test 14 (Carrier fallback & variant grouping): OK');

console.log('\nAll parser tests passed!');
