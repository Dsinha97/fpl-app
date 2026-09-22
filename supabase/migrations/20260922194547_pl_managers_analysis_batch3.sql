-- Club tactical analysis, third batch: Coventry City, Manchester City,
-- Liverpool, Sunderland, Leeds United, Fulham, Brentford. Same treatment as
-- batches 1–2 (sectioned analysis, traits rewritten qualitatively from the new
-- source, old modifiers emptied). These sources also carry a "matchday
-- checklist" — things to watch — kept as a final section. Channels vary, so
-- each source_file names its own. Transcribed opinion, context only.

-- ------------------------------------------------------------ Coventry City
update public.pl_managers
   set preferred_formation = '5-3-2 / 5-4-1',
       source_file = 'Coventry City Updated Tactical Analysis | Can new look Sky Blues shock the Premier League? (Simon Lillibury)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "back_five_wing_back",
           "xp_impact": "DaSilva and van Ewijk drop into the back five and step out to trap opposing fullbacks; in possession the back three frees them to push high for early diagonal crosses"
         },
         "pivots": {
           "profile_required": "runner_tracker",
           "xp_impact": "Grimes and Torp step to passes into dropping attackers while the back three hold depth; they drop in against crosses, which leaves the edge of the box open"
         },
         "strikers": {
           "profile_required": "box_presence_target",
           "xp_impact": "Awoniyi or Simms receive direct balls to hold up, with Rudoni contesting the knockdowns"
         },
         "wingers": {
           "role": "one_v_one_winger",
           "xp_impact": "Mason-Clark or Sakamoto are fed from second balls to attack 1v1 out wide"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: hybrid 5-3-2 / 5-4-1 low-to-mid block",
           "points": [
             { "label": "Back five", "text": "Frank Lampard's Coventry set up in a 5-3-2 that drops into a 5-4-1 without the ball: centre-backs Bobby Thomas, Ethan Pinnock and Joël Amenda, with wing-backs Jay DaSilva and Milan van Ewijk." },
             { "label": "Interior denial", "text": "They pack the box and the half-spaces, limiting open shooting channels through the middle." },
             { "label": "Funnelling to the perimeter", "text": "Coventry concede the outside channels and wide delivery angles on purpose, relying on Pinnock and Thomas to win headers in the box." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Contain, don't jump", "text": "A containing mid-block rather than an aggressive high press — they defend the middle and defensive thirds and challenge once the ball goes wide." },
             { "label": "Sideline traps", "text": "When the ball reaches an opposing fullback, the wing-back steps out and the near-side central midfielder shifts across to seal the touchline, using the sideline as an extra defender." },
             { "label": "Tracking runners", "text": "Matt Grimes and Victor Torp step to passes into dropping attackers while the back three stay put to protect depth." }
           ]
         },
         {
           "heading": "In possession: target release and wing-back overlaps",
           "points": [
             { "label": "Direct to the front line", "text": "Coventry go vertical with direct passes into Taiwo Awoniyi or Ellis Simms." },
             { "label": "Wing-backs push on", "text": "With the back three covering, van Ewijk and DaSilva push high to deliver early diagonal crosses." },
             { "label": "Second balls", "text": "Dropping attackers such as Jack Rudoni contest knockdowns in the final third and feed wingers Ephron Mason-Clark or Tatsuhiro Sakamoto for 1v1s." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Back-four switch", "text": "When Coventry revert to a back four (4-2-3-1), the wide areas open up — the gap between fullback and wide midfielder allows 2v1 overloads." },
             { "label": "Cutbacks to the arc", "text": "Central midfielders drop into the line to help against crosses, leaving the space outside the box free for late runners." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Block depth", "text": "Do the wing-backs sit flat with the centre-backs in a back five, or stay in the midfield line during the opponent's build-up?" },
             { "label": "Awoniyi knockdowns", "text": "How many direct balls to Awoniyi produce a controlled second touch for Rudoni or Grimes?" },
             { "label": "Crosses conceded", "text": "Count crosses conceded from wide and check whether the centre-backs keep an aerial duel success rate above 65%." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'lampard_frank';

-- ------------------------------------------------------------ Manchester City
update public.pl_managers
   set preferred_formation = '4-3-3',
       buildup_style = 'direct_possession',
       source_file = 'The Problem with City''s Press | Man City 5-3 Sunderland Analysis (LNobbins)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "jumping_fullback",
           "xp_impact": "Gvardiol jumps into the attacking third to mark the opposing right-back when Semenyo presses, leaving a gap in City's left half-space; in possession he underlaps into the box for low crosses"
         },
         "pivots": {
           "profile_required": "no_natural_holder",
           "xp_impact": "Anderson and Enzo Fernández get pulled apart — Anderson presses forward, Enzo drops into the back line — vacating the central corridor"
         },
         "strikers": {
           "profile_required": "pressing_enabler",
           "xp_impact": "Haaland curves his press at the goalkeeper to block the near centre-back and funnel play to one flank; the target for Donnarumma's long distribution"
         },
         "wingers": {
           "role": "rotating_forward",
           "xp_impact": "Semenyo, Cherki and Ndiaye rotate across the front line for 1v1 dribbles and shooting lanes in the box"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: the jumping fullback and an overextended press",
           "points": [
             { "label": "4-3-3 into man-to-man", "text": "Enzo Maresca sets City up in a man-marking high press, each player locked onto an opponent. Erling Haaland curves his run at the goalkeeper while blocking the pass to the near centre-back." },
             { "label": "Asymmetric left-back", "text": "Joško Gvardiol jumps into the attacking third to mark the opposing right-back whenever Antoine Semenyo presses high, leaving a big gap behind him in the left half-space." },
             { "label": "Midfield disconnect", "text": "With no natural holding pivot, Elliot Anderson and Enzo Fernández get pulled apart: Anderson presses aggressively while Enzo drops into the back line, vacating the centre." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Curved-run trigger", "text": "The press starts when the opposing goalkeeper receives, with Haaland's angle of approach funnelling the ball to one flank." },
             { "label": "Cover-shadow failures", "text": "Midfielders repeatedly fail to keep opponents in their cover shadow, watching the ball instead of the runners behind them." },
             { "label": "Extreme high line", "text": "The back line steps up near halfway to compress space but doesn't pressure the passer, so timed runs beat the offside trap." }
           ]
         },
         {
           "heading": "In possession: overloads and final-third power",
           "points": [
             { "label": "More direct", "text": "City build more vertically, with Gianluigi Donnarumma going long to Haaland to bypass midfield pressing." },
             { "label": "Front-line rotations", "text": "Semenyo, Rayan Cherki and Iliman Ndiaye rotate across the front line, creating 1v1 dribbles and shooting lanes in the box." },
             { "label": "Weak-side underlap", "text": "As play condenses on the right, Gvardiol underlaps into the box to put low crosses across goal." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "The Gvardiol channel", "text": "Early passes into the space Gvardiol vacates bypass City's high line." },
             { "label": "Central corridor", "text": "When Anderson lunges forward, a first-time bounce pass to an interior runner takes City's whole midfield out." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Gvardiol's recovery runs", "text": "How long does he take to recover when he has jumped forward and a vertical pass goes into his channel?" },
             { "label": "Rest-defence numbers", "text": "Does City keep a 3+1 rest defence, or leave the two centre-backs isolated 2v2?" },
             { "label": "Central bypasses", "text": "Count how often Enzo Fernández or Anderson are bypassed by forward passes from the opponent's defensive third." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'maresca_enzo';

-- ------------------------------------------------------------ Liverpool
update public.pl_managers
   set preferred_formation = '4-2-3-1 / 4-3-3',
       source_file = 'How Iraola''s Liverpool will get better (The Athletic FC)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "strikers": {
           "profile_required": "pressing_enabler",
           "xp_impact": "Isak arcs his press at the goalkeeper, blocking the switch and forcing the ball to one centre-back — the trigger for the chain of jumps behind him"
         },
         "pivots": {
           "profile_required": "half_turn_receiver",
           "xp_impact": "Mac Allister, Morton or Gravenberch drop between defenders to receive on the half-turn; Szoboszlai steps up to cover the near-side pivot in the press"
         },
         "fullbacks": {
           "role": "jumping_fullback",
           "xp_impact": "Kerkez and Barcola jump onto opposing fullbacks to intercept clearances and hurried sideline passes"
         },
         "wingers": {
           "role": "width_holder",
           "xp_impact": "Pin the opposing fullbacks wide while the midfield staggers between the lines"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: the hybrid pressing grid",
           "points": [
             { "label": "Zonal base, man-to-man jumps", "text": "Andoni Iraola's Liverpool set up nominally in a zonal 4-2-3-1 / 4-3-3 but jump into man-to-man assignments as the ball moves." },
             { "label": "Compressing the pocket", "text": "When opposing playmakers drop deep, centre-backs such as Jérémy Jacquet step into midfield to squeeze the space between the lines." },
             { "label": "Accordion build-up", "text": "In possession the ball goes back to Alisson to draw the opponent out, opening vertical space between their forwards and midfield." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Arc-run trigger", "text": "Alexander Isak curves his run at the goalkeeper, blocking the switch and forcing the ball toward one centre-back." },
             { "label": "Chain-reaction jumps", "text": "Isak's run triggers Florian Wirtz to jump onto the other centre-back, while Dominik Szoboszlai steps up onto the near-side pivot." },
             { "label": "Fullback interceptions", "text": "Milos Kerkez and Bradley Barcola jump onto the opposing fullbacks to intercept clearances or hurried sideline passes." }
           ]
         },
         {
           "heading": "In possession: vertical staggering",
           "points": [
             { "label": "Runs from deep", "text": "Vertical runs from deep positions are the main way Liverpool break a block." },
             { "label": "Line staggering", "text": "Midfielders (Alexis Mac Allister, Tyler Morton or Ryan Gravenberch) drop between defenders to receive on the half-turn while the wingers pin the fullbacks wide." },
             { "label": "Bounce passes", "text": "One-touch wall passes in the half-spaces bypass the opponent's pressing lines." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Late second-line jumps", "text": "If the second presser (e.g. Wirtz) hesitates, the ball carrier has time to find midfield runners." },
             { "label": "Overcommitting to inside runners", "text": "When several defenders track an inverted winger, the opposing fullback is left free on the far side for a switch." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Wirtz's timing", "text": "How long between Isak's run and Wirtz closing down the other centre-back?" },
             { "label": "Van Dijk stepping out", "text": "How often does Virgil van Dijk step out of the line into midfield versus holding depth?" },
             { "label": "First-touch direction", "text": "In build-up, do the midfielders take their first touch forward into space or back toward the centre-backs?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'iraola_andoni';

-- ------------------------------------------------------------ Sunderland
update public.pl_managers
   set preferred_formation = '5-3-2 / 3-4-1-2',
       source_file = 'Man City vs Sunderland (5-3) — Brobbey Was The Key — Tactical Analysis — GW6 FPL Info 26/27 (Steven Doherty)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "strikers": {
           "profile_required": "box_presence_target",
           "xp_impact": "Brobbey is the route-one target — Roefs goes long to him, and he pins centre-backs and cushions layoffs to Le Fée or Sadiki"
         },
         "fullbacks": {
           "role": "inverting_wing_back",
           "xp_impact": "Mthali and Mukiele make diagonal runs into central midfield; when they push high, switches leave the wide centre-backs 1v1"
         },
         "pivots": {
           "profile_required": "second_ball_collector",
           "xp_impact": "Sadiki and Xhaka sit behind the opponent's press to collect knockdowns from long balls"
         },
         "wingers": {
           "role": "transition_runner",
           "xp_impact": "Angulo or Muñoz are released by Le Fée into the channels behind advancing fullbacks"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: the extreme vertical stretch",
           "points": [
             { "label": "Base 5-3-2", "text": "Régis Le Bris sets Sunderland up in a 5-3-2 out of possession that becomes a 3-4-1-2 / 3-4-3 going forward." },
             { "label": "Stretching the pitch", "text": "Centre-backs drop deep in their own third to draw the opponent's press high, stretching the central corridor and leaving Brian Brobbey 1v1 with a centre-back." },
             { "label": "Wing-backs come inside", "text": "Wing-backs Mthali and Nordi Mukiele make diagonal runs into central midfield, pulling defenders out of position." }
           ]
         },
         {
           "heading": "Baiting traps",
           "points": [
             { "label": "Deliberate deep possession", "text": "Defenders circulate slowly near their own box to bait the opponent into committing numbers forward." },
             { "label": "Second-ball positioning", "text": "Ayman Sadiki and Granit Xhaka position themselves behind the opponent's press, ready to collect knockdowns from long balls." }
           ]
         },
         {
           "heading": "In possession: the route-one target engine",
           "points": [
             { "label": "Direct to Brobbey", "text": "Goalkeeper Robin Roefs bypasses midfield with direct balls into Brobbey." },
             { "label": "Hold-up and layoffs", "text": "Brobbey pins centre-backs with his frame and cushions aerial balls down to runners such as Enzo Le Fée or Sadiki." },
             { "label": "Third-man release", "text": "Once the ball is secured centrally, Le Fée releases wingers Nilson Angulo or Chema Muñoz into the channels behind advancing fullbacks." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Space behind the wing-backs", "text": "With the wing-backs high, direct switches to opposing wingers leave the wide centre-backs 1v1." },
             { "label": "Set-piece marking", "text": "Lapses tracking runners on quick restarts leave open shooting lanes in the box." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Brobbey's duels", "text": "Track his aerial and ground duel success in the middle third during the first half." },
             { "label": "Le Fée facing forward", "text": "Count passes Le Fée receives facing forward after Brobbey's hold-up play." },
             { "label": "Wing-back recovery", "text": "How long do Mthali and Mukiele take to drop into a back five after a turnover in the opposition half?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'lebris_regis';

-- ------------------------------------------------------------ Leeds United
update public.pl_managers
   set preferred_formation = '3-4-3 / 3-1-3-3 in buildup',
       buildup_style = 'possession_control',
       source_file = 'Why Every Premier League Club Should Fear This Leeds Team. (Jacob Horsfall)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "inverted_wing_back",
           "xp_impact": "Bogle inverts from right wing-back into the #10 pocket, drawing centre-backs out; James Justin overlaps from right centre-back, which leaves the right side open on turnovers"
         },
         "pivots": {
           "profile_required": "single_pivot_screen",
           "xp_impact": "Ampadu anchors a 3-1 base with Trafford as a third centre-back, and forms a central triangle with Tanaka and Stach out of possession; balls over the triangle find the space behind him"
         },
         "strikers": {
           "profile_required": "box_presence_target",
           "xp_impact": "Calvert-Lewin occupies the centre-backs and is the diagonal outlet under pressure, with midfielders surrounding the drop zone"
         },
         "wingers": {
           "role": "blind_side_runner",
           "xp_impact": "Okafor pins the far side and makes blind-side runs to the far post for crosses"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: asymmetric 3-4-3 / 3-1-3-3 build-up",
           "points": [
             { "label": "Keeper as a third centre-back", "text": "Daniel Farke's Leeds build asymmetrically: goalkeeper James Trafford joins the two centre-backs and Ethan Ampadu to form a 3-1 base." },
             { "label": "Overlapping centre-back", "text": "Right centre-back James Justin pushes into the right wing or attacking midfield, while right wing-back Jayden Bogle inverts into the #10 pocket, dragging centre-backs out of position." },
             { "label": "Left-side isolation", "text": "With the right overloaded, Noah Okafor and Dominic Calvert-Lewin pin the defence on the far side, opening space for Anton Stach to attack the box." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Split press", "text": "Calvert-Lewin and Okafor split the centre-backs, blocking angles into the fullbacks without lunging at the ball carrier." },
             { "label": "Central jamming", "text": "Ampadu, Ao Tanaka and Stach form a compact central triangle in a mid-block, forcing play into wide traps." },
             { "label": "Touchline traps", "text": "Once the ball reaches an opposing fullback, the wing-back jumps aggressively with the near-side midfielder in support, forcing a turnover or a hurried clearance." }
           ]
         },
         {
           "heading": "In possession: counter-movements and box overloads",
           "points": [
             { "label": "Suck and release", "text": "Bogle drives inside to draw three defenders, lays off to Stach, who spreads it to Justin in wide space." },
             { "label": "Blind-side runs", "text": "Calvert-Lewin occupies the centre-backs, freeing Okafor to run blind-side to the far post for crosses." },
             { "label": "Controlled long balls", "text": "Under heavy pressure Leeds hit targeted diagonals to Calvert-Lewin and surround the drop zone with midfielders to win the second ball." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Right side on turnovers", "text": "Justin's advanced position leaves the right side of defence open; quick switches can isolate the two remaining centre-backs." },
             { "label": "Over the midfield triangle", "text": "Direct aerial balls over the central triangle exploit the space behind Ampadu." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Bogle's inversion", "text": "How much time does Bogle spend in the #10 pocket compared with touches on the right touchline?" },
             { "label": "Rest defence", "text": "Do Ampadu and Trafford form a two-man screen behind the remaining centre-backs during deep possession?" },
             { "label": "Second balls", "text": "What share of Calvert-Lewin's knockdowns do Stach or Tanaka win in the middle third?" }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'farke_daniel';

-- ------------------------------------------------------------ Fulham
update public.pl_managers
   set preferred_formation = '2-3-5 in possession / 4-2-3-1 press',
       buildup_style = 'possession_control',
       pressing_intensity = 'high',
       source_file = 'Fulham Are Better Than You Think (Bains Analysis)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "high_overlapping_crosser",
           "xp_impact": "Robinson and Castagne push into the final third together for a 2-3-5, and Castagne jumps high onto opposing wing-backs; with both high, the centre-backs are isolated across the width"
         },
         "pivots": {
           "profile_required": "deep_playmaker",
           "xp_impact": "Berge drops between the split centre-backs as the main distributor; the Berge–Iwobi pivot lacks the recovery pace to cover after high turnovers"
         },
         "wingers": {
           "role": "inverted_inside_creator",
           "xp_impact": "Iwobi drifts inside from the left to open the touchline for Robinson; on the right King underlaps into the box for cutbacks, rotating with Bobb and Castagne"
         },
         "strikers": {
           "profile_required": "central_screen",
           "xp_impact": "Jiménez screens the central lane in the 4-2-3-1 press"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: asymmetric 2-3-5 high-possession grid",
           "points": [
             { "label": "Split centre-backs", "text": "Álvaro Arbeloa's Fulham build from the back with Calvin Bassey and Joachim Andersen split wide inside the box." },
             { "label": "Both fullbacks high", "text": "Antonee Robinson and Timothy Castagne push into the opponent's third at the same time, forming a 2-3-5 / 2-2-6." },
             { "label": "Right-side rotations", "text": "Castagne, Oscar Bobb and Josh King rotate on the right, with King underlapping into the box to create cutback angles." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "High 4-2-3-1 press", "text": "Fulham press high, with Raúl Jiménez screening the central lane and King covering the holding midfielder." },
             { "label": "Fullback jumps", "text": "When the ball goes wide, Castagne jumps high onto the opposing wing-back to pin them in their corner." },
             { "label": "Carrying around the press", "text": "In build-up, rather than going long or forcing central passes, Bassey drives forward into the opposition half to beat the first line." }
           ]
         },
         {
           "heading": "In possession: box penetration and rotations",
           "points": [
             { "label": "Box presence", "text": "Near the top of the league for touches in the opposition box, generating high open-play xG." },
             { "label": "Inverted wing play", "text": "Alex Iwobi drifts inside from the left into the central attacking channel, opening the touchline for Robinson to overlap." },
             { "label": "Short circulation", "text": "Sander Berge drops between the wide centre-backs as the main distributor, keeping the ball moving quickly." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Isolated centre-backs", "text": "With both fullbacks high, Andersen and Bassey are left covering about 60 metres of width; transitions into the channel behind Castagne exploit it." },
             { "label": "Midfield ground coverage", "text": "The Berge–Iwobi pivot lacks the recovery pace to cover big spaces after turnovers high up the pitch." }
           ]
         },
         {
           "heading": "Matchday checklist",
           "points": [
             { "label": "Fullback rest defence", "text": "Does one fullback stay back for a 3+2 rest defence, or do both go beyond the midfield line?" },
             { "label": "Bassey's carries", "text": "Track the success rate of Bassey's dribbles out of the defensive third under high pressure." },
             { "label": "Box-entry types", "text": "Split Fulham's box entries into low cutbacks, wide overloads and aerial crosses." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'arbeloa_alvaro';

-- ------------------------------------------------------------ Brentford
update public.pl_managers
   set preferred_formation = '4-3-3 / diamond in buildup',
       source_file = 'How Keith Andrews'' Brentford OUTSMARTED De Zerbi (Bains Analysis)',
       modifiers = '{}'::jsonb,
       tactical_traits = $json${
         "fullbacks": {
           "role": "inverted_pivot",
           "xp_impact": "Lewis-Potter moves from left-back into central midfield for overloads; the left touchline is open if the ball is lost quickly"
         },
         "pivots": {
           "profile_required": "man_marking_pivot",
           "xp_impact": "Janelt and Sari alternate dropping beside the centre-backs for a 3v2 in build-up and track opposing midfielders man-to-man; Sari carries second balls forward"
         },
         "strikers": {
           "profile_required": "box_presence_target",
           "xp_impact": "Kelleher goes long to Thiago and Schade; Thiago and Jensen press the centre-backs while cover-shadowing the opposing pivot"
         },
         "wingers": {
           "role": "aerial_flick_on",
           "xp_impact": "Schade contests aerial duels against fullbacks and stepping centre-backs, flicking into space for runners; Schade and Turt tight-mark opposing fullbacks"
         }
       }$json$::jsonb,
       analysis = $json$[
         {
           "heading": "Structure: hybrid 4-3-3 / midfield diamond",
           "points": [
             { "label": "Base shape", "text": "Keith Andrews' Brentford play a flexible 4-3-3 that becomes a diamond through the middle in build-up." },
             { "label": "Inverted left-back", "text": "Keane Lewis-Potter moves from left-back into central midfield pockets to create central overloads." },
             { "label": "Rotating pivots", "text": "Vitaly Janelt and Yunus Sari take turns dropping beside the centre-backs for a 3v2 in build-up." }
           ]
         },
         {
           "heading": "Pressing and triggers",
           "points": [
             { "label": "Screening the build-up", "text": "Igor Thiago and Mathias Jensen press the centre-backs while using their cover shadows to block passes into the double pivot." },
             { "label": "Man-to-man midfield", "text": "Janelt and Sari track the opposing central midfielders, cutting off short options and forcing the goalkeeper long." },
             { "label": "Flank containment", "text": "Wide attackers Kevin Schade and Daniel Turt tight-mark the opposing fullbacks to stop wide progression." }
           ]
         },
         {
           "heading": "In possession: aerial duels and direct transition",
           "points": [
             { "label": "Target directness", "text": "Goalkeeper Caoimhín Kelleher plays direct aerial balls to Schade and Thiago, bypassing the opponent's midfield press." },
             { "label": "Knockdown duels", "text": "Schade contests aerial duels with fullbacks or stepping centre-backs, flicking the ball into space for running midfielders." },
             { "label": "Ball carrying", "text": "Sari collects second balls and drives through midfield, linking with Lewis-Potter on the edge of the box." }
           ]
         },
         {
           "heading": "Vulnerabilities",
           "points": [
             { "label": "Behind Lewis-Potter", "text": "When Lewis-Potter moves inside, the left touchline is open if possession is lost quickly." },
             { "label": "Physical load", "text": "Man-to-man tracking over long distances tires the midfield late in games, opening gaps in front of the back line." }
           ]
         }
       ]$json$::jsonb
 where manager_key = 'andrews_keith';
