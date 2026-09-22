-- Club tactical analysis: Bournemouth. Same treatment as batches 1–4.

update public.pl_managers
   set preferred_formation = '4-2-3-1',
       source_file = 'Marco Rose BOTTLES It Again! | Newcastle 2-2 Bournemouth Tactical Analysis (The Football Connect)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "pivots": {
           "profile_required": "screening_double_pivot",
           "xp_impact": "The double pivot protects the centre so the attacking midfielders can press, and collapses on opponents receiving back to goal in midfield; Scott sets the tempo and picks forward passes into the channels"
         },
         "fullbacks": {
           "role": "touchline_marker",
           "xp_impact": "Truffert tracks opposing wide runners stride for stride down the left"
         },
         "wingers": {
           "role": "transition_runner",
           "xp_impact": "Tavernier and Kluivert are the targets of fast, direct sequences, running behind the back line on the first pass"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: the vertical 4-2-3-1",
           "points": [
             { "label": "Mid-block base", "text": "Marco Rose sets Bournemouth up in an athletic 4-2-3-1, with the double pivot protecting the centre so the attacking midfield line can press aggressively." },
             { "label": "Rest defence", "text": "When attacking, Bournemouth keep four players behind the ball to secure the central corridor against counters." },
             { "label": "Touchline containment", "text": "Left-back Adrien Truffert matches opposing wide runners stride for stride, stopping progress down that flank." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Central turnover trap", "text": "Pressure starts when an opponent receives back to goal in the middle third; the double pivot collapses around the ball carrier to force a quick turnover." },
             { "label": "Counter-pressing high", "text": "Rather than drop into a low block early, Bournemouth hunt loose balls in advanced areas — 13 shots in the first half against Newcastle." }
           ]
         },
         {
           "heading": "In possession: Scott and fast transitions",
           "points": [
             { "label": "Scott sets the tempo", "text": "Alex Scott is the central playmaker, picking out forward passes into open channels." },
             { "label": "Direct box entries", "text": "Fast, direct sequences into Marcus Tavernier and Justin Kluivert produced 1.50 xG from 17 shots." },
             { "label": "Running in behind", "text": "Attackers run behind the back line on the first pass, creating immediate 1v1 chances in the box." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Late-game collapse", "text": "In the last ten minutes Bournemouth retreat into an uncoordinated, passive low block — four of their five goals conceded this season came after the 88th minute." },
             { "label": "Poor clearances", "text": "When pinned deep, defenders don't clear second balls decisively beyond the arc, leaving free shooting lanes for late midfield runners." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Block height late on", "text": "Compare the back four's average depth in minutes 1–75 with minutes 76–90." },
             { "label": "Scott's forward passing", "text": "What share of Scott's progressive passes reach the final third on counters?" },
             { "label": "Clearance zones", "text": "Do clearances in the box go out wide, or drop into the central arc?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'rose_marco';
