-- Explicita SELECT-grants på base-tabellerna bakom de publika vyerna.
--
-- Bakgrund: efter 0003 kör vyerna med security_invoker = true, vilket
-- innebär att PostgreSQL kontrollerar anropande rolls rättigheter mot
-- base-tabellerna (utöver RLS). I dagens Supabase-projekt fungerar detta
-- via default privileges på public-schemat, men det är defense-in-depth
-- att vara explicit — om defaults skulle ändras eller databasen migreras
-- pajar annars vyerna tyst för anon/authenticated.
--
-- RLS-policyerna (publik SELECT) sattes redan i 0001 och 0003 och styr
-- fortfarande vad som faktiskt kan läsas — dessa grants öppnar bara dörren.

grant select on events       to anon, authenticated;
grant select on nvdb_trafik  to anon, authenticated;
grant select on nvdb_tsk     to anon, authenticated;
