-- Sprint 12.5 — PL Team (Club) Manager Intelligence, buildable slice.
--
-- Ships the owner's tactical-profile data (docs/pl-manager-profiles.json) as
-- disclosed, non-multiplicative context — a "System" panel, not a term inside
-- xP. See docs/roadmap.md, "Sprint 12.5", for the full reasoning: the
-- modifiers are transcribed tactical opinion from video/article titles, not
-- measured data, and the plan's player-role matching has no data source here,
-- so the numeric mu_fit multiplier and cold-start integration stay blocked on
-- validation. Only the profiles + informational panel slice is built.
--
-- Naming: "manager" already means the FPL fantasy manager throughout this
-- codebase (managers, manager_season_history, lib/manager-profile.ts, Sprint
-- 12A). This is a real-world PL head coach, so it gets different names
-- throughout: pl_managers (not manager_profiles), teams.tactical_manager_id
-- (not clubs.manager_id — there is no clubs table, it's teams).

create table public.pl_managers (
  season               text    not null,
  manager_key          text    not null,
  name                 text    not null,
  current_club         text    not null,
  preferred_formation  text,
  buildup_style        text,
  pressing_intensity   text,
  source_file          text,
  -- Stored verbatim as given — provenance for a human reader, not an input to
  -- arithmetic. See TACTICAL_PROFILE_NOTE in lib/tactical-profile.ts.
  tactical_traits      jsonb   not null,
  modifiers            jsonb   not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (season, manager_key)
);

create trigger pl_managers_set_updated_at before update on public.pl_managers
  for each row execute function public.set_updated_at();

alter table public.pl_managers enable row level security;
create policy "Public read" on public.pl_managers for select to anon, authenticated using (true);

alter table public.teams add column tactical_manager_id text;
alter table public.teams
  add constraint teams_tactical_manager_fkey
  foreign key (season, tactical_manager_id)
  references public.pl_managers (season, manager_key);

-- ---------------------------------------------------------------- seed
--
-- One-off reference data with no sync cadence — the owner's JSON has no API
-- source, so this is a migration seed rather than an Edge Function, on the
-- same footing as any other static reference table. Season is resolved from
-- `gameweeks` rather than hardcoded, so this migration links correctly
-- whichever season it happens to run against.
do $$
declare
  v_season text;
  v_linked int;
begin
  select season into v_season
    from public.gameweeks
   order by deadline_time desc
   limit 1;

  if v_season is null then
    raise exception 'pl_managers seed: no season found in gameweeks — run sync-bootstrap first';
  end if;

  insert into public.pl_managers
    (manager_key, name, current_club, preferred_formation, buildup_style, pressing_intensity,
     source_file, tactical_traits, modifiers, season)
  select v.manager_key, v.name, v.current_club, v.preferred_formation, v.buildup_style,
         v.pressing_intensity, v.source_file, v.tactical_traits, v.modifiers, v_season
    from (values
      ('arteta_mikel', 'Mikel Arteta', 'Arsenal', '4-3-3 / 3-2-4-1 in buildup', 'possession_control', 'high', 'The Complete Tactical Evolution Of Mikel Arteta', '{"wingers":{"role":"inverted_inside_scorer","xp_impact":"+10% npxG for wingers isolating 1v1 in wide/half-spaces"},"fullbacks":{"role":"inverted_pivot","xp_impact":"Reduced crossing xA; increased clean sheet & baseline minutes security"},"pivots":{"profile_required":"press_resistant_small_space","rotation_risk_factors":"Low rotation risk for press-resistant line breakers"},"strikers":{"profile_required":"pressing_enabler","xp_impact":"High pressure/defensive contribution; creates zone 14 pockets for #10"}}'::jsonb, '{"low_block_fdr_modifier":1.05,"high_press_fdr_modifier":1.15,"set_piece_bias":1.2}'::jsonb),
      ('emery_unai', 'Unai Emery', 'Aston Villa', '4-4-2 / 4-2-2-2', 'bait_press', 'medium', 'A Tactical Guide to Unai Emery''s Aston Villa', '{"wingers":{"role":"transition_runner","xp_impact":"+15% xP in high-offside trap / vertical transition games"},"fullbacks":{"role":"flexible_back_three","xp_impact":"Asymmetric fullback: one tucks into back 3, one bombs high for xA"},"pivots":{"profile_required":"deep_playmaker","rotation_risk_factors":"Low rotation for double pivot with high positional discipline"},"strikers":{"profile_required":"transitional_runner","xp_impact":"High penalty box xG on direct vertical through-balls"}}'::jsonb, '{"low_block_fdr_modifier":0.95,"high_press_fdr_modifier":1.2,"set_piece_bias":1.1}'::jsonb),
      ('rose_marco', 'Marco Rose', 'Bournemouth', '4-2-2-2 / 4-2-3-1', 'high_regain_pressing', 'high', 'Marco Rose''s FM26 Blueprint | Full Tactical Breakdown', '{"wingers":{"role":"transition_runner","xp_impact":"+10% xG on high turnovers in opposition half"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+15% xA on direct wide transitions and overlapping deliveries"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"Aggressive man-marking eights face booking risk"},"strikers":{"profile_required":"transitional_runner","xp_impact":"+15% xP for dual-striker partnerships exploiting second balls"}}'::jsonb, '{"low_block_fdr_modifier":0.95,"high_press_fdr_modifier":1.15,"set_piece_bias":1.1}'::jsonb),
      ('andrews_keith', 'Keith Andrews', 'Brentford', '3-5-2 / 4-3-3 hybrid', 'direct_possession', 'high', 'How a Set-Piece Coach Is DESTROYING The Premier League', '{"wingers":{"role":"wide_crosser","xp_impact":"+15% xA from curved runs in behind & second-ball flick-ons"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+20% xA from long throws & early wide deliveries"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"Midfielders required to cover second-ball horseshoe zones"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+20% header xG & physical duel winning percentage"}}'::jsonb, '{"low_block_fdr_modifier":1.1,"high_press_fdr_modifier":1.05,"set_piece_bias":1.35}'::jsonb),
      ('hurzeler_fabian', 'Fabian Hürzeler', 'Brighton & Hove Albion', '4-2-3-1 / 3-4-2-1', 'bait_press', 'high', 'How Fabian Hürzeler''s Brighton Tactics Are Fighting For EUROPE & Nobody Noticed...', '{"wingers":{"role":"transition_runner","xp_impact":"+10% xG on high turnovers in opposition half"},"fullbacks":{"role":"inverted_pivot","xp_impact":"+10% tackles & recovery points; moderate crossing volume"},"pivots":{"profile_required":"press_resistant_small_space","rotation_risk_factors":"High card risk due to tactical fouls in high rest-defense"},"strikers":{"profile_required":"pressing_enabler","xp_impact":"High pressing output leading to high team turnover xG"}}'::jsonb, '{"low_block_fdr_modifier":0.9,"high_press_fdr_modifier":1.15,"set_piece_bias":1.05}'::jsonb),
      ('alonso_xabi', 'Xabi Alonso', 'Chelsea', '4-2-3-1 / 3-4-3', 'high_regain_pressing', 'high', 'Is Xabi Alonso the answer to Chelsea''s problems? | Sensible Transfers', '{"wingers":{"role":"transition_runner","xp_impact":"+10% xG from depth runs attacking space behind high lines"},"fullbacks":{"role":"flexible_back_three","xp_impact":"High clean sheet probability due to final-third regains"},"pivots":{"profile_required":"deep_playmaker","rotation_risk_factors":"Low rotation risk for central double-pivot with high pass volume"},"strikers":{"profile_required":"pressing_enabler","xp_impact":"+5% bonus point probability via defensive workrate & pressing traps"}}'::jsonb, '{"low_block_fdr_modifier":1.05,"high_press_fdr_modifier":1.1,"set_piece_bias":1.05}'::jsonb),
      ('lampard_frank', 'Frank Lampard', 'Coventry City', '4-2-3-1 / 4-3-3', 'direct_possession', 'medium', 'How Frank Lampard''s Ingenious Tactics Got Coventry City Back To The Premier League', '{"wingers":{"role":"transition_runner","xp_impact":"+15% xA on rapid switches to dynamic wide runners (e.g., Sakamoto)"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+15% xA for attacking full-backs (e.g., Van Ewijk) overlapping"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"High physical demand; booking risk for central ball-winners"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+10% goal xP for physical strikers running channels (e.g., Simms/Wright)"}}'::jsonb, '{"low_block_fdr_modifier":0.95,"high_press_fdr_modifier":1.15,"set_piece_bias":1.1}'::jsonb),
      ('sage_pierre', 'Pierre Sage', 'Crystal Palace', '3-4-3 / 5-4-1 low-block', 'high_regain_pressing', 'high', 'How Pierre Sage''s RC Lens Tactics Are DOMINATING France.', '{"wingers":{"role":"inverted_inside_scorer","xp_impact":"+15% npxG for dual inverted wingers playing narrow/centrally"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+15% xA for wide wing-backs crossing into opposite wing-back box runs"},"pivots":{"profile_required":"press_resistant_small_space","rotation_risk_factors":"Central overload reduces transition conceded goals"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+10% goal xP on continuous wide delivery into box"}}'::jsonb, '{"low_block_fdr_modifier":0.95,"high_press_fdr_modifier":1.15,"set_piece_bias":1.1}'::jsonb),
      ('moyes_david', 'David Moyes', 'Everton', '4-4-1-1 / 4-4-2 mid-block', 'direct_possession', 'medium', 'How David Moyes Built the Premier League''s Most Intelligent Machine: Everton', '{"wingers":{"role":"wide_crosser","xp_impact":"+15% xA for wide midfielders delivering early diagonal crosses"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+15% xA for overlapping full-backs exploiting wide overloads"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"Deep double-pivot provides high clean-sheet security"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+25% set-piece & aerial target xG for physical target men"}}'::jsonb, '{"low_block_fdr_modifier":1,"high_press_fdr_modifier":1.05,"set_piece_bias":1.3}'::jsonb),
      ('arbeloa_alvaro', 'Álvaro Arbeloa', 'Fulham', '4-4-2 / 5-3-2 low-block', 'bait_press', 'low', 'Álvaro Arbeloa''s Tactics at Real Madrid Destroyed Man City | Valverde Hat-Trick | Tactical Analysis', '{"wingers":{"role":"wide_crosser","xp_impact":"+10% xA on long-throw flicks & far-post overload crosses"},"fullbacks":{"role":"flexible_back_three","xp_impact":"High clean-sheet xP due to rigid low-block spatial control"},"pivots":{"profile_required":"deep_playmaker","rotation_risk_factors":"Single central anchor covers massive space; low rotation risk"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+15% set-piece & long-throw header goal threat"}}'::jsonb, '{"low_block_fdr_modifier":0.85,"high_press_fdr_modifier":1.2,"set_piece_bias":1.3}'::jsonb),
      ('jakirovic_sergej', 'Sergej Jakirović', 'Hull City', '4-3-3 / 3-5-2 flexible', 'direct_possession', 'high', 'Hull City Broke English Football.', '{"wingers":{"role":"wide_crosser","xp_impact":"+15% xA for attacking wing-backs in high-turnover fast-paced games"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+15% xA for wide wing-backs; high defensive conceded risk"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"High yellow card risk due to back-and-forth end-to-end chaos"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+35% total team goal dependency on focal target striker (McBurnie type)"}}'::jsonb, '{"low_block_fdr_modifier":0.85,"high_press_fdr_modifier":1.15,"set_piece_bias":1.25}'::jsonb),
      ('oneil_gary', 'Gary O''Neil', 'Ipswich Town', '4-2-3-1 / 3-4-2-1 flexible', 'high_regain_pressing', 'high', 'How Ipswich Setup Under Gary O''Neil 🚜', '{"wingers":{"role":"transition_runner","xp_impact":"+10% xP on rapid turnover counterattacks"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+10% xA from wide wing-back width"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"High aggressive ball-winning demand in double pivot"},"strikers":{"profile_required":"box_presence_target","xp_impact":"Striker acts as central reference point for long balls & hold-up"}}'::jsonb, '{"low_block_fdr_modifier":0.9,"high_press_fdr_modifier":1.1,"set_piece_bias":1.1}'::jsonb),
      ('farke_daniel', 'Daniel Farke', 'Leeds United', '3-5-2 / 4-3-3', 'direct_possession', 'medium', 'How Daniel Farke''s NEW Tactics SAVED Leeds United', '{"wingers":{"role":"transition_runner","xp_impact":"+10% xA from wide overloads and physical box crashes"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+15% xA for aggressive full-backs (e.g., Bogle/Gudmundsson)"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"Physical dominance required; strong set-piece target value"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+20% penalty box touches & goal xP for target forwards (e.g., Calvert-Lewin)"}}'::jsonb, '{"low_block_fdr_modifier":0.95,"high_press_fdr_modifier":1.1,"set_piece_bias":1.25}'::jsonb),
      ('iraola_andoni', 'Andoni Iraola', 'Liverpool', '4-2-3-1 heavy metal press', 'high_regain_pressing', 'high', 'What To Expect From Iraola At Liverpool | The Overlap Breakdown', '{"wingers":{"role":"transition_runner","xp_impact":"+20% npxG on high turnover transitions in chaos conditions"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+15% xA from aggressive high-line pressing traps"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"Extreme stamina & pressing demand; high card risk"},"strikers":{"profile_required":"transitional_runner","xp_impact":"+15% goal probability on high turnovers inside opponent box"}}'::jsonb, '{"low_block_fdr_modifier":0.9,"high_press_fdr_modifier":1.25,"set_piece_bias":1.1}'::jsonb),
      ('maresca_enzo', 'Enzo Maresca', 'Manchester City', '3-2-4-1 / 4-3-3 positional', 'possession_control', 'high', 'How Man City Setup Under Enzo Maresca.', '{"wingers":{"role":"inverted_inside_scorer","xp_impact":"+15% xA/xG from 1v1 wide isolations feeding central runners"},"fullbacks":{"role":"inverted_pivot","xp_impact":"Inverted full-back acts as secondary midfielder; low crossing xA"},"pivots":{"profile_required":"press_resistant_small_space","rotation_risk_factors":"High positional discipline required; GK used as +1 spare man"},"strikers":{"profile_required":"box_presence_target","xp_impact":"Elite gravity striker (Haaland) frees secondary box crashers"}}'::jsonb, '{"low_block_fdr_modifier":1.15,"high_press_fdr_modifier":1.1,"set_piece_bias":1.05}'::jsonb),
      ('carrick_michael', 'Michael Carrick', 'Manchester United', '4-2-3-1', 'fluid_freedom', 'medium', 'How Manchester United can build on Carrick''s success | Sensible Transfers', '{"wingers":{"role":"wide_crosser","xp_impact":"+10% xA for wide creators"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+10% attacking contribution & crossing volume"},"pivots":{"profile_required":"deep_playmaker","rotation_risk_factors":"PL-proven midfielders receive high baseline minutes security"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+15% set-piece xG header probability"}}'::jsonb, '{"low_block_fdr_modifier":1,"high_press_fdr_modifier":1,"set_piece_bias":1.25}'::jsonb),
      ('jaissle_matthias', 'Matthias Jaissle', 'Newcastle United', '4-3-1-2 diamond / 4-3-3', 'high_regain_pressing', 'high', 'How Newcastle Setup Under Matthias Jaissle.', '{"wingers":{"role":"transition_runner","xp_impact":"+10% xG on wide pressing traps & funnelled turnovers"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+15% xA from full-backs providing sole width in diamond shape"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"High channel-running demand for central eights"},"strikers":{"profile_required":"transitional_runner","xp_impact":"Split strikers create space for attacking #10 late runs"}}'::jsonb, '{"low_block_fdr_modifier":0.95,"high_press_fdr_modifier":1.15,"set_piece_bias":1.05}'::jsonb),
      ('glasner_oliver', 'Oliver Glasner', 'Nottingham Forest', '3-4-2-1 / 5-2-3', 'high_regain_pressing', 'high', 'Oliver Glasner tactics deep dive | How they really work | Winners and losers | What the data says', '{"wingers":{"role":"inverted_inside_scorer","xp_impact":"+15% npxG for dual #10s operating in central half-spaces"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+20% xA & goal threat for aggressive wing-backs (e.g., Munoz)"},"pivots":{"profile_required":"box_to_box_carrier","rotation_risk_factors":"High card & foul risk for central ball-winners in 2-man midfield"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+15% goal probability via aerial flick-ons and hold-up play"}}'::jsonb, '{"low_block_fdr_modifier":0.95,"high_press_fdr_modifier":1.2,"set_piece_bias":1.15}'::jsonb),
      ('lebris_regis', 'Régis Le Bris', 'Sunderland', '4-2-3-1 / 4-4-2 low-block', 'bait_press', 'medium', 'Tactical Blueprint: How Régis Le Bris Turned Sunderland Into GIANT KILLERS', '{"wingers":{"role":"transition_runner","xp_impact":"+15% xA on long-throw flicks & far-post overload crosses"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"High clean-sheet xP due to rigid 442 low-block spatial control"},"pivots":{"profile_required":"deep_playmaker","rotation_risk_factors":"Single central anchor (e.g., Xhaka) covers massive space"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+20% set-piece & long-throw header goal threat"}}'::jsonb, '{"low_block_fdr_modifier":0.85,"high_press_fdr_modifier":1.25,"set_piece_bias":1.35}'::jsonb),
      ('de_zerbi_roberto', 'Roberto De Zerbi', 'Tottenham Hotspur', '4-2-3-1 / 2-4-4', 'bait_press', 'high', 'How Roberto De Zerbi is fixing Spurs | Sensible Transfers', '{"wingers":{"role":"inverted_inside_scorer","xp_impact":"+15% npxG for wingers cutting inside behind high lines"},"fullbacks":{"role":"high_overlapping_crosser","xp_impact":"+10% xA against low-block opponents"},"pivots":{"profile_required":"press_resistant_small_space","rotation_risk_factors":"Large-space carriers face sub/role risk in tight buildup"},"strikers":{"profile_required":"box_presence_target","xp_impact":"+10% goal probability vs deep blocks"}}'::jsonb, '{"low_block_fdr_modifier":0.9,"high_press_fdr_modifier":1.15,"set_piece_bias":1}'::jsonb)
    ) as v(manager_key, name, current_club, preferred_formation, buildup_style, pressing_intensity,
           source_file, tactical_traits, modifiers)
  on conflict (season, manager_key) do update set
    name = excluded.name,
    current_club = excluded.current_club,
    preferred_formation = excluded.preferred_formation,
    buildup_style = excluded.buildup_style,
    pressing_intensity = excluded.pressing_intensity,
    source_file = excluded.source_file,
    tactical_traits = excluded.tactical_traits,
    modifiers = excluded.modifiers;

  -- Explicit alias map for the 7 of 20 clubs whose name in the JSON does not
  -- match `teams.name` — a naive equality join would silently drop a third of
  -- the league. Verified against the live teams table on 2026-08-07.
  update public.teams t
     set tactical_manager_id = pm.manager_key
    from public.pl_managers pm
   where pm.season = v_season
     and t.season = v_season
     and t.name = case pm.current_club
                    when 'Brighton & Hove Albion' then 'Brighton'
                    when 'Leeds United'           then 'Leeds'
                    when 'Manchester City'        then 'Man City'
                    when 'Manchester United'      then 'Man Utd'
                    when 'Newcastle United'       then 'Newcastle'
                    when 'Nottingham Forest'      then 'Nott''m Forest'
                    when 'Tottenham Hotspur'      then 'Spurs'
                    else pm.current_club
                  end;

  select count(*) into v_linked
    from public.teams
   where season = v_season
     and tactical_manager_id is not null;

  -- Fails loudly rather than warns: a seed that quietly links 13 of 20 clubs
  -- is worse than one that does not run at all.
  if v_linked <> 20 then
    raise exception 'pl_managers seed: expected 20 clubs linked, got %', v_linked;
  end if;
end $$;
