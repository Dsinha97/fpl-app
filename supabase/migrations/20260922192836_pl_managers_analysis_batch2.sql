-- Club tactical analysis, second batch: Hull City, Arsenal, Tottenham,
-- Chelsea, Manchester United — all re-sourced to The Adam Clery Football
-- Channel. Same treatment as Brighton (20260922190315_pl_managers_analysis.sql):
-- sectioned prose into `analysis`, traits rewritten qualitatively from the new
-- source, and the old source's modifiers emptied because the new one gives no
-- such figures. A trait group the new source says nothing about is omitted
-- rather than carried over from the old one. Transcribed opinion, context only.

-- ------------------------------------------------------------ Hull City
update public.pl_managers
   set preferred_formation = '5-4-1',
       pressing_intensity = 'medium',
       source_file = 'Why The Premier League Is So EASY For Hull City (The Adam Clery Football Channel)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "pivots": {
           "profile_required": "central_screen",
           "xp_impact": "Two central midfielders stay compact in front of the back five and jump onto receivers baited into the pocket between the lines; going long to McBurnie keeps them from being dragged out of shape"
         },
         "strikers": {
           "profile_required": "box_presence_target",
           "xp_impact": "McBurnie is the direct outlet — he drifts into the wide channels to contest aerial and physical duels against fullbacks, with teammates collecting the knockdowns"
         },
         "wingers": {
           "role": "second_ball_runner",
           "xp_impact": "Lock onto the knockdown zones around McBurnie to win possession high; tuck inside when defending, which leaves the far touchline exposed"
         },
         "fullbacks": {
           "role": "back_five_wing_back",
           "xp_impact": "Defend narrow in the back five and concede the flanks to invite crosses; exposed 1v1 by fast switches before the line shifts"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Out of possession: the deliberately decompacted block",
           "points": [
             { "label": "Base 5-4-1", "text": "A low-to-mid 5-4-1 block, a move away from the 4-2-3-1 used in the Championship." },
             { "label": "Baiting space between the lines", "text": "Hull deliberately leave gaps between the defensive and midfield lines, inviting the ball carrier to play into the interior corridor rather than circulate around the block." },
             { "label": "Synchronised jumping", "text": "Once an opponent plays into that central pocket, the back five or the midfield pivot jump together to collapse onto the receiver, with teammates covering immediately behind." }
           ]
         },
         {
           "heading": "Funnelling to the flanks: aerial superiority traps",
           "points": [
             { "label": "Central congestion", "text": "Three centre-backs (John Egan, Semi Ajayi, Noble Mendy) and two central midfielders stay compact inside the box, forcing attacks out wide." },
             { "label": "Cross domination", "text": "Hull concede the flanks on purpose to draw high cross volumes — 34 crosses faced against Coventry, 39 against Manchester United. Egan and Ajayi win 60–70%+ of their ground and aerial duels, clearing the first ball before a good chance develops." }
           ]
         },
         {
           "heading": "Transition: target directness",
           "points": [
             { "label": "Direct over the block", "text": "In transition Hull skip midfield circulation entirely and go straight to Ollie McBurnie." },
             { "label": "Target isolation in wide channels", "text": "McBurnie leaves the central corridor to contest duels against opposing fullbacks out wide. That keeps Hull's midfielders in shape and stops clearances coming straight back toward goal." },
             { "label": "Second balls", "text": "Wingers and midfielders crowd the knockdown zones around McBurnie to secure possession in advanced areas." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Rapid switches", "text": "Defending narrow with a back five and tucked-in wide midfielders leaves the far touchline open. Quick switches that avoid McBurnie's channel pressure can isolate a wing-back 1v1 before the line shifts." },
             { "label": "Low cutbacks", "text": "High crosses play into Hull's aerial strength. Low cutbacks to the edge of the area — the space vacated by retreating centre-backs — exploit the gap in front of the five-man line." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'jakirovic_sergej';

-- ------------------------------------------------------------ Arsenal
update public.pl_managers
   set preferred_formation = '4-3-3 / 4-4-2 press',
       source_file = 'Why Arsenal Are STILL Getting Better Under Mikel Arteta (The Adam Clery Football Channel)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "inverted_pivot",
           "xp_impact": "Calafiori leaves left-back to play as an inverted midfielder or join the last line; Ben White combines in the right-side triangle. The left channel he vacates is the target on turnovers"
         },
         "wingers": {
           "role": "width_holder",
           "xp_impact": "Tzolis holds the left touchline to be released 1v1 after the right-side overload; Saka combines in tight triangles on the right"
         },
         "pivots": {
           "profile_required": "rest_defence_anchor",
           "xp_impact": "Rice anchors a 2+1 rest defence with Gabriel and Saliba; if he is drawn forward, turnovers find open ground in front of the centre-backs"
         },
         "strikers": {
           "profile_required": "dropping_forward",
           "xp_impact": "Havertz drops deep to drag a centre-back out of the line, then spins into the vacated half-space; second-line runners attack the gap"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: fluid rotations and fullback inversion",
           "points": [
             { "label": "4-3-3 to a free-form front line", "text": "In possession Arsenal drop rigid positions and rotate players across all five vertical channels. Calafiori often leaves left-back to play as an inverted midfielder or an extra striker on the last line." },
             { "label": "Local triangles, global width", "text": "Saka, Ødegaard, Havertz and Ben White combine tightly on the right, while Christos Tzolis holds full width on the opposite touchline to keep the back line stretched." },
             { "label": "Dragging man-markers", "text": "Havertz and Ødegaard drop into midfield together. When defenders follow, gaps open between the centre-backs for second-line runners such as Myles Lewis-Skelly or Gabriel." }
           ]
         },
         {
           "heading": "Pressing and rest defence",
           "points": [
             { "label": "High press", "text": "Arsenal press from a 4-2-4 / 4-4-2 base, locking passing lanes and forcing long clearances." },
             { "label": "Rest-defence exposure", "text": "When Calafiori attacks centrally or joins the front line, Arsenal rely on a 2+1 rest defence (Gabriel, William Saliba, Declan Rice). A middle-third turnover leaves the vacated left channel open to direct balls." }
           ]
         },
         {
           "heading": "In possession: dilemmas between the lines",
           "points": [
             { "label": "Drop and spin", "text": "Havertz drops deep to receive facing his own goal, pulling a centre-back out of line, then spins into the vacated half-space." },
             { "label": "Overload to isolate", "text": "Sustained passing draws the block toward the right before the ball goes through Calafiori to release Tzolis 1v1 on the left." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Calafiori's vacated flank", "text": "Quick diagonals into the wide channel Calafiori vacates arrive before Gabriel can slide across to cover the 1v1." },
             { "label": "Rest-defence gaps on turnovers", "text": "If Rice is drawn forward, transitions into the space between midfield and the back line leave the centre-backs isolated in open ground." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'arteta_mikel';

-- ------------------------------------------------------------ Tottenham
update public.pl_managers
   set source_file = 'Why De Zerbi''s Tottenham Have Started The Season SO Badly (The Adam Clery Football Channel)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "pivots": {
           "profile_required": "single_pivot_screen",
           "xp_impact": "Tonali anchors as a single or double pivot but often mistimes his steps, leaving space in front of the centre-backs — and has to cover wide when the fullbacks are caught high"
         },
         "fullbacks": {
           "role": "high_advanced_fullback",
           "xp_impact": "Push high in possession; direct balls into the channels behind them bypass the press"
         },
         "strikers": {
           "profile_required": "pressing_enabler",
           "xp_impact": "Part of the league's highest pressing-sequence volume, but only ~5% of high turnovers become shots for lack of supporting runs and angles"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: vertical compression vs defensive disconnect",
           "points": [
             { "label": "Stretched build-up", "text": "Roberto De Zerbi sets Tottenham up to hold the ball high and bait the opponent's press before playing through the central lines." },
             { "label": "Broken pivot screen", "text": "Sandro Tonali anchors as a single or double pivot but often mistimes his steps. Big distances open between the pressing forwards and the back line, leaving space in front of the centre-backs." },
             { "label": "Overextended fullbacks", "text": "The fullbacks push high, so the defensive midfielder has to cover wide areas whenever the ball is lost." }
           ]
         },
         {
           "heading": "Pressing: volume without conversion",
           "points": [
             { "label": "High pressing volume", "text": "First in the league for pressing sequences and fifth for high turnovers — Tottenham hunt the ball in the opponent's defensive third." },
             { "label": "No decisive support", "text": "After winning the ball high, forward options lack supporting angles and timing: only about 5% of those turnovers end in a shot." },
             { "label": "Edge of the box unprotected", "text": "In settled defence, midfielders watch the ball instead of tracking runners into the arc, conceding open shooting lanes." }
           ]
         },
         {
           "heading": "In possession: inefficient chance creation",
           "points": [
             { "label": "Low-xG shots", "text": "Territorial control without coordinated box entries leads to speculative long-range shots rather than high-probability cutbacks." },
             { "label": "No central ball carrying", "text": "The midfield rarely carries through a congested block, so circulation stays on the predictable perimeter." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Balls over the high line", "text": "Opponents bypass the front press with direct passes into the wide channels behind the advanced fullbacks." },
             { "label": "Space behind Tonali", "text": "Midfield runners driving through the centre exploit the gap between Tottenham's midfield and retreating centre-backs." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'de_zerbi_roberto';

-- ------------------------------------------------------------ Chelsea
update public.pl_managers
   set preferred_formation = '3-4-2-1 / 5-4-1',
       buildup_style = 'bait_press',
       source_file = 'Why Chelsea Are SERIOUS Title Contenders (The Adam Clery Football Channel)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "flexible_back_three",
           "xp_impact": "Gusto and Hato hold the width; outside centre-backs Lacroix and Acheampong underlap into the front line, and Acheampong and Gusto jump high on the sideline pressing trigger"
         },
         "pivots": {
           "profile_required": "box_midfield_pivot",
           "xp_impact": "Reece James and Lavia form the base of a box midfield with Palmer and Rogers, giving central superiority in the middle third"
         },
         "wingers": {
           "role": "inside_playmaker",
           "xp_impact": "Palmer and Rogers play inside at the top of the box; Palmer drops into the half-space a forward-running Lacroix vacates. First targets in a two-to-four-pass vertical release"
         },
         "strikers": {
           "profile_required": "vertical_outlet",
           "xp_impact": "João Pedro is a first vertical target in transition, attacking the equal-numbers (3v3, 2v2) situations Chelsea engineer by inviting pressure"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: hybrid 3-4-2-1 / 5-4-1",
           "points": [
             { "label": "Structural flexibility", "text": "Xabi Alonso's Chelsea play a 3-4-2-1 in possession that drops into a 5-4-1 low-to-mid block without the ball." },
             { "label": "Box midfield", "text": "With Malo Gusto and Jorrel Hato holding the width, two pivots (Reece James, Roméo Lavia) and two inside playmakers (Cole Palmer, Morgan Rogers) form a central box for numerical superiority in midfield." },
             { "label": "Extreme rotations", "text": "Outside centre-backs such as Maxence Lacroix or Josh Acheampong make deep underlapping runs into the front line. When Lacroix goes high, Palmer drops into the half-space he left, scrambling the opponent's marking." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Central funnelling", "text": "The front three and midfield screen the central corridors, daring the opponent to go wide to the fullbacks." },
             { "label": "Sideline jump", "text": "A pass toward the touchline triggers a collective jump: Acheampong and Gusto press high into the opponent's defensive third while the other two centre-backs dominate the resulting aerial clearances." }
           ]
         },
         {
           "heading": "Transition: vertical directness",
           "points": [
             { "label": "Direct release", "text": "Rather than linger in build-up, Chelsea go forward to João Pedro, Palmer or Rogers in two to four passes." },
             { "label": "Manufacturing 1v1s", "text": "Inviting opponents to hold the ball and push men forward creates equal-numbers transitions (3v3, 2v2) instead of attacks into a packed low block." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Stretched back three", "text": "Wide rotations by the outside centre-backs stretch the distances across the back three; quick vertical combinations run through the seams between Levi Colwill and the wide centre-backs." },
             { "label": "Goalkeeper hesitation", "text": "A high starting position plus indecision about sweeping or holding the line exposes Chelsea to transitional cutbacks." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'alonso_xabi';

-- ------------------------------------------------------------ Manchester United
update public.pl_managers
   set preferred_formation = '4-2-3-1 / 4-4-2',
       source_file = 'Why Michael Carrick''s Man United ISN''T Working (The Adam Clery Football Channel)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "pivots": {
           "profile_required": "deep_playmaker",
           "xp_impact": "Mainoo and Tielemans step to passes after they are struck rather than anticipating, and hold no cover shadow — opponents pass straight through the double pivot"
         },
         "fullbacks": {
           "role": "high_overlapping_crosser",
           "xp_impact": "Advance high; with little counter-pressing behind them, opposing runners attack the space they leave in transition"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: the chasm between the lines",
           "points": [
             { "label": "Passive mid-block", "text": "Michael Carrick's United defend in a 4-2-3-1 / 4-4-2, but the vertical gap between the back line and the double pivot is far too large." },
             { "label": "No compact funnelling", "text": "When pressing toward the touchline, United don't slide across as a unit. Instead of an overload they are left 5v4 down on the ball side, opening interior passing lanes." },
             { "label": "Hesitant back line", "text": "When the opposing striker drops, the centre-backs hold position instead of tracking him, leaving room to turn unchallenged." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Reactive stepping", "text": "Midfielders such as Kobbie Mainoo and Youri Tielemans react once a pass is struck rather than moving while it travels, arriving late to challenges." },
             { "label": "Unscreened centre", "text": "Opponents pass straight through the double pivot because neither midfielder sets an active cover shadow." },
             { "label": "Slow recovery", "text": "Once the first line is bypassed, tracking back is slow, stranding the back four in open 4v4s on the halfway line." }
           ]
         },
         {
           "heading": "In possession: the possession dichotomy",
           "points": [
             { "label": "Better without the ball", "text": "United take 2.66 points per game with under 50% possession, living off counterattacks, but only 1.6 with over 50%." },
             { "label": "No half-space operator", "text": "There is no genuine interior playmaker who thrives in the tight space between the opposition's midfield and defence." },
             { "label": "Bruno drops deep", "text": "Bruno Fernandes drops into the defensive third, onto the centre-backs' toes, to play from deep — leaving the central pocket empty and the low block unthreatened." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Central corridor", "text": "Opponents progress repeatedly with ground passes through the gaps between United's central midfielders." },
             { "label": "Isolated fullbacks in transition", "text": "With no effective counter-press, runners exploit the space behind the advancing fullbacks to create quick overloads." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'carrick_michael';
