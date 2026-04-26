-- Rensa äldre ÅDT-mätningar per element_id.
--
-- Bakgrund: nvdb_trafik innehåller alla år som låg i Lastkajen-uttaget,
-- separata rader per fid + matarsperiod. nvdb_trafik_latest-vyn
-- (definerad i 0014) använder rank() och behåller bara senaste
-- matarsperioden per element_id, så frontenden visar redan bara senaste
-- året. De äldre raderna är död vikt.
--
-- Ungefärlig effekt: ~3900 rader bort (av 66640 totala) ≈ 6% mindre
-- tabell. Marginell vinst men en ren städning.
--
-- Säkerhetsnoter:
-- - Vi rensar inte fids där matarsperiod är NULL — säkerhetsmarginal
--   för rader med okänt mätår.
-- - Operationen är idempotent: efter körning är max(matarsperiod) per
--   element_id den enda kvar, så att köra om gör inget.

with ranked as (
  select ctid,
    rank() over (
      partition by coalesce(element_id::text, 'fid:' || fid::text)
      order by matarsperiod desc nulls last
    ) as r
  from nvdb_trafik
  where matarsperiod is not null
)
delete from nvdb_trafik
using ranked
where nvdb_trafik.ctid = ranked.ctid
  and ranked.r > 1;

-- Återanalysera så planern har färska statistics.
analyze nvdb_trafik;
