// Regions for the graph's "Peers near you" choice. Each source may carry a "region" in the manifest
// (ris-routing-data): a UN M49 sub-region name, the region where the peer's network mainly operates.
// The visitor's region comes from the browser's timezone (nothing is sent anywhere); they can change it, and
// the choice is kept in localStorage. Pure functions apart from the storage helpers; tested in
// tests/js/regions.test.mjs.

/** UN M49 sub-region -> M49 region ("continent"), in the order the Region picker lists them. */
export const SUBREGIONS = {
  "Southern Asia": "Asia", "South-eastern Asia": "Asia", "Eastern Asia": "Asia", "Central Asia": "Asia",
  "Western Asia": "Asia",
  "Australia and New Zealand": "Oceania", "Melanesia": "Oceania", "Micronesia": "Oceania", "Polynesia": "Oceania",
  "Northern Europe": "Europe", "Western Europe": "Europe", "Southern Europe": "Europe", "Eastern Europe": "Europe",
  "Northern America": "Americas", "Central America": "Americas", "Caribbean": "Americas", "South America": "Americas",
  "Northern Africa": "Africa", "Western Africa": "Africa", "Middle Africa": "Africa", "Eastern Africa": "Africa",
  "Southern Africa": "Africa",
};

/** A manifest region value, or null when it is missing or not one of SUBREGIONS. */
export const validRegion = (r) => (typeof r === "string" && r in SUBREGIONS ? r : null);

export const continentOf = (r) => SUBREGIONS[r] || null;

/** "Asia", "the Americas": a continent name to use inside a sentence. */
export const continentText = (c) => (c === "Americas" ? "the Americas" : c);

// Timezone city -> sub-region. Cities are the part after the last "/" of an IANA name (old aliases included).
const CITIES = {
  "Southern Asia": "Kolkata Calcutta Colombo Dhaka Dacca Karachi Kathmandu Katmandu Thimphu Thimbu Kabul Tehran Maldives",
  "South-eastern Asia": "Singapore Kuala_Lumpur Kuching Jakarta Pontianak Makassar Ujung_Pandang Jayapura Bangkok " +
    "Ho_Chi_Minh Saigon Phnom_Penh Vientiane Yangon Rangoon Manila Brunei Dili",
  "Eastern Asia": "Tokyo Seoul Pyongyang Shanghai Chongqing Chungking Harbin Urumqi Kashgar Hong_Kong Macau Macao " +
    "Taipei Ulaanbaatar Ulan_Bator Hovd Choibalsan",
  "Central Asia": "Almaty Qyzylorda Aqtobe Aqtau Atyrau Oral Qostanay Tashkent Samarkand Bishkek Dushanbe Ashgabat Ashkhabad",
  "Western Asia": "Dubai Riyadh Qatar Bahrain Kuwait Muscat Aden Baghdad Jerusalem Tel_Aviv Beirut Damascus Amman " +
    "Nicosia Famagusta Gaza Hebron Tbilisi Yerevan Baku Istanbul",
  "Eastern Europe": "Moscow Kiev Kyiv Uzhgorod Zaporozhye Warsaw Prague Budapest Bucharest Sofia Minsk Chisinau Tiraspol " +
    "Bratislava Kaliningrad Samara Volgograd Saratov Ulyanovsk Astrakhan Kirov Simferopol Yekaterinburg Novosibirsk " +
    "Omsk Krasnoyarsk Irkutsk Yakutsk Vladivostok Magadan Kamchatka Sakhalin Chita Barnaul Tomsk Novokuznetsk " +
    "Srednekolymsk Ust-Nera Khandyga Anadyr",
  "Northern Europe": "London Dublin Belfast Oslo Stockholm Helsinki Copenhagen Tallinn Riga Vilnius Reykjavik Faroe " +
    "Faeroe Guernsey Jersey Isle_of_Man Mariehamn Longyearbyen",
  "Southern Europe": "Rome Madrid Lisbon Athens Malta Belgrade Zagreb Ljubljana Sarajevo Skopje Podgorica Tirane " +
    "Vatican San_Marino Gibraltar Andorra Canary Madeira Azores",
  "Western Europe": "Berlin Paris Amsterdam Brussels Vienna Zurich Luxembourg Monaco Vaduz Busingen",
  "Northern Africa": "Cairo Tripoli Tunis Algiers Casablanca El_Aaiun Khartoum",
  "Western Africa": "Lagos Accra Abidjan Dakar Bamako Conakry Freetown Monrovia Ouagadougou Niamey Nouakchott Banjul " +
    "Bissau Lome Porto-Novo Cape_Verde St_Helena Timbuktu",
  "Middle Africa": "Luanda Kinshasa Lubumbashi Brazzaville Bangui Ndjamena Douala Libreville Malabo Sao_Tome",
  "Eastern Africa": "Nairobi Addis_Ababa Dar_es_Salaam Kampala Kigali Bujumbura Mogadishu Djibouti Asmara Asmera Juba " +
    "Lusaka Harare Maputo Blantyre Mauritius Reunion Antananarivo Comoro Mayotte Mahe",
  "Southern Africa": "Johannesburg Windhoek Gaborone Maseru Mbabane",
  "Central America": "Mexico_City Cancun Monterrey Merida Chihuahua Tijuana Ensenada Hermosillo Mazatlan Matamoros " +
    "Bahia_Banderas Ojinaga Ciudad_Juarez Guatemala Belize El_Salvador Tegucigalpa Managua Costa_Rica Panama",
  "Caribbean": "Havana Jamaica Port-au-Prince Santo_Domingo Puerto_Rico Barbados Port_of_Spain Nassau Martinique " +
    "Guadeloupe Curacao Aruba St_Lucia Grenada Antigua Dominica St_Kitts St_Vincent St_Thomas Tortola Anguilla " +
    "Montserrat Cayman Grand_Turk Kralendijk Lower_Princes Marigot St_Barthelemy",
  "South America": "Sao_Paulo Buenos_Aires Santiago Lima Bogota Caracas Quito Guayaquil La_Paz Asuncion Montevideo " +
    "Guyana Paramaribo Cayenne Manaus Fortaleza Recife Belem Bahia Cuiaba Campo_Grande Porto_Velho Boa_Vista Rio_Branco " +
    "Eirunepe Araguaina Maceio Santarem Noronha Punta_Arenas Cordoba Mendoza Salta Jujuy Tucuman Catamarca La_Rioja " +
    "San_Juan San_Luis Rio_Gallegos Ushuaia Stanley South_Georgia",
  "Australia and New Zealand": "Auckland Chatham Norfolk",
  "Melanesia": "Port_Moresby Bougainville Guadalcanal Efate Noumea Fiji",
  "Micronesia": "Guam Saipan Palau Chuuk Truk Pohnpei Ponape Kosrae Majuro Kwajalein Tarawa Nauru",
  "Polynesia": "Tongatapu Apia Pago_Pago Rarotonga Tahiti Marquesas Gambier Niue Fakaofo Funafuti Wallis Pitcairn " +
    "Kiritimati Kanton Enderbury Easter",
};
const BY_CITY = new Map(Object.entries(CITIES).flatMap(([r, list]) => list.split(" ").map((c) => [c, r])));

/** IANA timezone (e.g. "Asia/Kolkata") -> sub-region, or null when it gives no clue (UTC, Antarctica, ...). */
export function regionOfTimeZone(tz) {
  if (typeof tz !== "string" || !tz.includes("/")) return null;
  const parts = tz.split("/");
  const city = parts[parts.length - 1];
  if (BY_CITY.has(city)) return BY_CITY.get(city);
  const area = parts[0];
  if (area === "Australia") return "Australia and New Zealand";
  if (area === "America" || area === "US" || area === "Canada") return "Northern America"; // the rest of the Americas
  if (area === "Europe") return "Western Europe";
  if (area === "Pacific" && city === "Honolulu") return "Northern America";
  return null;
}

const REGION_KEY = "graphRegion";

/** The visitor's region: their saved choice, else their timezone's, else null. */
export function visitorRegion() {
  try {
    const saved = validRegion(localStorage.getItem(REGION_KEY));
    if (saved) return saved;
  } catch { /* storage blocked */ }
  try {
    return regionOfTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

export function saveRegion(r) {
  try { localStorage.setItem(REGION_KEY, r); } catch { /* storage blocked */ }
}

/** Fewest peers a sub-region needs before "Peers near you" widens to the whole continent. */
export const MIN_NEAR = 2;

/**
 * Which groups (singlePeers / groupPeers shape) are "near" the region. regionOf(group) gives a group's region
 * (null when its source has none). Returns {groups, scope, region, sources}:
 *   scope "region": groups whose source is in the sub-region (at least MIN_NEAR peers have a route here);
 *   scope "continent": too few in the sub-region, so every group in the same continent (only when that adds
 *     peers; otherwise the sub-region's own peers, as scope "region");
 *   scope "none": no region known, or no peer in the continent; groups is then empty.
 * sources is how many distinct peers (by regionOf's key) the sub-region itself has here.
 */
export function nearGroups(groups, region, regionOf, peerKey = (g) => g.peers[0]) {
  if (!validRegion(region)) return { groups: [], scope: "none", region: null, sources: 0 };
  const inRegion = groups.filter((g) => regionOf(g) === region);
  const sources = new Set(inRegion.map(peerKey)).size;
  if (sources >= MIN_NEAR) return { groups: inRegion, scope: "region", region, sources };
  const continent = continentOf(region);
  const inContinent = groups.filter((g) => continentOf(regionOf(g)) === continent);
  if (sources && new Set(inContinent.map(peerKey)).size === sources) return { groups: inRegion, scope: "region", region, sources };
  if (inContinent.length) return { groups: inContinent, scope: "continent", region, sources };
  return { groups: [], scope: "none", region, sources };
}
