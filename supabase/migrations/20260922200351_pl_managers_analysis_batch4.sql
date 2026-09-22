-- Club tactical analysis, fourth batch: Aston Villa, Crystal Palace,
-- Nottingham Forest, Everton, Newcastle United — same treatment as batches
-- 1–3. Also corrects four player names batch 3 carried over from source
-- transcripts, confirmed by the owner:
--   Sunderland: "Mthali" -> Dayann Methalie, "Ayman Sadiki" -> Noah Sadiki
--   Brentford:  "Yunus Sari" -> Mamadou Sangare, "Daniel Turt" -> Jaidon Anthony

-- ------------------------------------------------------------ name fixes
update public.pl_managers
   set analysis = replace(replace(replace(analysis::text,
         'Wing-backs Mthali', 'Wing-backs Dayann Methalie'),
         'Mthali', 'Methalie'),
         'Ayman Sadiki', 'Noah Sadiki')::jsonb,
       tactical_traits = replace(tactical_traits::text, 'Mthali', 'Methalie')::jsonb
 where manager_key = 'lebris_regis';

update public.pl_managers
   set analysis = regexp_replace(regexp_replace(replace(replace(analysis::text,
         'Yunus Sari', 'Mamadou Sangare'),
         'Daniel Turt', 'Jaidon Anthony'),
         '\mSari\M', 'Sangare', 'g'),
         '\mTurt\M', 'Anthony', 'g')::jsonb,
       tactical_traits = regexp_replace(regexp_replace(tactical_traits::text,
         '\mSari\M', 'Sangare', 'g'),
         '\mTurt\M', 'Anthony', 'g')::jsonb
 where manager_key = 'andrews_keith';

-- ------------------------------------------------------------ Aston Villa
update public.pl_managers
   set preferred_formation = '4-4-2 / 5-3-2',
       source_file = 'This New Aston Villa Are Going to Shock Everyone (Bains Analysis)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "flexible_back_five",
           "xp_impact": "In the flat 4-4-2 Rogério was left 1v1 against Savinho; the 5-3-2 fix drops McGinn in as a temporary right wing-back and brings Buendía across to double up on the left"
         },
         "wingers": {
           "role": "two_way_wide_midfielder",
           "xp_impact": "McGinn tracks overlapping fullbacks into the back line; Buendía tucks inside to cover central midfield while helping on the left touchline"
         },
         "strikers": {
           "profile_required": "mobile_front_two",
           "xp_impact": "Jackson alternates dropping to feet and spinning into the channels, isolating centre-backs 1v1 in transition; Manzambi arrives late from the #10 space into the box"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: the mid-match shift from 4-4-2 to 5-3-2",
           "points": [
             { "label": "4-4-2 under strain", "text": "Unai Emery started in Villa's signature flat 4-4-2 mid-block. Tottenham pushed Andrew Robertson onto the last line to make a five-man front, pinning Villa's back line and leaving left-back Rogério 1v1 with Savinho." },
             { "label": "Switch to a back five", "text": "Emery moved to a 5-3-2, with right midfielder John McGinn tracking Robertson deep into the back line as a temporary right wing-back." },
             { "label": "Tucking in, doubling up", "text": "Emiliano Buendía moved inside to cover central midfield while helping Rogério on the left touchline, removing the wide disadvantage and closing interior lanes." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Touchline funnelling", "text": "Villa use the sideline as an extra boundary to trap ball carriers once play leaves the central corridor." },
             { "label": "Contain, then jump", "text": "Rather than press high man-to-man, Villa drop into a compact block and only challenge aggressively once the ball is forced into contested wide zones." }
           ]
         },
         {
           "heading": "In possession: mobile front two and direct releases",
           "points": [
             { "label": "Jackson–Manzambi pair", "text": "Nicolas Jackson and Nathan Manzambi play as a fluid front two, with Jackson alternating between dropping to feet and spinning behind the centre-backs into the channels." },
             { "label": "Isolating centre-backs", "text": "Jackson repeatedly isolated Micky van de Ven and Jan Paul van Hecke in 1v1 transition duels, while Manzambi timed late runs from the #10 space into the box." },
             { "label": "Keeper as release valve", "text": "Zion Suzuki's direct long passes bypass a high line to find Jackson early on the counter." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Flat midfield four", "text": "Back in a flat four, the lack of vertical staggering lets opponents find players in the pockets between the lines." },
             { "label": "Wide overloads", "text": "If McGinn doesn't drop into the back line in time, overlapping fullbacks can isolate Villa's outside backs." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "McGinn's depth", "text": "In what share of defensive possessions does McGinn drop level with the centre-backs to make a back five?" },
             { "label": "Jackson's touches", "text": "Are his touches facing goal after channel runs, or back to goal as a dropping link player?" },
             { "label": "Suzuki's long balls", "text": "What share of Suzuki's direct passes into the attacking half within five seconds of a turnover are completed?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'emery_unai';

-- ------------------------------------------------------------ Crystal Palace
update public.pl_managers
   set preferred_formation = '3-4-2-1 / 5-2-3',
       buildup_style = 'direct_possession',
       source_file = 'How Sage''s Palace Edge Arbeloa''s Fulham | Fulham vs Crystal Palace 2-3 | In-Depth Analysis (Greatest Sport)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "asymmetric_wing_back",
           "xp_impact": "The right wing-back pins high while Mitchell starts deeper to draw the opposing right-back out, then attacks the space behind him; the far-side wing-back (Mitchell or Chilwell) crashes the far post"
         },
         "wingers": {
           "role": "inside_forward_ten",
           "xp_impact": "Pino and Nketiah play as twin #10s in the half-spaces; Pino plays first-time around the corner into the channel, and both drop to collect second balls"
         },
         "pivots": {
           "profile_required": "stretched_double_pivot",
           "xp_impact": "Only two central midfielders cover transitions across the full width behind the twin #10s"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: staggered wing-backs and twin #10s",
           "points": [
             { "label": "3-4-2-1 / 5-2-3", "text": "Pierre Sage's Palace play a back three, two central midfielders, two inside #10s (Yeremy Pino and Eddie Nketiah) and attacking wing-backs." },
             { "label": "Asymmetric wing-backs", "text": "The right wing-back pushes high to pin a defender while left wing-back Tyreek Mitchell stays deeper during progression, drawing Fulham's right-back (Timothy Castagne) out to press and opening space behind him." },
             { "label": "Half-space overloads", "text": "Pino and Nketiah operate in the channels between the opposing fullbacks and centre-backs, giving immediate forward passing angles." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Forcing it long", "text": "On opposition goal kicks Palace mark the short options man-to-man, forcing the ball long." },
             { "label": "First header", "text": "Chris Richards steps up to contest and win the first header against the target attacker." },
             { "label": "Second-ball trap", "text": "Pino and Nketiah drop into central pockets on the flick-on to collect second balls before the opponent's midfield can react." }
           ]
         },
         {
           "heading": "In possession: vertical directness and third-man runs",
           "points": [
             { "label": "Around the corner", "text": "Once Pino receives, he plays first-time passes around the corner into the channel." },
             { "label": "Blind-side runs", "text": "Mitchell uses his pace to attack the space behind Castagne, receiving in stride to cross low or finish at the near post." },
             { "label": "Far-post crashes", "text": "When attacks go down the right, the opposite wing-back (Mitchell or Ben Chilwell) attacks the far post unmarked as the back line shifts." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Exposed midfield pair", "text": "With two inside #10s, only two central midfielders cover defensive transitions across the width." },
             { "label": "Isolated centre-backs", "text": "If the first pressing wave is bypassed, the wide centre-backs can be pulled into uncomfortable 1v1s in the channels." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Mitchell's starting position", "text": "How deep does Mitchell sit relative to the midfield line during goal-kick build-up?" },
             { "label": "Pino's layoffs", "text": "Count Pino's first-time vertical releases into the wide channels after receiving between the lines." },
             { "label": "Second balls", "text": "What share of Richards' won headers turn into controlled Palace possession?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'sage_pierre';

-- ------------------------------------------------------------ Nottingham Forest
update public.pl_managers
   set preferred_formation = '5-2-2-1 / 5-4-1',
       buildup_style = 'direct_possession',
       pressing_intensity = 'medium',
       source_file = 'I Analysed Oliver Glasner''s Nottingham Forest System (The Villans)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "wide_wing_back",
           "xp_impact": "Williams and Aina provide nearly all of Forest's width, with Williams the target for Murillo's diagonals; fast switches drag the outside centre-backs wide"
         },
         "pivots": {
           "profile_required": "flat_double_pivot",
           "xp_impact": "Schlager and McAtee often sit on the same line, leaving pockets either side of them; Schlager plays vertical passes into Gibbs-White on the half-turn"
         },
         "wingers": {
           "role": "narrow_ten_runner",
           "xp_impact": "Gibbs-White and Ndoye play narrow as twin #10s, run beyond Delap when he drops, and fall into a flat midfield four without the ball"
         },
         "strikers": {
           "profile_required": "dropping_forward",
           "xp_impact": "Delap drops into midfield facing his own goal to pull a centre-back forward for the runners behind him"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: narrow 5-2-2-1 and a flat midfield pair",
           "points": [
             { "label": "Base 5-2-2-1", "text": "Oliver Glasner's Forest play a 5-2-2-1 that becomes a 5-4-1 or 5-3-2 without the ball: centre-backs Murillo, Nikola Milenković and Morato/Cunha, with wing-backs Neco Williams and Ola Aina." },
             { "label": "Unstaggered pivot", "text": "Xaver Schlager and James McAtee often occupy the same horizontal line in average-position data, opening big pockets either side of the pair." },
             { "label": "Narrow attack", "text": "The two #10s, Morgan Gibbs-White and Dan Ndoye, play very narrow, concentrating play centrally and leaving the width almost entirely to the wing-backs." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Centre-back stepping", "text": "When an opposing playmaker receives in the pocket, Milenković steps out of the back three to challenge — and if he misses, space opens straight behind him." },
             { "label": "5-4-1 reshuffle", "text": "Holding shape, Gibbs-White and Ndoye drop wide into a flat midfield four to protect the half-spaces." }
           ]
         },
         {
           "heading": "In possession: striker drops and runners beyond",
           "points": [
             { "label": "The false-target drop", "text": "Liam Delap drops into the midfield line facing his own goal, pulling a centre-back forward." },
             { "label": "Runs beyond", "text": "As Delap drops, Gibbs-White and Ndoye run beyond him together into the vacated central space." },
             { "label": "Progression routes", "text": "Forest progress with direct diagonals from Murillo out to Williams, or vertical passes from Schlager into Gibbs-White on the half-turn." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Either side of the midfield two", "text": "A three-man midfield or inverted wingers can exploit the space outside Schlager and McAtee." },
             { "label": "Stretching the back five", "text": "Fast switches force the back line to slide, pulling the outside centre-backs into wide coverage." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Pivot staggering", "text": "In settled defence, how far apart vertically are Schlager and McAtee — and how often are they on the same line?" },
             { "label": "Delap's drops", "text": "How often does Delap drop to the centre circle, and does a midfield runner go beyond him when he does?" },
             { "label": "Milenković stepping out", "text": "What's his success rate when he steps out of the line to challenge interior receivers?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'glasner_oliver';

-- ------------------------------------------------------------ Everton
update public.pl_managers
   set preferred_formation = '4-4-2 / 4-5-1 low block',
       pressing_intensity = 'low',
       source_file = '"You can''t change him!" | Gavin Buckland Breaks Down David Moyes'' Tactics (Royal Blue: Everton FC)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "pivots": {
           "profile_required": "compact_bank_of_four",
           "xp_impact": "The midfield four sits tight to the back line to deny any space between the lines"
         },
         "wingers": {
           "role": "defensive_wide_midfielder",
           "xp_impact": "Double up with the fullback when the ball is played tight to the touchline — the only real pressing trigger"
         },
         "strikers": {
           "profile_required": "isolated_lone_striker",
           "xp_impact": "Left isolated when Everton sit deep after the 60th minute, reducing the counter-attacking threat"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: low-block compactness",
           "points": [
             { "label": "Two banks of four", "text": "David Moyes sets Everton up in a disciplined low-to-mid 4-4-2 / 4-5-1, with the main aim of denying penetration through the middle." },
             { "label": "Conceding the flanks", "text": "Opponents are allowed to circulate around the perimeter and progress wide while the box stays congested." },
             { "label": "Tight inter-line spacing", "text": "The midfield four stays close to the back line so opponents can't find space between the lines." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Contain, don't hunt", "text": "No proactive high pressing — Everton hold a containing block until the ball enters their defensive third." },
             { "label": "Sideline trigger", "text": "Pressing starts only when an opponent plays into tight space against the touchline, where the wide midfielder and fullback can double the receiver." }
           ]
         },
         {
           "heading": "Game-state management",
           "points": [
             { "label": "Steady points", "text": "Moyes prioritises risk control and steady away points — Everton have the third-highest away points total in the league this way." },
             { "label": "After 60 minutes", "text": "If the game is level after the 60th minute, Everton lock their shape rather than push numbers forward, relying on solidity to take the draw or nick a goal from a set piece or a counter." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Sustained box pressure", "text": "Sitting deep for long spells hands opponents repeated second balls and shots from around the box." },
             { "label": "Little transition support", "text": "Defending deep late on leaves the lone striker isolated, blunting the counter." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Block height after 60'", "text": "How far is Everton's defensive line from their own goal before and after the 60-minute mark?" },
             { "label": "Rest defence at set pieces", "text": "How many outfield players stay behind halfway on attacking corners and free kicks?" },
             { "label": "Inter-line distance", "text": "Does the gap between midfield and defence exceed 12 metres during settled opponent possession?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'moyes_david';

-- ------------------------------------------------------------ Newcastle United
update public.pl_managers
   set preferred_formation = '4-3-3',
       source_file = 'Why Newcastle''s Fast Start Changed EVERYTHING Against Hull (A Game Of Two Halves)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "pivots": {
           "profile_required": "single_pivot_tempo",
           "xp_impact": "Neave-Stir anchors as a lone pivot dictating tempo; when he went off injured, the reshuffle cost central ball retention and Newcastle conceded 21 shots"
         },
         "fullbacks": {
           "role": "inverted_pivot",
           "xp_impact": "Miley tucks in from right-back to help build-up and rest defence; Hall overlaps for width on the left and steps in front of target men to win long balls"
         },
         "wingers": {
           "role": "inside_carrier",
           "xp_impact": "Barnes cuts inside and carries through the inside-left channel, drawing centre-backs before slipping reverse passes to Willock and Hall"
         },
         "strikers": {
           "profile_required": "pressing_enabler",
           "xp_impact": "Fernández-Pardo presses several defenders in a row, forcing rushed clearances into touch"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: single-pivot 4-3-3 and an inverted fullback",
           "points": [
             { "label": "Asymmetric 4-3-3", "text": "Matthias Jaissle moved Newcastle from a 4-2-4 to a 4-3-3 against Hull's low block, with 18-year-old Sean Neave-Stir anchoring as a lone pivot, dictating tempo." },
             { "label": "Inverted right-back", "text": "Lewis Miley moved from central midfield to right-back, tucking into inside pockets to help build-up and secure rest defence." },
             { "label": "Left-side fluidity", "text": "Joe Willock dropped into the left half-space, Harvey Barnes cut inside toward the box, and left-back Lewis Hall overlapped for outside width." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Fast start", "text": "Newcastle opened with high-intensity pressing to disrupt Hull before their 5-4-1 block could settle." },
             { "label": "Attacking the target man", "text": "When Hull went long to Ollie McBurnie, Hall stepped in front to win the ball before it reached him." },
             { "label": "Chain pressing", "text": "Striker Fernández-Pardo pressed several defenders back-to-back, forcing rushed clearances into touch." }
           ]
         },
         {
           "heading": "In possession: rest defence and half-space combinations",
           "points": [
             { "label": "Winning loose balls", "text": "Newcastle kept their rest defence high to win 50/50s outside Hull's box after blocked shots, keeping attacks alive in the final third." },
             { "label": "Carry and release", "text": "Barnes carried through the inside-left channel, drew centre-backs, and slipped reverse passes to runners (Willock, Hall) for both opening goals." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Losing the pivot", "text": "When Neave-Stir went off injured, moving Miley back into midfield and Malick Thiaw to right-back broke the spacing: Newcastle lost central retention and conceded 21 shots." },
             { "label": "Under a high press", "text": "When opponents press the back line hard, there are no rehearsed escape routes, so Newcastle resort to hurried long balls." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Rest-defence reactions", "text": "How quickly do Miley or Hall contest loose clearances outside the opponent's box?" },
             { "label": "Barnes' releases", "text": "Count Barnes' passes from the inside-left channel to runners breaking into the box." },
             { "label": "Pivot retention", "text": "What is Neave-Stir's pass completion under direct pressure in the central third?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'jaissle_matthias';
