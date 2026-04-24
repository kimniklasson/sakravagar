// Intentionellt tom för MVP — all Supabase-access går via /api/events på servern.
// När/om vi vill queryra direkt från klient-komponenter: skapa en anon-client här
// med NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
export {};
