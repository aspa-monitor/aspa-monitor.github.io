import { test } from "node:test";
import assert from "node:assert/strict";
import { rovView, invalidReason, rovSlot } from "../../site/assets/rov.js";

const roa = (prefix, origin_asn) => ({ prefix, origin_asn, ta: "apnic" });

test("ROV verdicts map to badges", () => {
  assert.equal(rovView("valid", 13335).tone, "valid");
  assert.equal(rovView("unknown", 64512).label, "Not found");
  assert.equal(rovView("invalid", 13335, [roa("1.1.1.0/24", 13335)]).tone, "invalid");
  assert.equal(rovView("weird", 1).tone, "none");
});

test("invalid reasons", () => {
  assert.match(invalidReason(13335, [roa("1.1.1.0/24", 13335)]), /more specific than its maxLength/);
  assert.equal(invalidReason(13335, [roa("8.8.8.0/24", 15169), roa("8.8.0.0/16", 15169)]),
    "The covering ROAs authorise AS15169, not AS13335.");
  assert.match(invalidReason(65000, [roa("10.0.0.0/8", 0)]), /AS0 ROA/);
  assert.equal(invalidReason(65000, [roa("10.0.0.0/8", 0), roa("10.0.0.0/16", 2)]),
    "The covering ROAs authorise AS2, not AS65000.");
  assert.match(invalidReason(65000, []), /No ROA authorises/);
});

test("no check for an AS_SET origin", () => {
  assert.match(rovSlot("1.0.0.0/24", null), /AS_SET/);
  assert.match(rovSlot("1.0.0.0/24", 13335), /data-asn="13335"/);
});
