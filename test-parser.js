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
assert.ok(res5.customerNameCertainty >= 75);
assert.ok(res5.trackingNumberCertainty >= 75);

console.log('\nAll parser tests passed!');
