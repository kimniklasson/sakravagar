-- Fixa Supabase Security Advisor-varningar för publika vyer skapade efter
-- 0003_security_invoker.sql.
--
-- Vyer i public-schemat kör annars som SECURITY DEFINER som default när de
-- skapats av en privilegierad roll. SECURITY INVOKER gör att vyerna använder
-- anroparens rättigheter och respekterar RLS på underliggande tabeller.
--
-- Underliggande datakällor här är avsiktligt publika och har SELECT-policies
-- där de exponeras direkt via API.

alter view large_roads_public    set (security_invoker = true);
alter view nvdb_trafik_latest   set (security_invoker = true);
alter view traffic_flow_public  set (security_invoker = true);
alter view disturbances_public  set (security_invoker = true);
