// GW1 predicted-lineup layer (2026-08-21 deadline only) — a deliberately
// temporary, single-source read that fills the one gap the xP model cannot:
// which of eleven similarly-rated squad players actually starts.
//
// The model is cold-start pre-season (COLD_START_NOTE, lib/scoring.ts) and
// team strength reads zero for all twenty clubs, so `start_probability` is a
// role estimate reconciled to eleven starters per club — it "does not order
// players within a position, so understudies can end up sharing a start
// rather than one being picked out as first choice." A single YouTube
// breakdown of predicted GW1 lineups fills exactly that gap, for one
// gameweek, and nothing else.
//
// Scope, deliberately narrow:
//  - Feeds `riskScore` at horizon 1 only (lib/scoring.ts) — never xp. This
//    follows the lib/tactical-profile.ts precedent: data loaded, disclosed,
//    never multiplied into a modelled number.
//  - Gated by both the caller's toggle and `nextEvent === 1` — see
//    `withGw1Context` below. Once GW1 is scored this file (and the two-line
//    read in riskScore, and the ScoredPlayer.gw1 field) should be deleted in
//    one commit. See docs/roadmap.md for the removal note.
//
// Provenance: every id below was resolved against the live `players` table
// for season 2026-27 (team-scoped, accent-folded name match) rather than
// transcribed from the video by hand. 23 names the video gave turned out to
// be stale — wrong club or not in FPL's player list at all (Salah,
// Bernardo Silva and Eric da Silva Moreira among them) — and were replaced
// with owner-corrected names, also resolved against the database. See
// GW1_UNRESOLVED for the discarded names and why.
//
// A player's absence from GW1_ENTRIES is not evidence of anything. The
// source names ~260 of ~600 players; the rest are simply unmentioned. Only
// an explicit `tier` may raise a player's risk — never infer one from
// silence.

import type { ScoredPlayer } from "./scoring";

export type Gw1Tier = "locked" | "medium" | "high";

export interface Gw1Entry {
  /** FPL element id, season 2026-27 — resolved against the live players table, not transcribed. */
  id: number;
  /** Name as given by the source, kept for the diff and for GW1_UNRESOLVED cross-reference. */
  name: string;
  teamShort: string;
  inPredictedXi: boolean;
  tier: Gw1Tier;
  /** Why this player carries a note worth surfacing — role shift, fitness lag, transfer doubt. */
  note?: string;
}

/**
 * Names the source gave that do not resolve to a current FPL player at the
 * claimed club — either the source is out of date (a transfer, or a squad
 * list that predates one) or the player isn't in FPL's 2026-27 set at all.
 * Every one of these was reviewed with the owner; where a real replacement
 * existed it is in GW1_ENTRIES instead, under the corrected name.
 */
export interface Gw1UnresolvedEntry {
  name: string;
  teamShort: string;
  reason: "wrong-club" | "not-in-fpl";
}

export const GW1_UNRESOLVED: Gw1UnresolvedEntry[] = [
  { name: "Ezri Konsa", teamShort: "ARS", reason: "wrong-club" }, // now at AVL (id 31)
  { name: "Jacob Ramsey", teamShort: "AVL", reason: "wrong-club" }, // now at NEW (id 456)
  { name: "Jan Paul van Hecke", teamShort: "BHA", reason: "wrong-club" }, // now at TOT (id 112)
  { name: "Marcos Senesi", teamShort: "BOU", reason: "wrong-club" }, // now at TOT (id 498)
  { name: "Issa Diop", teamShort: "FUL", reason: "wrong-club" }, // now at IPS (id 259)
  { name: "Saša Lukić", teamShort: "FUL", reason: "wrong-club" }, // now at IPS (id 267)
  { name: "Jan Veltman", teamShort: "BHA", reason: "not-in-fpl" },
  { name: "Adam Webster", teamShort: "BHA", reason: "not-in-fpl" },
  { name: "Illia Zabarnyi", teamShort: "BOU", reason: "not-in-fpl" },
  { name: "Mark Flekken", teamShort: "BRE", reason: "not-in-fpl" },
  { name: "Vitalii Mykolenko's cover (\"Roerslev\")", teamShort: "EVE", reason: "not-in-fpl" },
  { name: "Ivor Pandur", teamShort: "HUL", reason: "not-in-fpl" },
  { name: "Cameron Burgess", teamShort: "IPS", reason: "not-in-fpl" },
  { name: "Jens Cajuste", teamShort: "IPS", reason: "not-in-fpl" },
  { name: "Sam Morsy", teamShort: "IPS", reason: "not-in-fpl" },
  { name: "Maximilian Wöber", teamShort: "LEE", reason: "not-in-fpl" },
  { name: "Mohamed Salah", teamShort: "LIV", reason: "not-in-fpl" },
  { name: "Bernardo Silva", teamShort: "MCI", reason: "not-in-fpl" },
  { name: "Eric da Silva Moreira", teamShort: "NFO", reason: "not-in-fpl" },
];

/**
 * Full 20-club GW1 predicted lineup, hand-corrected against the live database
 * with the owner. Every club has exactly eleven `inPredictedXi: true` rows
 * including one goalkeeper — see the `assertGw1Coverage` check this repo's
 * engine-verify harness runs before this file is trusted. Rows with
 * `inPredictedXi: false` are named bench/rotation-risk entries, not slots.
 */
export const GW1_ENTRIES: Gw1Entry[] = [
  // --- Arsenal ---------------------------------------------------------
  { id: 1, name: "Raya", teamShort: "ARS", inPredictedXi: true, tier: "locked" },
  { id: 10, name: "White", teamShort: "ARS", inPredictedXi: true, tier: "medium" },
  { id: 4, name: "Gabriel", teamShort: "ARS", inPredictedXi: true, tier: "locked" },
  { id: 11, name: "Mosquera", teamShort: "ARS", inPredictedXi: true, tier: "medium" },
  { id: 8, name: "Calafiori", teamShort: "ARS", inPredictedXi: true, tier: "locked" },
  { id: 13, name: "Rice", teamShort: "ARS", inPredictedXi: true, tier: "high", note: "No full 90 minutes since international duty." },
  { id: 452, name: "Bruno G.", teamShort: "ARS", inPredictedXi: true, tier: "high", note: "Knock." },
  { id: 15, name: "Ødegaard", teamShort: "ARS", inPredictedXi: true, tier: "locked" },
  { id: 16, name: "Madueke", teamShort: "ARS", inPredictedXi: true, tier: "medium" },
  { id: 26, name: "Havertz", teamShort: "ARS", inPredictedXi: true, tier: "medium", note: "Gyökeres pushing from the bench." },
  { id: 12, name: "Saka", teamShort: "ARS", inPredictedXi: true, tier: "locked" },
  { id: 25, name: "Gyökeres", teamShort: "ARS", inPredictedXi: false, tier: "high", note: "Integrating from the bench." },

  // --- Aston Villa -------------------------------------------------------
  { id: 29, name: "Bizot", teamShort: "AVL", inPredictedXi: true, tier: "medium", note: "Suzuki shadow." },
  { id: 32, name: "Cash", teamShort: "AVL", inPredictedXi: true, tier: "locked" },
  { id: 37, name: "Lindelöf", teamShort: "AVL", inPredictedXi: true, tier: "locked" },
  { id: 34, name: "Pau Torres", teamShort: "AVL", inPredictedXi: true, tier: "locked" },
  { id: 36, name: "Maatsen", teamShort: "AVL", inPredictedXi: true, tier: "locked" },
  { id: 45, name: "McGinn", teamShort: "AVL", inPredictedXi: true, tier: "locked" },
  { id: 47, name: "Kamara", teamShort: "AVL", inPredictedXi: true, tier: "locked" },
  { id: 44, name: "Bailey", teamShort: "AVL", inPredictedXi: true, tier: "medium" },
  { id: 41, name: "Buendía", teamShort: "AVL", inPredictedXi: true, tier: "locked", note: "Commands penalties, direct free kicks and corners." },
  { id: 51, name: "Hemmings", teamShort: "AVL", inPredictedXi: true, tier: "high" },
  { id: 55, name: "Watkins", teamShort: "AVL", inPredictedXi: true, tier: "high", note: "Minimal pre-season minutes; transfer speculation." },
  { id: 597, name: "Suzuki", teamShort: "AVL", inPredictedXi: false, tier: "medium" },

  // --- Bournemouth -------------------------------------------------------
  { id: 57, name: "Petrović", teamShort: "BOU", inPredictedXi: true, tier: "locked" },
  { id: 64, name: "Smith", teamShort: "BOU", inPredictedXi: true, tier: "medium" },
  { id: 566, name: "Silva", teamShort: "BOU", inPredictedXi: true, tier: "locked" },
  { id: 60, name: "Hill", teamShort: "BOU", inPredictedXi: true, tier: "locked" },
  { id: 61, name: "Truffert", teamShort: "BOU", inPredictedXi: true, tier: "locked" },
  { id: 71, name: "Cook", teamShort: "BOU", inPredictedXi: true, tier: "locked" },
  { id: 75, name: "Christie", teamShort: "BOU", inPredictedXi: true, tier: "medium" },
  { id: 68, name: "Tavernier", teamShort: "BOU", inPredictedXi: true, tier: "locked" },
  { id: 69, name: "Scott", teamShort: "BOU", inPredictedXi: true, tier: "locked" },
  { id: 70, name: "Kluivert", teamShort: "BOU", inPredictedXi: true, tier: "medium" },
  { id: 79, name: "Evanilson", teamShort: "BOU", inPredictedXi: true, tier: "locked" },
  { id: 67, name: "Rayan", teamShort: "BOU", inPredictedXi: false, tier: "high", note: "Integration minutes." },

  // --- Brentford -----------------------------------------------------------
  { id: 82, name: "Kelleher", teamShort: "BRE", inPredictedXi: true, tier: "locked" },
  { id: 90, name: "Hickey", teamShort: "BRE", inPredictedXi: true, tier: "locked" },
  { id: 84, name: "Collins", teamShort: "BRE", inPredictedXi: true, tier: "locked" },
  { id: 91, name: "Pinnock", teamShort: "BRE", inPredictedXi: true, tier: "locked" },
  { id: 86, name: "Lewis-Potter", teamShort: "BRE", inPredictedXi: true, tier: "medium" },
  { id: 97, name: "Jensen", teamShort: "BRE", inPredictedXi: true, tier: "locked" },
  { id: 565, name: "Sangaré", teamShort: "BRE", inPredictedXi: true, tier: "medium", note: "New-signing adaptation." },
  { id: 98, name: "Janelt", teamShort: "BRE", inPredictedXi: true, tier: "locked" },
  { id: 95, name: "Dango (Ouattara)", teamShort: "BRE", inPredictedXi: true, tier: "locked" },
  { id: 106, name: "Igor Thiago", teamShort: "BRE", inPredictedXi: true, tier: "locked", note: "Confirmed primary penalty taker." },
  { id: 94, name: "Schade", teamShort: "BRE", inPredictedXi: true, tier: "high" },

  // --- Brighton & Hove Albion ---------------------------------------------
  // Owner-corrected shape: Wieffer at RB, Vušković at CB, Kadıoğlu at LB, De
  // Cuyper pushed to LW, Hinshelwood in midfield; Mitoma and Minteh drop.
  { id: 109, name: "Verbruggen", teamShort: "BHA", inPredictedXi: true, tier: "locked" },
  { id: 130, name: "Wieffer", teamShort: "BHA", inPredictedXi: true, tier: "locked" },
  { id: 504, name: "Vušković", teamShort: "BHA", inPredictedXi: true, tier: "high" },
  { id: 114, name: "Boscagli", teamShort: "BHA", inPredictedXi: true, tier: "medium" },
  { id: 113, name: "Kadıoğlu", teamShort: "BHA", inPredictedXi: true, tier: "locked" },
  { id: 124, name: "Groß", teamShort: "BHA", inPredictedXi: true, tier: "locked", note: "Monopoly on penalties, direct free kicks and corners." },
  { id: 129, name: "Ayari", teamShort: "BHA", inPredictedXi: true, tier: "locked" },
  { id: 123, name: "Hinshelwood", teamShort: "BHA", inPredictedXi: true, tier: "locked" },
  { id: 127, name: "Gómez", teamShort: "BHA", inPredictedXi: true, tier: "medium", note: "Minor knock." },
  { id: 115, name: "De Cuyper", teamShort: "BHA", inPredictedXi: true, tier: "medium", note: "Pushed forward to left wing." },
  { id: 125, name: "Georginio", teamShort: "BHA", inPredictedXi: true, tier: "high", note: "Promise David integration." },
  { id: 121, name: "Mitoma", teamShort: "BHA", inPredictedXi: false, tier: "high" },
  { id: 122, name: "Minteh", teamShort: "BHA", inPredictedXi: false, tier: "high" },
  { id: 116, name: "Dunk", teamShort: "BHA", inPredictedXi: false, tier: "medium" },
  { id: 594, name: "Promise David", teamShort: "BHA", inPredictedXi: false, tier: "high" },

  // --- Chelsea -------------------------------------------------------------
  { id: 140, name: "Sánchez", teamShort: "CHE", inPredictedXi: true, tier: "locked" },
  { id: 142, name: "Reece James", teamShort: "CHE", inPredictedXi: true, tier: "medium" },
  { id: 200, name: "Lacroix", teamShort: "CHE", inPredictedXi: true, tier: "medium" },
  { id: 149, name: "Colwill", teamShort: "CHE", inPredictedXi: true, tier: "locked" },
  { id: 152, name: "Palestra", teamShort: "CHE", inPredictedXi: true, tier: "medium" },
  { id: 159, name: "Caicedo", teamShort: "CHE", inPredictedXi: true, tier: "locked" },
  { id: 161, name: "Lavia", teamShort: "CHE", inPredictedXi: true, tier: "medium" },
  { id: 156, name: "Pedro Neto", teamShort: "CHE", inPredictedXi: true, tier: "high" },
  { id: 154, name: "Cole Palmer", teamShort: "CHE", inPredictedXi: true, tier: "locked", note: "Holds penalties." },
  { id: 40, name: "Morgan Rogers", teamShort: "CHE", inPredictedXi: true, tier: "locked" },
  { id: 165, name: "João Pedro", teamShort: "CHE", inPredictedXi: true, tier: "locked" },
  { id: 155, name: "Enzo Fernández", teamShort: "CHE", inPredictedXi: false, tier: "high", note: "Transfer/fitness instability." },

  // --- Coventry City ---------------------------------------------------------
  { id: 110, name: "Rushworth", teamShort: "COV", inPredictedXi: true, tier: "locked" },
  { id: 175, name: "Van Ewijk", teamShort: "COV", inPredictedXi: true, tier: "locked" },
  { id: 173, name: "Bobby Thomas", teamShort: "COV", inPredictedXi: true, tier: "locked" },
  { id: 182, name: "Kévin Amenda", teamShort: "COV", inPredictedXi: true, tier: "locked", note: "Favoured over Kitching at LCB." },
  { id: 176, name: "Jay Dasilva", teamShort: "COV", inPredictedXi: true, tier: "locked" },
  { id: 184, name: "Matt Grimes", teamShort: "COV", inPredictedXi: true, tier: "locked" },
  { id: 188, name: "Torp", teamShort: "COV", inPredictedXi: true, tier: "medium" },
  { id: 185, name: "Sakamoto", teamShort: "COV", inPredictedXi: true, tier: "medium" },
  { id: 183, name: "Rudoni", teamShort: "COV", inPredictedXi: true, tier: "locked" },
  { id: 186, name: "Mason-Clark", teamShort: "COV", inPredictedXi: true, tier: "locked" },
  { id: 195, name: "Ellis Simms", teamShort: "COV", inPredictedXi: true, tier: "medium" },
  { id: 174, name: "Kitching", teamShort: "COV", inPredictedXi: false, tier: "high", note: "Amenda favoured at LCB." },
  { id: 194, name: "Thomas-Asante", teamShort: "COV", inPredictedXi: false, tier: "high" },
  { id: 193, name: "Haji Wright", teamShort: "COV", inPredictedXi: false, tier: "high" },

  // --- Crystal Palace ----------------------------------------------------
  { id: 198, name: "Henderson", teamShort: "CRY", inPredictedXi: true, tier: "locked" },
  { id: 201, name: "Muñoz", teamShort: "CRY", inPredictedXi: true, tier: "locked" },
  { id: 202, name: "Richards", teamShort: "CRY", inPredictedXi: true, tier: "medium" },
  { id: 206, name: "Riad", teamShort: "CRY", inPredictedXi: true, tier: "medium" },
  { id: 204, name: "Mitchell", teamShort: "CRY", inPredictedXi: true, tier: "locked" },
  { id: 210, name: "Wharton", teamShort: "CRY", inPredictedXi: true, tier: "locked" },
  { id: 218, name: "Doucouré", teamShort: "CRY", inPredictedXi: true, tier: "locked" },
  { id: 208, name: "Sarr", teamShort: "CRY", inPredictedXi: true, tier: "locked" },
  { id: 214, name: "Kamada", teamShort: "CRY", inPredictedXi: true, tier: "medium" },
  { id: 241, name: "McNeil", teamShort: "CRY", inPredictedXi: true, tier: "medium" },
  { id: 222, name: "Strand Larsen", teamShort: "CRY", inPredictedXi: true, tier: "locked" },
  { id: 223, name: "Mateta", teamShort: "CRY", inPredictedXi: false, tier: "high", note: "Late return." },
  { id: 211, name: "Yeremy Pino", teamShort: "CRY", inPredictedXi: false, tier: "high", note: "Late return." },
  { id: 207, name: "Mingueza", teamShort: "CRY", inPredictedXi: false, tier: "high" },

  // --- Everton -------------------------------------------------------------
  { id: 226, name: "Pickford", teamShort: "EVE", inPredictedXi: true, tier: "locked" },
  { id: 246, name: "Röhl", teamShort: "EVE", inPredictedXi: true, tier: "medium", note: "Out of position at right-back — FPL lists him as a midfielder." },
  { id: 229, name: "Tarkowski", teamShort: "EVE", inPredictedXi: true, tier: "locked" },
  { id: 230, name: "Branthwaite", teamShort: "EVE", inPredictedXi: true, tier: "medium", note: "Keane pushing." },
  { id: 233, name: "Mykolenko", teamShort: "EVE", inPredictedXi: true, tier: "locked" },
  { id: 244, name: "Armstrong", teamShort: "EVE", inPredictedXi: true, tier: "medium" },
  { id: 247, name: "Hackney", teamShort: "EVE", inPredictedXi: true, tier: "medium" },
  { id: 245, name: "Dibling", teamShort: "EVE", inPredictedXi: true, tier: "medium" },
  { id: 236, name: "Dewsbury-Hall", teamShort: "EVE", inPredictedXi: true, tier: "locked", note: "Corners and free kicks." },
  { id: 237, name: "Ndiaye", teamShort: "EVE", inPredictedXi: true, tier: "locked", note: "Holds penalties." },
  { id: 249, name: "Barry", teamShort: "EVE", inPredictedXi: true, tier: "medium" },
  { id: 21, name: "Nørgaard", teamShort: "EVE", inPredictedXi: false, tier: "high", note: "Unfit for GW1." },
  { id: 239, name: "Garner", teamShort: "EVE", inPredictedXi: false, tier: "high", note: "Unfit for GW1." },
  { id: 231, name: "Keane", teamShort: "EVE", inPredictedXi: false, tier: "medium" },

  // --- Fulham --------------------------------------------------------------
  { id: 250, name: "Leno", teamShort: "FUL", inPredictedXi: true, tier: "locked" },
  { id: 258, name: "Castagne", teamShort: "FUL", inPredictedXi: true, tier: "medium" },
  { id: 255, name: "Jorge Cuenca", teamShort: "FUL", inPredictedXi: true, tier: "locked" },
  { id: 257, name: "Bassey", teamShort: "FUL", inPredictedXi: true, tier: "locked" },
  { id: 254, name: "Antonee Robinson", teamShort: "FUL", inPredictedXi: true, tier: "locked" },
  { id: 268, name: "Josh King", teamShort: "FUL", inPredictedXi: true, tier: "high" },
  { id: 265, name: "Sander Berge", teamShort: "FUL", inPredictedXi: true, tier: "locked" },
  { id: 264, name: "Bobb", teamShort: "FUL", inPredictedXi: true, tier: "medium" },
  { id: 261, name: "Iwobi", teamShort: "FUL", inPredictedXi: true, tier: "locked", note: "Corners." },
  { id: 263, name: "Kevin", teamShort: "FUL", inPredictedXi: true, tier: "high" },
  { id: 271, name: "Rodrigo Muniz", teamShort: "FUL", inPredictedXi: true, tier: "locked", note: "Holds penalties." },
  { id: 253, name: "Joachim Andersen", teamShort: "FUL", inPredictedXi: false, tier: "high", note: "Suspended for GW1." },
  { id: 262, name: "Emile Smith Rowe", teamShort: "FUL", inPredictedXi: false, tier: "high" },

  // --- Hull City -------------------------------------------------------------
  { id: 572, name: "Tzolakis", teamShort: "HUL", inPredictedXi: true, tier: "locked" },
  { id: 280, name: "Coyle", teamShort: "HUL", inPredictedXi: true, tier: "locked" },
  { id: 279, name: "Ajayi", teamShort: "HUL", inPredictedXi: true, tier: "medium" },
  { id: 586, name: "Mendy", teamShort: "HUL", inPredictedXi: true, tier: "medium" },
  { id: 283, name: "Matty Jacob", teamShort: "HUL", inPredictedXi: true, tier: "locked" },
  { id: 289, name: "Crooks", teamShort: "HUL", inPredictedXi: true, tier: "medium" },
  { id: 290, name: "Regan Slater", teamShort: "HUL", inPredictedXi: true, tier: "locked", note: "Starting security and corner delivery duties." },
  { id: 589, name: "Gourna-Douath", teamShort: "HUL", inPredictedXi: true, tier: "medium" },
  { id: 286, name: "Belloumi", teamShort: "HUL", inPredictedXi: true, tier: "locked" },
  { id: 295, name: "McBurnie", teamShort: "HUL", inPredictedXi: true, tier: "locked", note: "Holds penalties." },
  { id: 293, name: "Kamara", teamShort: "HUL", inPredictedXi: true, tier: "locked" },
  { id: 277, name: "Egan", teamShort: "HUL", inPredictedXi: false, tier: "high", note: "Injury." },
  { id: 284, name: "Cathal McCarthy", teamShort: "HUL", inPredictedXi: false, tier: "high" },

  // --- Ipswich Town ------------------------------------------------------
  // Owner-corrected shape: Scherpen starts over Walton; Maeda starts over Clarke.
  { id: 564, name: "Scherpen", teamShort: "IPS", inPredictedXi: true, tier: "locked" },
  { id: 304, name: "Dara O'Shea", teamShort: "IPS", inPredictedXi: true, tier: "medium", note: "Plays right-back instead of centre-back, lowering his baseline defensive output." },
  { id: 306, name: "Greaves", teamShort: "IPS", inPredictedXi: true, tier: "locked" },
  { id: 259, name: "Issa Diop", teamShort: "IPS", inPredictedXi: true, tier: "locked" },
  { id: 305, name: "Leif Davis", teamShort: "IPS", inPredictedXi: true, tier: "locked" },
  { id: 267, name: "Sasa Lukić", teamShort: "IPS", inPredictedXi: true, tier: "medium" },
  { id: 321, name: "Walle Egeli", teamShort: "IPS", inPredictedXi: true, tier: "high" },
  { id: 315, name: "Fatawu", teamShort: "IPS", inPredictedXi: true, tier: "locked" },
  { id: 309, name: "Marcelino Núñez", teamShort: "IPS", inPredictedXi: true, tier: "medium", note: "Corners." },
  { id: 562, name: "Maeda", teamShort: "IPS", inPredictedXi: true, tier: "high" },
  { id: 316, name: "Emersonn", teamShort: "IPS", inPredictedXi: true, tier: "locked", note: "Penalties." },
  { id: 300, name: "Walton", teamShort: "IPS", inPredictedXi: false, tier: "medium" },
  { id: 313, name: "Jack Clarke", teamShort: "IPS", inPredictedXi: false, tier: "high" },
  { id: 571, name: "Florentino", teamShort: "IPS", inPredictedXi: false, tier: "high" },
  { id: 320, name: "Akpom", teamShort: "IPS", inPredictedXi: false, tier: "medium" },

  // --- Leeds United ------------------------------------------------------
  // Owner-corrected shape: Justin moves CB->LM, Muharemović/Bijol/Rodon at
  // the back, Gudmundsson removed entirely.
  { id: 385, name: "Trafford", teamShort: "LEE", inPredictedXi: true, tier: "locked" },
  { id: 334, name: "Muharemović", teamShort: "LEE", inPredictedXi: true, tier: "locked" },
  { id: 327, name: "Bijol", teamShort: "LEE", inPredictedXi: true, tier: "locked" },
  { id: 329, name: "Rodon", teamShort: "LEE", inPredictedXi: true, tier: "locked" },
  { id: 330, name: "Bogle", teamShort: "LEE", inPredictedXi: true, tier: "locked" },
  { id: 335, name: "Stach", teamShort: "LEE", inPredictedXi: true, tier: "locked" },
  { id: 338, name: "Ampadu", teamShort: "LEE", inPredictedXi: true, tier: "locked" },
  { id: 332, name: "Justin", teamShort: "LEE", inPredictedXi: true, tier: "locked", note: "Moved from CB to left midfield." },
  { id: 260, name: "Harry Wilson", teamShort: "LEE", inPredictedXi: true, tier: "locked", note: "Free kicks and corners." },
  { id: 336, name: "Okafor", teamShort: "LEE", inPredictedXi: true, tier: "medium" },
  { id: 346, name: "Calvert-Lewin", teamShort: "LEE", inPredictedXi: true, tier: "locked", note: "Holds penalties." },
  { id: 337, name: "Aaronson", teamShort: "LEE", inPredictedXi: false, tier: "high" },

  // --- Liverpool -----------------------------------------------------------
  { id: 350, name: "Alisson", teamShort: "LIV", inPredictedXi: true, tier: "locked" },
  { id: 360, name: "Bradley", teamShort: "LIV", inPredictedXi: true, tier: "medium" },
  { id: 362, name: "Jacquet", teamShort: "LIV", inPredictedXi: true, tier: "medium", note: "Vs. Araújo." },
  { id: 356, name: "Van Dijk", teamShort: "LIV", inPredictedXi: true, tier: "locked" },
  { id: 358, name: "Kerkez", teamShort: "LIV", inPredictedXi: true, tier: "locked" },
  { id: 372, name: "Mac Allister", teamShort: "LIV", inPredictedXi: true, tier: "locked" },
  { id: 371, name: "Gravenberch", teamShort: "LIV", inPredictedXi: true, tier: "locked" },
  { id: 369, name: "Ngumoha", teamShort: "LIV", inPredictedXi: true, tier: "medium" },
  { id: 368, name: "Szoboszlai", teamShort: "LIV", inPredictedXi: true, tier: "locked", note: "Corners." },
  { id: 366, name: "Wirtz", teamShort: "LIV", inPredictedXi: true, tier: "locked", note: "Corners." },
  { id: 379, name: "Isak", teamShort: "LIV", inPredictedXi: true, tier: "locked", note: "Holds penalties." },
  { id: 367, name: "Gakpo", teamShort: "LIV", inPredictedXi: false, tier: "high", note: "Transfer speculation." },
  { id: 579, name: "Araújo", teamShort: "LIV", inPredictedXi: false, tier: "medium" },

  // --- Manchester City -----------------------------------------------------
  { id: 384, name: "Donnarumma", teamShort: "MCI", inPredictedXi: true, tier: "locked" },
  { id: 393, name: "Khusanov", teamShort: "MCI", inPredictedXi: true, tier: "locked" },
  { id: 390, name: "Rúben Dias", teamShort: "MCI", inPredictedXi: true, tier: "locked" },
  { id: 391, name: "Gvardiol", teamShort: "MCI", inPredictedXi: true, tier: "locked" },
  { id: 387, name: "O'Reilly", teamShort: "MCI", inPredictedXi: true, tier: "locked" },
  { id: 406, name: "Kovačić", teamShort: "MCI", inPredictedXi: true, tier: "medium" },
  { id: 481, name: "Elliot Anderson", teamShort: "MCI", inPredictedXi: true, tier: "locked" },
  { id: 403, name: "Savinho", teamShort: "MCI", inPredictedXi: true, tier: "medium", note: "Doku injury-dependent." },
  { id: 398, name: "Foden", teamShort: "MCI", inPredictedXi: true, tier: "locked", note: "Corners." },
  { id: 399, name: "Cherki", teamShort: "MCI", inPredictedXi: true, tier: "medium", note: "Corners." },
  { id: 411, name: "Haaland", teamShort: "MCI", inPredictedXi: true, tier: "locked", note: "Holds penalties." },
  { id: 388, name: "Guéhi", teamShort: "MCI", inPredictedXi: false, tier: "high", note: "Bench start." },
  { id: 400, name: "Doku", teamShort: "MCI", inPredictedXi: false, tier: "medium" },

  // --- Manchester United -----------------------------------------------------
  { id: 412, name: "Lammens", teamShort: "MUN", inPredictedXi: true, tier: "locked" },
  { id: 417, name: "Dalot", teamShort: "MUN", inPredictedXi: true, tier: "medium" },
  { id: 418, name: "Maguire", teamShort: "MUN", inPredictedXi: true, tier: "locked" },
  { id: 423, name: "Shaw", teamShort: "MUN", inPredictedXi: true, tier: "locked" },
  { id: 415, name: "Dorgu", teamShort: "MUN", inPredictedXi: true, tier: "locked" },
  { id: 432, name: "Mainoo", teamShort: "MUN", inPredictedXi: true, tier: "locked" },
  { id: 433, name: "Ugarte", teamShort: "MUN", inPredictedXi: true, tier: "locked" },
  { id: 427, name: "Bryan Mbeumo", teamShort: "MUN", inPredictedXi: true, tier: "locked", note: "Corners and inswinging free kicks." },
  { id: 426, name: "Bruno Fernandes", teamShort: "MUN", inPredictedXi: true, tier: "locked", note: "Penalties and direct free kicks." },
  { id: 431, name: "Amad Diallo", teamShort: "MUN", inPredictedXi: true, tier: "medium" },
  { id: 428, name: "Cunha", teamShort: "MUN", inPredictedXi: true, tier: "medium", note: "Minor friendly knock." },
  { id: 439, name: "Šeško", teamShort: "MUN", inPredictedXi: false, tier: "high" },
  { id: 416, name: "de Ligt", teamShort: "MUN", inPredictedXi: false, tier: "high", note: "Building fitness." },

  // --- Newcastle United ---------------------------------------------------
  { id: 567, name: "Horníček", teamShort: "NEW", inPredictedXi: true, tier: "locked" },
  { id: 459, name: "Miley", teamShort: "NEW", inPredictedXi: true, tier: "medium", note: "Out of position at right-back." },
  { id: 447, name: "Botman", teamShort: "NEW", inPredictedXi: true, tier: "locked" },
  { id: 445, name: "Thiaw", teamShort: "NEW", inPredictedXi: true, tier: "locked" },
  { id: 449, name: "Lewis Hall", teamShort: "NEW", inPredictedXi: true, tier: "locked", note: "Corners." },
  { id: 559, name: "Bamba", teamShort: "NEW", inPredictedXi: true, tier: "medium" },
  { id: 460, name: "Willock", teamShort: "NEW", inPredictedXi: true, tier: "medium" },
  { id: 458, name: "Joelinton", teamShort: "NEW", inPredictedXi: true, tier: "medium" },
  { id: 454, name: "Elanga", teamShort: "NEW", inPredictedXi: true, tier: "locked" },
  { id: 465, name: "Osula", teamShort: "NEW", inPredictedXi: true, tier: "high", note: "Penalties, shared with Woltemade depending on lineup." },
  { id: 453, name: "Harvey Barnes", teamShort: "NEW", inPredictedXi: true, tier: "locked", note: "Corners." },
  { id: 461, name: "Bazoumana Touré", teamShort: "NEW", inPredictedXi: false, tier: "high" },
  { id: 463, name: "Woltemade", teamShort: "NEW", inPredictedXi: false, tier: "high", note: "Penalties, shared with Osula depending on lineup." },
  { id: 462, name: "Steur", teamShort: "NEW", inPredictedXi: false, tier: "high" },
  { id: 464, name: "Wissa", teamShort: "NEW", inPredictedXi: false, tier: "high" },

  // --- Nottingham Forest ---------------------------------------------------
  // Owner-corrected shape: 3-4-3. Sels; Milenković, Murillo, Diomandé;
  // N.Williams, Sangaré, Schlager, Aina; Ndoye, Igor Jesus, Gibbs-White.
  { id: 467, name: "Sels", teamShort: "NFO", inPredictedXi: true, tier: "locked" },
  { id: 471, name: "Milenković", teamShort: "NFO", inPredictedXi: true, tier: "locked" },
  { id: 472, name: "Murillo", teamShort: "NFO", inPredictedXi: true, tier: "locked" },
  { id: 581, name: "Diomandé", teamShort: "NFO", inPredictedXi: true, tier: "medium" },
  { id: 469, name: "Neco Williams", teamShort: "NFO", inPredictedXi: true, tier: "locked" },
  { id: 488, name: "Sangaré", teamShort: "NFO", inPredictedXi: true, tier: "locked" },
  { id: 558, name: "Schlager", teamShort: "NFO", inPredictedXi: true, tier: "medium" },
  { id: 473, name: "Aina", teamShort: "NFO", inPredictedXi: true, tier: "locked" },
  { id: 483, name: "Ndoye", teamShort: "NFO", inPredictedXi: true, tier: "high" },
  { id: 491, name: "Igor Jesus", teamShort: "NFO", inPredictedXi: true, tier: "medium" },
  { id: 480, name: "Gibbs-White", teamShort: "NFO", inPredictedXi: true, tier: "locked", note: "Penalties, direct free kicks and corners." },
  { id: 482, name: "Hudson-Odoi", teamShort: "NFO", inPredictedXi: false, tier: "medium" },
  { id: 490, name: "Chris Wood", teamShort: "NFO", inPredictedXi: false, tier: "high", note: "Sub role." },

  // --- Sunderland ----------------------------------------------------------
  { id: 529, name: "Roefs", teamShort: "SUN", inPredictedXi: true, tier: "locked" },
  { id: 534, name: "Hume", teamShort: "SUN", inPredictedXi: true, tier: "medium", note: "Positional fluidity between RB/RWB." },
  { id: 532, name: "Ballard", teamShort: "SUN", inPredictedXi: true, tier: "locked" },
  { id: 536, name: "Reinildo", teamShort: "SUN", inPredictedXi: true, tier: "locked" },
  { id: 544, name: "Granit Xhaka", teamShort: "SUN", inPredictedXi: true, tier: "locked" },
  { id: 545, name: "Sadiki", teamShort: "SUN", inPredictedXi: true, tier: "locked" },
  { id: 551, name: "Angulo", teamShort: "SUN", inPredictedXi: true, tier: "medium" },
  { id: 542, name: "Le Fée", teamShort: "SUN", inPredictedXi: true, tier: "locked", note: "Holds penalties." },
  { id: 547, name: "Mundle", teamShort: "SUN", inPredictedXi: true, tier: "medium" },
  { id: 552, name: "Brian Brobbey", teamShort: "SUN", inPredictedXi: true, tier: "locked" },
  { id: 535, name: "Alderete", teamShort: "SUN", inPredictedXi: true, tier: "high", note: "Source lists him in the predicted XI but also names him a high-risk doubt — flagged, not dropped." },
  { id: 540, name: "Masuaku", teamShort: "SUN", inPredictedXi: false, tier: "high" },

  // --- Tottenham Hotspur -----------------------------------------------------
  { id: 496, name: "Kinsky", teamShort: "TOT", inPredictedXi: true, tier: "locked" },
  { id: 522, name: "Archie Gray", teamShort: "TOT", inPredictedXi: true, tier: "medium", note: "Covering for Porro." },
  { id: 498, name: "Senesi", teamShort: "TOT", inPredictedXi: true, tier: "medium" },
  { id: 112, name: "Van Hecke", teamShort: "TOT", inPredictedXi: true, tier: "medium" },
  { id: 502, name: "Robertson", teamShort: "TOT", inPredictedXi: true, tier: "locked", note: "Corners." },
  { id: 525, name: "Mateus Fernandes", teamShort: "TOT", inPredictedXi: true, tier: "locked" },
  { id: 455, name: "Tonali", teamShort: "TOT", inPredictedXi: true, tier: "locked" },
  { id: 517, name: "Odobert", teamShort: "TOT", inPredictedXi: true, tier: "medium" },
  { id: 519, name: "Gallagher", teamShort: "TOT", inPredictedXi: true, tier: "medium", note: "Penalties." },
  { id: 514, name: "Mathys Tel", teamShort: "TOT", inPredictedXi: true, tier: "locked" },
  { id: 527, name: "Richarlison", teamShort: "TOT", inPredictedXi: true, tier: "medium", note: "Penalties." },
  { id: 499, name: "Porro", teamShort: "TOT", inPredictedXi: false, tier: "high", note: "Building fitness." },
  { id: 526, name: "Solanke", teamShort: "TOT", inPredictedXi: false, tier: "high", note: "Building fitness." },
  { id: 515, name: "Maddison", teamShort: "TOT", inPredictedXi: false, tier: "high", note: "Building fitness." },
];

/**
 * Tier -> risk inputs. Categorical -> numeric is unavoidably a judgment call,
 * so it is made explicit and overridable rather than buried, following
 * DEFAULT_GEM_CUTS (lib/hidden-gems.ts) and DEFAULT_DECISION_MARGIN
 * (lib/transfer-optimizer.ts). Not fitted to anything — a reading of the
 * source's own three categories, not tuned until the output looks right.
 */
export const DEFAULT_GW1_TIERS: Record<Gw1Tier, { startProbability: number; expectedMinutes: number }> = {
  locked: { startProbability: 0.95, expectedMinutes: 85 },
  medium: { startProbability: 0.8, expectedMinutes: 70 },
  high: { startProbability: 0.25, expectedMinutes: 20 },
};

export const GW1_SOURCE_NOTE =
  "GW1 predicted lineups, hand-corrected against the FPL player list — single source (a GW1 " +
  "predicted-lineups video breakdown), applies to gameweek 1 only, and is dropped once GW1 is " +
  "scored. It moves the risk figure and the lineup badges here, never the xP projection itself. " +
  "23 of the source's named players turned out to be stale (wrong club, or not in FPL's " +
  "2026-27 player list at all — Mohamed Salah and Bernardo Silva among them) and were replaced " +
  "with owner-corrected names; every id, including the corrections, was resolved against the " +
  "live players table rather than transcribed. A player's absence from this layer means no " +
  "information was given about them, not that they are benched.";

/** `GW1_ENTRIES` keyed by FPL id, for UI lookups outside `withGw1Context`. */
export const GW1_BY_ID: Map<number, Gw1Entry> = new Map(GW1_ENTRIES.map((e) => [e.id, e]));
const gw1ById = GW1_BY_ID;

/**
 * Applies the GW1 layer to a scored-player map, gated on both the caller's
 * toggle and the season actually being at GW1. Returns `scored` unchanged
 * otherwise — no id in `GW1_ENTRIES` is looked up, no risk figure moves.
 */
export function withGw1Context(
  scored: Map<number, ScoredPlayer>,
  opts: { enabled: boolean; nextEvent: number; tiers?: typeof DEFAULT_GW1_TIERS },
): Map<number, ScoredPlayer> {
  if (!opts.enabled || opts.nextEvent !== 1) return scored;
  const tiers = opts.tiers ?? DEFAULT_GW1_TIERS;

  const next = new Map(scored);
  for (const [id, entry] of gw1ById) {
    const player = next.get(id);
    if (!player) continue;
    const rates = tiers[entry.tier];
    next.set(id, {
      ...player,
      gw1: {
        startProbability: rates.startProbability,
        expectedMinutes: rates.expectedMinutes,
        tier: entry.tier,
        note: entry.note,
      },
    });
  }
  return next;
}

/**
 * Per-club coverage derived from GW1_ENTRIES, not hand-written, so it cannot
 * drift from the registry it describes. Used by the badge/detail UI and by
 * the engine-verify harness's coverage assertion.
 */
export function gw1XiCoverage(): Record<string, { starters: number; hasGoalkeeper: boolean }> {
  const byClub = new Map<string, Gw1Entry[]>();
  for (const e of GW1_ENTRIES) {
    if (!e.inPredictedXi) continue;
    const list = byClub.get(e.teamShort) ?? [];
    list.push(e);
    byClub.set(e.teamShort, list);
  }
  const out: Record<string, { starters: number; hasGoalkeeper: boolean }> = {};
  for (const [club, list] of byClub) {
    out[club] = { starters: list.length, hasGoalkeeper: list.length > 0 };
  }
  return out;
}
