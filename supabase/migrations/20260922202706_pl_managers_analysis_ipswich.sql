-- Club tactical analysis: Ipswich Town — the last of the 20. Same treatment
-- as batches 1–4, with two differences:
--   * The source names no formation (it says O'Neil favours adaptability over
--     a fixed shape), so preferred_formation keeps its existing value, as with
--     Tottenham in batch 2.
--   * The source is a match preview; its model output (1.25 xG, 32% away-win
--     probability for one fixture) is a single-match forecast, not a tactical
--     trait, so it is left out rather than shown on a standing club profile.
-- The source names no players, so the traits describe roles only.

update public.pl_managers
   set buildup_style = 'direct_possession',
       pressing_intensity = 'medium',
       source_file = 'Everton vs Ipswich | Prediction & xG Analysis (Tactical Logic AI)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "wingers": {
           "role": "transition_runner",
           "xp_impact": "Released straight into open channels off loose balls and clearances, attacking the space behind a block before it sets"
         },
         "pivots": {
           "profile_required": "second_ball_collector",
           "xp_impact": "Crowd the central channel around knockdowns rather than hold a passing structure; after 60 minutes a gap opens between midfield and defence as cup fatigue bites"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: fluid and stretched",
           "points": [
             { "label": "No fixed shape", "text": "Midweek cup congestion and rotation stop Ipswich holding a rigid structure; Gary O'Neil favours an adaptable game model over a fixed formation, shifting shape between phases." },
             { "label": "High-event spacing", "text": "An open, high-variance style stretches the distance between the defensive and forward lines — seven scored and ten conceded in the first four league games." },
             { "label": "Central second-ball clusters", "text": "When play breaks down, Ipswich crowd the central channel around knockdowns instead of forming set passing networks." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Press or drop", "text": "In the first half-hour Ipswich alternate between jumping into an aggressive high press and sitting in a passive block, stepping up together to disrupt build-up when energy allows." },
             { "label": "Rest-defence trade-off", "text": "Pressing high without enough cover behind leaves defenders isolated 1v1 against direct passes." },
             { "label": "Turnover cue", "text": "Loose balls and clearances are the main transition trigger — forward runners are released into open channels immediately." }
           ]
         },
         {
           "heading": "In possession: transition pace and scramble play",
           "points": [
             { "label": "Fast final-third attacks", "text": "Rather than build slowly, Ipswich attack in rapid transition, targeting the space behind the opponent before a low block can set." },
             { "label": "Unstructured second balls", "text": "After long clearances and set-piece deliveries, numbers around the drop zone win possession in advanced areas." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Defensive leaks", "text": "Committing bodies forward without secure rest defence leaves the centre-backs isolated 1v1 — a direct cause of ten goals conceded in four games." },
             { "label": "After 60 minutes", "text": "Midweek cup fatigue brings a physical drop-off in the last half-hour, opening big gaps between midfield and defence and free central corridors for opponents." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Block height after 60'", "text": "Compare the defensive line's distance from its own box before minute 60 with minutes 61–90." },
             { "label": "Second balls", "text": "Count knockdowns and loose-ball scrambles won in the middle third after long distribution." },
             { "label": "Rest defence on counters", "text": "Do Ipswich keep at least three outfield players behind the ball when launching fast counters?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'oneil_gary';
