import { test } from "node:test";
import assert from "node:assert/strict";
import { SUBREGIONS, validRegion, continentOf, continentText, regionOfTimeZone, nearGroups, MIN_NEAR } from "../../site/assets/regions.js";

test("timezones map to UN M49 sub-regions", () => {
  assert.equal(regionOfTimeZone("Asia/Kolkata"), "Southern Asia");
  assert.equal(regionOfTimeZone("Asia/Calcutta"), "Southern Asia"); // old alias some browsers still report
  assert.equal(regionOfTimeZone("Asia/Singapore"), "South-eastern Asia");
  assert.equal(regionOfTimeZone("Asia/Tokyo"), "Eastern Asia");
  assert.equal(regionOfTimeZone("Asia/Dubai"), "Western Asia");
  assert.equal(regionOfTimeZone("Europe/Amsterdam"), "Western Europe");
  assert.equal(regionOfTimeZone("Europe/London"), "Northern Europe");
  assert.equal(regionOfTimeZone("Europe/Moscow"), "Eastern Europe");
  assert.equal(regionOfTimeZone("America/New_York"), "Northern America");
  assert.equal(regionOfTimeZone("America/Indiana/Indianapolis"), "Northern America");
  assert.equal(regionOfTimeZone("America/Sao_Paulo"), "South America");
  assert.equal(regionOfTimeZone("America/Argentina/Buenos_Aires"), "South America");
  assert.equal(regionOfTimeZone("America/Mexico_City"), "Central America");
  assert.equal(regionOfTimeZone("Africa/Johannesburg"), "Southern Africa");
  assert.equal(regionOfTimeZone("Africa/Luanda"), "Middle Africa");
  assert.equal(regionOfTimeZone("Australia/Sydney"), "Australia and New Zealand");
  assert.equal(regionOfTimeZone("Pacific/Auckland"), "Australia and New Zealand");
  assert.equal(regionOfTimeZone("UTC"), null);
  assert.equal(regionOfTimeZone("Etc/GMT+5"), null);
  assert.equal(regionOfTimeZone(undefined), null);
});

test("every mapped sub-region is a known one", () => {
  for (const tz of ["Asia/Kolkata", "Europe/Paris", "Africa/Cairo", "Pacific/Guam", "Pacific/Tahiti", "America/Havana"]) {
    assert.ok(regionOfTimeZone(tz) in SUBREGIONS, tz);
  }
  assert.equal(validRegion("Southern Asia"), "Southern Asia");
  assert.equal(validRegion("South Asia"), null); // not the M49 spelling
  assert.equal(continentOf("Southern Asia"), "Asia");
  assert.equal(continentOf(null), null);
});

const g = (peer, region) => ({ peers: [peer], region });
const regionOf = (x) => x.region;

test("nearGroups: the sub-region, widened to its continent when it has too few peers", () => {
  const groups = [g("151704", "Southern Asia"), g("6453", "Southern Asia"), g("24482", "South-eastern Asia"),
    g("7018", "Northern America"), g("3333", null)];
  const r = nearGroups(groups, "Southern Asia", regionOf);
  assert.equal(r.scope, "region");
  assert.deepEqual(r.groups.map((x) => x.peers[0]), ["151704", "6453"]);

  // Only one peer in South-eastern Asia: the whole of Asia.
  assert.equal(MIN_NEAR, 2);
  const w = nearGroups(groups, "South-eastern Asia", regionOf);
  assert.equal(w.scope, "continent");
  assert.equal(w.sources, 1);
  assert.deepEqual(w.groups.map((x) => x.peers[0]), ["151704", "6453", "24482"]);

  // Two paths from one peer count as one peer.
  const twice = nearGroups([g("24482", "South-eastern Asia"), g("24482", "South-eastern Asia"), g("6453", "Southern Asia")],
    "South-eastern Asia", regionOf);
  assert.equal(twice.scope, "continent");
  assert.equal(twice.sources, 1);

  // The continent adds nobody: stay with the sub-region's one peer rather than "1 peer in Americas".
  const alone = nearGroups(groups, "Northern America", regionOf);
  assert.equal(alone.scope, "region");
  assert.deepEqual(alone.groups.map((x) => x.peers[0]), ["7018"]);
  assert.equal(continentText("Americas"), "the Americas");
  assert.equal(continentText("Asia"), "Asia");

  // Nobody in the continent, or no region at all: nothing near (the graph then shows the best peers).
  assert.equal(nearGroups(groups, "Southern Africa", regionOf).scope, "none");
  assert.deepEqual(nearGroups(groups, null, regionOf), { groups: [], scope: "none", region: null, sources: 0 });
  assert.equal(nearGroups(groups, "Narnia", regionOf).scope, "none");
});
