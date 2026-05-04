-- Utöka kartlagret "Höga hastigheter" från 90+ till 80+.
--
-- För befintliga miljöer krävs också att `scripts/import-large-roads.sh`
-- körs om så `nvdb_large_roads_speed` faktiskt innehåller 80-rader.

create or replace view large_roads_public as
select
  fid,
  element_id,
  'high_speed'::text as class,
  1::int as rank,
  speed_limit,
  null::text as road_type,
  length_m,
  geom
from nvdb_large_roads_speed
where speed_limit >= 80

union all

select
  fid,
  element_id,
  case
    when road_type = 'Motorväg' then 'motorway'
    when road_type in ('Motortrafikled', 'Motortrafikled mötesfri') then 'motor_traffic_road'
    else 'major_road'
  end as class,
  case
    when road_type = 'Motorväg' then 4
    when road_type in ('Motortrafikled', 'Motortrafikled mötesfri') then 3
    else 2
  end as rank,
  null::int as speed_limit,
  road_type,
  length_m,
  geom
from nvdb_large_roads_type
where road_type in ('Motorväg', 'Motortrafikled', 'Motortrafikled mötesfri', '4-fältsväg', 'Vanlig väg mötesfri');

alter view large_roads_public set (security_invoker = true);
