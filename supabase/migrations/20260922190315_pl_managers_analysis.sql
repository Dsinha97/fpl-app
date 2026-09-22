-- Brighton tactical profile refresh, and a home for prose analysis.
--
-- pl_managers only had structured slots (formation, style, four role traits,
-- modifiers), so a sectioned breakdown — out-of-possession shape, pressing
-- triggers, in-possession structure, vulnerabilities — had nowhere to go.
-- `analysis` holds it as an ordered list of sections:
--   [{ "heading": text, "points": [{ "label": text, "text": text }] }]
-- Nullable: the other 19 clubs keep their profiles as-is until they get one.
-- Same footing as tactical_traits — transcribed opinion, shown as context,
-- never read by any projection (TACTICAL_PROFILE_NOTE, lib/tactical-profile.ts).
--
-- Brighton's old traits and modifiers came from a different video and carried
-- its figures ("+10% xG on high turnovers", ×0.9 / ×1.15 / ×1.05). The new
-- source has no such figures, so the traits are rewritten from it
-- qualitatively and the modifiers are emptied rather than left under a source
-- credit that no longer produced them.

alter table public.pl_managers add column analysis jsonb;

update public.pl_managers
   set preferred_formation = '4-2-3-1',
       source_file = 'Why Brighton Are The Premier League''s SCARIEST Team (The Adam Clery Football Channel)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "pivots": {
           "profile_required": "press_resistant_small_space",
           "xp_impact": "A deep pivot (e.g. Groß) drops between or alongside the centre-backs for a +1 against the first pressing line; the double pivot forms triangles with dropping attacking midfielders to circulate"
         },
         "strikers": {
           "profile_required": "pressing_enabler",
           "xp_impact": "Presses on the trigger — a back pass to the goalkeeper or a centre-back — then locks onto the nearest receiver man-to-man"
         },
         "wingers": {
           "role": "box_attacker",
           "xp_impact": "Up to five players flood the penalty box once the opponent commits centrally"
         },
         "fullbacks": {
           "role": "ball_side_trap",
           "xp_impact": "Collapse toward the ball-side touchline to trap an opposing fullback; the far side is left open to quick switches"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Out of possession: base block and triggers",
           "points": [
             { "label": "Zonal mid-block", "text": "A base 4-2-3-1 that holds compact distances between the lines rather than chasing, denying interior passing channels when the opponent circulates centrally." },
             { "label": "Sideline traps", "text": "When play goes to an opposing fullback, the block collapses laterally toward the ball side for a local 5v3, cutting off forward options and forcing the ball back toward the goalkeeper or centre-backs." },
             { "label": "Pressing trigger", "text": "A back pass to the goalkeeper or a centre-back is the cue: the whole side steps out of the mid-block together, from zonal cover into an aggressive high press." }
           ]
         },
         {
           "heading": "Pressing: man-oriented jumps",
           "points": [
             { "label": "Man-marking", "text": "Once triggered, every nearby receiver is picked up man-to-man. Centre-backs step deep into the opponent's defensive third to follow dropping forwards so target players can't turn." },
             { "label": "Body shape", "text": "Pressing opponents who have their backs to goal forces turnovers or rushed clearances into touch — the video counts 41 danger-zone possession losses forced against Arsenal." }
           ]
         },
         {
           "heading": "In possession: proximity and space",
           "points": [
             { "label": "Close proximity", "text": "Players stay within 8–15 metres of each other, so the ball carrier always has three to five short passing options." },
             { "label": "Build-up", "text": "Deep players such as Pascal Groß drop between or alongside the centre-backs to create a +1 against the first pressing line." },
             { "label": "Middle third", "text": "The double pivot and dropping attacking midfielders form triangles to circulate the ball and pull the defensive block out of shape." },
             { "label": "Final third", "text": "Once the opponent commits centrally, up to five players flood the penalty box to attack the open channels." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Over the top", "text": "A high line locked into man-to-man duels can be bypassed with direct, aerial balls into the space behind the back line." },
             { "label": "Switches of play", "text": "Committing five to the ball side leaves the far flank open — a quick switch to an isolated wide runner exploits the reorganisation." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'hurzeler_fabian';
