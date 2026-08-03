// ------------------------------------------------------------------
// Supabase project connection
// ------------------------------------------------------------------
const SUPABASE_URL = "https://nxmcfgycegyfrrohvuyf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bWNmZ3ljZWd5ZnJyb2h2dXlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNjQ1NzYsImV4cCI6MjA5ODg0MDU3Nn0.-RENjkRpOZSgQD8kMFNm6qopGfqb4JRFyBBK64g0BQc";

// supabase-js UMD build is loaded from the CDN in each HTML page
// and exposes a global `supabase` factory — we immediately shadow
// that name with the created client, matching the usual pattern.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});