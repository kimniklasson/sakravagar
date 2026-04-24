-- Fixa Supabase Security Advisor "Security Definer View"-varningarna.
--
-- Vyer skapade av superuser körs default som SECURITY DEFINER — med skaparens
-- rättigheter, vilket bypassar RLS på base-tabeller. Supabase flaggar detta
-- som kritiskt eftersom det är lätt att oavsiktligt exponera data.
--
-- Fix: sätt alla vyer till SECURITY INVOKER (kör med anropandes rättigheter).
-- Förutsättning: base-tabellerna har publika SELECT-policies så anon kan läsa
-- genom vyn. ÅDT/TSK är CC0-data — ingen sekretess, publik läsning OK.

alter view events_public set (security_invoker = true);
alter view adt_public    set (security_invoker = true);
alter view tsk_public    set (security_invoker = true);
alter view tsk_rank      set (security_invoker = true);

-- Publika SELECT-policies på NVDB-tabellerna (events har redan en från 0001).
drop policy if exists "nvdb_trafik publicly readable" on nvdb_trafik;
create policy "nvdb_trafik publicly readable"
  on nvdb_trafik for select
  using (true);

drop policy if exists "nvdb_tsk publicly readable" on nvdb_tsk;
create policy "nvdb_tsk publicly readable"
  on nvdb_tsk for select
  using (true);
