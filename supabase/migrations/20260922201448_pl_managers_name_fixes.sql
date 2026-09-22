-- Player-name corrections from source transcripts, confirmed by the owner:
--   Newcastle:   "Sean Neave-Stir" -> Sean Steur
--   Aston Villa: "Nathan Manzambi" -> Johan Manzambi
-- (Jan Paul van Hecke at Tottenham is correct and unchanged.)

update public.pl_managers
   set analysis = replace(analysis::text, 'Neave-Stir', 'Steur')::jsonb,
       tactical_traits = replace(tactical_traits::text, 'Neave-Stir', 'Steur')::jsonb
 where manager_key = 'jaissle_matthias';

update public.pl_managers
   set analysis = replace(analysis::text, 'Nathan Manzambi', 'Johan Manzambi')::jsonb
 where manager_key = 'emery_unai';
