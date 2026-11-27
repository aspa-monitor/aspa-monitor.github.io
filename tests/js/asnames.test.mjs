import { test } from "node:test";
import assert from "node:assert/strict";
import { shortName } from "../../site/assets/asnames.js";

test("graph boxes get the organisation half of an AS name", () => {
  assert.equal(shortName("ATT-INTERNET4 - AT&T Enterprises, LLC"), "AT&T Enterprises, LLC");
  assert.equal(shortName("BBIL-AP - BHARTI Airtel Ltd., IN"), "BHARTI Airtel Ltd."); // backup list: country dropped
  assert.equal(shortName("BHARAT-PUBLIC-DNS - BHARAT PUBLIC DNS (1.10.10.10)"), "BHARAT PUBLIC DNS (1.10.10.10)");
  assert.equal(shortName("AS6453 - TATA COMMUNICATIONS (AMERICA) INC"), "TATA COMMUNICATIONS (AMERICA) INC");
  assert.equal(shortName("A - B - C"), "B - C"); // split on the first separator only
});

test("names without a handle separator stay whole", () => {
  assert.equal(shortName("ASGARR Consortium GARR"), "ASGARR Consortium GARR");
  assert.equal(shortName("GTT Communications Inc., US"), "GTT Communications Inc.");
  assert.equal(shortName("HANDLE - "), "HANDLE -");
  assert.equal(shortName(""), "");
  assert.equal(shortName(null), "");
});
