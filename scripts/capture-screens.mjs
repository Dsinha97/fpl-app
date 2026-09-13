/**
 * Re-shoot the reference frames in `Screens/` at the size the originals use.
 *
 * The audit issues (DSI-118…129) were each written against a frame in
 * `Screens/`, and DSI-136's gate asks for the matching frame to be re-shot and
 * compared after a change. Those originals are 1920x1080 full-window captures;
 * the Browser pane emulates a viewport and scales it to fit, so it cannot
 * produce a comparable image, and it returns screenshots into the conversation
 * rather than writing files. Hence Playwright.
 *
 *   node scripts/capture-screens.mjs                # every frame
 *   node scripts/capture-screens.mjs fixtures team  # only matching names
 *
 * The dev server must already be running (`preview_start`, never Bash — see
 * CLAUDE.md). Credentials come from `.env.local`; nothing is hardcoded here.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "Screens");
const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const SIZE = { width: 1920, height: 1080 };

function env() {
  const raw = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const E = env();
const SUPABASE_URL = E.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = E.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const AUTH_KEY = `sb-${PROJECT_REF}-auth-token`;

/** Mint a session the same way the `signed-in` skill does — no form, no password typed. */
async function session() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify({ email: E.TEST_USER_EMAIL, password: E.TEST_USER_PASSWORD }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`sign-in failed: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

/**
 * Pull the account's saved squads out of `team_drafts` and hand them to the
 * page as localStorage, which is where `lib/drafts.ts` reads them from.
 *
 * Without this every context is a fresh browser with no drafts, and the
 * squad-shaped pages capture their empty state instead of the screen the audit
 * was written from — `/transfers` shot "No saved squads yet" and reported
 * itself fine, because no step had failed. DraftSyncProvider would pull these
 * eventually, but "eventually" is not something a screenshot can wait for.
 */
async function drafts(token) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/team_drafts?select=payload,updated_at&deleted_at=is.null&order=updated_at.desc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } },
  );
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(`draft pull failed: ${JSON.stringify(rows).slice(0, 160)}`);
  return rows.map((r) => r.payload).filter(Boolean);
}

/**
 * Steps are deliberately declarative and forgiving: a frame that needs a panel
 * open says so, and a step that cannot find its target reports the frame as
 * partial rather than throwing, so one moved button does not abort the run.
 */
const click = (text) => ({ kind: "click", text });
const clickNth = (text, nth) => ({ kind: "click", text, nth });
const wait = (ms) => ({ kind: "wait", ms });
/** Several frames are a scroll position on one long page, not a separate view. */
const scrollTo = (text) => ({ kind: "scrollTo", text });
/** Tick the first n checkboxes — the multi-select frames all start this way. */
const checkFirst = (n) => ({ kind: "checkFirst", n });

/** name → the frame in Screens/. path → route. steps → how to reach the state. */
const FRAMES = [
  // ---------------------------------------------------------------- signed out
  { name: "Landing-NotSigned", path: "/", auth: false },
  { name: "SignIn-Options", path: "/signin/", auth: false },
  { name: "MyTeam-NotSigned", path: "/team/", auth: false },
  { name: "Profile-NotSigned", path: "/players/", auth: false, steps: [click("Sign in and theme menu"), wait(400)] },

  // ------------------------------------------------------------------ my team
  { name: "MyTeam-SignedIn", path: "/team/" },
  { name: "MyTeam-Squad", path: "/team/" },
  { name: "Profile-SignedIn", path: "/team/", steps: [click("Account menu"), wait(400)] },

  // ----------------------------------------------------------------- fixtures
  { name: "Fixtures-ScheduleNoGw", path: "/fixtures/" },
  { name: "Fixtures-ScheduleMatch", path: "/fixtures/", steps: [clickNth("FT · BONUS TBC", 0), wait(600)] },
  { name: "Fixtures-FDR", path: "/fixtures/", steps: [click("FDR"), wait(900)] },
  { name: "Fixtures-Table", path: "/fixtures/", steps: [click("Table"), wait(900)] },
  { name: "Fixtures-Clubs", path: "/fixtures/", steps: [click("Clubs"), wait(900)] },

  // ------------------------------------------------------------------ players
  { name: "Players-Base", path: "/players/" },
  { name: "Players-Filter", path: "/players/", steps: [click("Filter"), wait(500)] },

  // ---------------------------------------------------------------- scenarios
  { name: "Scenarios-Squads", path: "/scenarios/" },

  // ---------------------------------------------------------------- transfers
  { name: "Transfers-Path", path: "/transfers/" },
  { name: "Transfers-Players", path: "/transfers/" },
  // /transfers builds its squad table after the pool loads, which outlasts
  // networkidle — wait for the button to exist rather than for the network.
  { name: "Transfers-PlayerReplacements", path: "/transfers/", steps: [wait(7000), clickNth("Replace", 0), wait(1200)] },
  { name: "Transfers-ChipStrategy", path: "/transfers/", steps: [click("Chip timing"), wait(4000)] },

  // --------------------------------------------------------------------- news
  { name: "News-All", path: "/news/" },
  { name: "News-Prices", path: "/news/", steps: [click("Prices"), wait(700)] },
  { name: "News-Availability", path: "/news/", steps: [click("Availability"), wait(700)] },
  { name: "News-Fixtures", path: "/news/", steps: [click("Fixtures"), wait(700)] },
  { name: "News-Feeds", path: "/news/", steps: [click("Feeds"), wait(1500)] },

  // ------------------------------------------------------------------ account
  { name: "Account-Details", path: "/settings/?tab=account" },
  { name: "Account-Import", path: "/settings/?tab=import" },
  { name: "Account-Notifications", path: "/settings/?tab=notifications" },

  // ------------------------------------------------------------------ leagues
  { name: "Leagues-Base", path: "/leagues/" },

  // ----------------------------------------------------------------- deadline
  { name: "Deadline-Live GW", path: "/deadline/" },

  // ---- frames that are a scroll position or a multi-step selection, not a route
  { name: "MyTeam-Decisions", path: "/team/", steps: [wait(3000), scrollTo("Decisions this season")] },
  { name: "MyTeam-ManagerRivals", path: "/team/", steps: [wait(3000), scrollTo("Career Percentile Profile")] },
  { name: "MyTeam-Seasons", path: "/team/", steps: [wait(3000), scrollTo("This season")] },
  { name: "Players-Selected", path: "/players/", steps: [wait(2000), checkFirst(2)] },
  { name: "Players-Compare", path: "/players/", steps: [wait(2000), checkFirst(2), wait(600), click("Compare 2"), wait(2500)] },
  { name: "Scenarios-Compare", path: "/scenarios/", steps: [wait(2500), checkFirst(4), wait(1500), scrollTo("Metric")] },
  { name: "Fixtures-ClubView", path: "/fixtures/", steps: [click("Clubs"), wait(1500), clickNth("Arsenal", 0), wait(900)] },
  { name: "Transfers-ChipPlan", path: "/transfers/", steps: [wait(6000), click("Chip plan"), wait(1200)] },
];

async function run() {
  mkdirSync(OUT, { recursive: true });
  const filters = process.argv.slice(2).map((s) => s.toLowerCase());
  const wanted = filters.length
    ? FRAMES.filter((f) => filters.some((q) => f.name.toLowerCase().includes(q)))
    : FRAMES;

  const sess = await session();
  const savedDrafts = await drafts(sess.access_token);
  console.log(`seeding ${savedDrafts.length} draft(s) into each context
`);
  const browser = await chromium.launch();
  const results = [];

  for (const frame of wanted) {
    const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
    // Dark is the primary theme and what the originals were shot in. Seeded
    // before first paint so the no-FOUC boot script reads it, not after.
    await ctx.addInitScript(
      ([authKey, token, signedIn, draftsJson]) => {
        localStorage.setItem("theme", "dark");
        if (signedIn) {
          localStorage.setItem(authKey, token);
          localStorage.setItem("fpl_drafts_v1", draftsJson);
        } else {
          localStorage.removeItem(authKey);
          localStorage.removeItem("fpl_drafts_v1");
        }
      },
      [AUTH_KEY, JSON.stringify(sess), frame.auth !== false, JSON.stringify(savedDrafts)],
    );

    const page = await ctx.newPage();
    const notes = [];
    try {
      await page.goto(`${BASE}${frame.path}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {
        notes.push("networkidle timed out — captured anyway");
      });
      await page.waitForTimeout(2500);

      for (const step of frame.steps ?? []) {
        if (step.kind === "wait") {
          await page.waitForTimeout(step.ms);
          continue;
        }
        if (step.kind === "scrollTo") {
          const el = page.getByText(step.text, { exact: false }).first();
          if (await el.count().then((n) => n > 0).catch(() => false)) {
            await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => notes.push(`scrollTo "${step.text}" failed`));
            await page.evaluate(() => window.scrollBy(0, -90));
          } else notes.push(`no target for scrollTo "${step.text}"`);
          continue;
        }
        if (step.kind === "checkFirst") {
          const boxes = page.locator('input[type="checkbox"]');
          const total = await boxes.count();
          if (total === 0) notes.push("no checkboxes to tick");
          for (let i = 0; i < Math.min(step.n, total); i++) {
            await boxes.nth(i).click({ timeout: 4000 }).catch(() => notes.push(`checkbox ${i} failed`));
            await page.waitForTimeout(250);
          }
          continue;
        }
        const target = page.getByText(step.text, { exact: false }).nth(step.nth ?? 0);
        const alt = page.getByRole("button", { name: step.text }).nth(step.nth ?? 0);
        if (await alt.count().then((n) => n > 0).catch(() => false)) {
          await alt.click({ timeout: 5000 }).catch((e) => notes.push(`click "${step.text}": ${e.message.slice(0, 60)}`));
        } else if (await target.count().then((n) => n > 0).catch(() => false)) {
          await target.click({ timeout: 5000 }).catch((e) => notes.push(`click "${step.text}": ${e.message.slice(0, 60)}`));
        } else {
          notes.push(`no target for "${step.text}"`);
        }
      }

      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${frame.name}.png`), fullPage: false });
      results.push({ name: frame.name, ok: notes.length === 0, notes });
    } catch (err) {
      results.push({ name: frame.name, ok: false, notes: [err.message.slice(0, 120)] });
    } finally {
      await ctx.close();
    }
    const last = results[results.length - 1];
    console.log(`${last.ok ? "ok  " : "warn"} ${last.name}${last.notes.length ? ` — ${last.notes.join("; ")}` : ""}`);
  }

  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} clean, ${bad.length} with notes`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
