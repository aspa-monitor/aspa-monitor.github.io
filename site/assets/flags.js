// Path flags written by ris-routing-data (pipeline/ris/normalize.py), with plain explanations.

export const FLAG_INFO = {
  as_set: {
    label: "AS_SET",
    text: "The path ends in (or contains) an unordered AS_SET, usually from route aggregation. " +
      "The origin AS cannot be determined, and RFC 9774 deprecates AS_SETs.",
  },
  confed: {
    label: "Confederation",
    text: "The path carries confederation segments. These should be removed before a route leaves " +
      "the confederation, so they should never reach a route collector.",
  },
  loop: {
    label: "Loop",
    text: "An AS appears twice with other ASes in between (not just prepending). " +
      "Often a poisoned path or a leak; no AS adjacencies are taken from it.",
  },
  private: {
    label: "Private ASN",
    text: "The path contains a private-use ASN (64512-65534 or 4200000000-4294967294) that " +
      "should have been stripped before announcing to the Internet.",
  },
  reserved: {
    label: "Reserved ASN",
    text: "The path contains a reserved ASN: AS0, a documentation ASN, or another IANA-reserved number.",
  },
  as_trans: {
    label: "AS_TRANS",
    text: "The path contains AS23456, the placeholder a 2-byte-only BGP speaker uses for a 4-byte ASN. " +
      "Some router did not reconstruct the real AS path.",
  },
  peer_mismatch: {
    label: "Peer mismatch",
    text: "The first AS in the path is not the peer AS that sent the route to the collector.",
  },
  empty: {
    label: "Empty path",
    text: "The route has no AS path at all (normally only seen for iBGP routes).",
  },
};

/** 'private', 'reserved', 'as_trans' or null, same rules as ris-routing-data. */
export function asnCategory(asn) {
  if (asn === 23456) return "as_trans";
  if ((asn >= 64512 && asn <= 65534) || (asn >= 4200000000 && asn <= 4294967294)) return "private";
  if (asn === 0 || (asn >= 64496 && asn <= 64511) || asn === 65535 ||
      (asn >= 65536 && asn <= 131071) || asn === 4294967295) return "reserved";
  return null;
}

export function splitList(text) {
  return (text || "").split(/[\s,;]+/).filter(Boolean);
}
