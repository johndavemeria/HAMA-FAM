# Hama — setup guide

Plain HTML/CSS/JS site backed by your Supabase project. Discord is the
sign-in method. **Anyone can sign in** — the first time someone signs in
with Discord they get a normal member profile automatically. Only
founders/admins can promote people, place them in the family tree, or
edit anyone else's profile.

Files:
- `index.html`, `explore.html`, `family-tree.html`, `profile.html`, `admin.html` — pages
- `css/style.css` — all styling
- `js/supabase-client.js` — connects to your Supabase project
- `js/auth.js` — Discord sign-in logic, shared by every page
- `js/pages/*.js` — logic for each page
- `schema.sql` — run this once, on a **brand-new** Supabase project
- `migration_2.sql` — run this once instead, if you already ran the old
  `schema.sql` and have real members in your database

## 1. Database setup

**New project, nothing set up yet:** run `schema.sql` in Supabase → SQL
Editor → New query → Run. This creates the `profiles` and
`family_relations` tables, row-level security, and the
`handle_discord_login` function.

**Already have a project running the old version of this site:** run
`migration_2.sql` instead. It only adds/replaces things — it will not
touch your existing members or family tree.

## 2. Create a Discord application (for OAuth)

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Under **OAuth2 → General**, copy the **Client ID** and **Client Secret**.
3. Under **OAuth2 → Redirects**, add the redirect URL Supabase gives you in
   the next step (it looks like `https://nxmcfgycegyfrrohvuyf.supabase.co/auth/v1/callback`).

**Keep the Client Secret out of any file you share, upload, or commit.**
It only ever needs to be pasted into Supabase's Discord provider screen
(step 3 below) — never into a text file, a repo, or anywhere else.

## 3. Turn on the Discord provider in Supabase

1. In Supabase → **Authentication → Providers → Discord**, toggle it on.
2. Paste in the Client ID and Client Secret from step 2, then save.
3. In **Authentication → URL Configuration**, add the URL(s) you'll host this
   site on (e.g. `http://localhost:5500`, or your real domain) to
   **Redirect URLs**.

## 4. Make yourself the first founder

Sign in once on the site with your own Discord account — this creates
your profile automatically as an ordinary member. Then, in Supabase SQL
Editor, run:

```sql
update public.profiles set role = 'founder', badge = 'Founder',
  generation = 1, is_root = true
where discord_username = 'your-discord-username';
```

(`discord_username` must be your exact Discord username, lowercase — the
one after the `@`, not your display name.) From here on, you can promote
anyone else straight from the **Admin** page instead of writing SQL.

## 5. Run the site

This is a static site — no build step. Easiest options:
- Open the folder in VS Code and use the "Live Server" extension, or
- Run `python3 -m http.server 5500` from inside the folder and visit
  `http://localhost:5500`, or
- Upload the folder as-is to any static host (Netlify, Vercel, GitHub Pages,
  Cloudflare Pages, etc.) and add that final URL to Supabase's Redirect URLs.

## How the pieces fit together

- **Home** (`index.html`) — hero with the Hama crest + live member/founder counts.
- **Explore** (`explore.html`) — searchable grid of every profile.
- **Family Tree** (`family-tree.html`) — grid of 1st-generation roots; click
  a card to see their spouse + children. If you're that root (or a
  founder/admin), you get an "Add child / Add spouse" form right in the
  modal — pick an existing member or type in a brand-new one.
- **Profile** (`profile.html?id=...`) — shows the member's live Discord
  avatar + banner (pulled straight from Discord's API right after they
  sign in — animated banners render as GIFs automatically), bio, official
  links, and any custom sections. Owners can edit their own bio/links/
  sections inline.
- **Admin** (`admin.html`, founders/admins only) — a table of every member
  where you can change role, badge, generation, and whether someone is a
  1st-generation root, or remove a profile entirely. This is also how you
  hand out founder/admin access to other people, instead of writing SQL.

## Who can do what

| Action | Anyone signed in | Founder / Admin |
|---|---|---|
| Sign in with Discord | ✅ (auto-creates a member profile) | — |
| Edit their own bio / links / sections | ✅ | ✅ |
| Change their own role, badge, generation, or root status | ❌ (blocked by a database trigger, not just hidden in the UI) | — |
| Promote/demote anyone's role, badge, generation, root status | ❌ | ✅ (via Admin page) |
| Add a child/spouse from a 1st-gen root card | Only if they *are* that root | ✅, on any root |
| Remove a member entirely | ❌ | ✅ |

New members start at generation 2 and aren't shown in the Family Tree
until a founder/admin either marks them `is_root` at generation 1, or
adds them as a spouse/child under an existing root.

## Notes & things you may want to extend

- Discord banners only show for accounts that actually have one set
  (Discord Nitro / boosted servers) — that's Discord's own behavior, not
  a bug, and animated banners come through as `.gif` automatically.
- The links/sections editors use raw JSON for simplicity — swap in a
  proper form UI later if you want something more polished.
- If a founder demotes their own account on the Admin page, the site
  warns them first since it would lock them out of that page immediately
  (another founder, or a quick SQL update, can always undo it).