# Pull

A network for Berklee's music people. Your rank comes from who chooses to work with you, not followers.

- 5 asks a week, 3 accepts. Limits live in the database (Monday 00:00 Boston reset).
- A collab counts only when both people confirm it. Each confirmed collab gives both people 10 Pull + 10% of the other person's all-time Pull.
- Accepts and collabs are public. Passes are private: the sender just keeps seeing "Waiting".
- No follower counts, no anonymous posts, no comments on people.

## Stack

Plain HTML/CSS/JS (`index.html`, `styles.css`, `app.js`) on GitHub Pages. Supabase for auth, Postgres and storage via `supabase-js` from a CDN. Keys live in `config.js` (the anon key is public by design; Row Level Security protects every table).

## Setup (once, ~3 minutes)

1. **Database**: Supabase Dashboard → **SQL Editor** → **New query** → paste the whole of `supabase/schema.sql` → **Run**. It creates every table with RLS on, the Berklee-only trigger on `auth.users`, the weekly-limit functions, the Board/Feed views and the two storage buckets.
2. **Auth**: Dashboard → **Authentication** → **Sign In / Providers** → **Email** → turn **Confirm email OFF** → Save.
   Why: Supabase's built-in email sender allows only a few emails per hour, which would break a live sign-up demo. Turn it back **ON** once a real SMTP sender (Resend, Postmark, etc.) is configured under Authentication → SMTP Settings.
3. **Auth → URL Configuration**: set Site URL to the GitHub Pages URL.
4. `config.js`: fill in `url` and `anonKey` from Project Settings → API.

## Security notes

- Only `@berklee.edu` emails can register: enforced by a `before insert` trigger on `auth.users`, not just the sign-up form.
- Asks are written only through `send_ask` / `decide_ask` (security definer functions) which enforce 5 sent and 3 accepted per person per week.
- A pass never reaches the sender: the `sent_asks` view maps `passed` to `pending`.
- Storage: users can only write under their own folder (`<user id>/...`). Files are public-read so phones can stream them; the UI has no download button.

## Deleting test accounts

Dashboard → Authentication → Users → delete the user. Profiles, works, asks and collabs cascade. Remove their files under Storage → `work` / `avatars`.
