# A&G leaflet tracker

Two pages:

- **Workers' page** (`index.html`): the workers pick their name and area, start a round, tap each street when it's done with the number of leaflets, and finish the round with the number left. Each tap saves the time and where the phone was at that moment. With no signal, it saves on the phone and sends later.
- **Dashboard** (`dashboard.html`): live totals per area, which streets are done and by whom, a map, every round with time taken, CSV downloads for the A&G app, and the list of workers. Only the email accounts you list can open it.

**Dashboard logins:** the dashboard shows where the workers were, so it's behind a login. Each person who should see it (for example you and Andrius) gets a login made of their own email address and a password. Any email address works. The workers don't need one.

Setup takes about 30 minutes, once. You need a Google account (for Firebase, free) and a GitHub account (free).

Firebase and GitHub change their screens from time to time, so the button names below may be slightly different.

---

## 1. Create the database

1. Go to **console.firebase.google.com** and sign in with a Google account.
2. Click **Create a project**. Name it `ag-leaflets`. Turn Google Analytics off. Click **Create project**.

## 2. Connect the pages to it

1. On the project's home screen, click the **web icon `</>`** ("Add app").
2. Nickname: `Leaflet tracker`. Leave "Firebase Hosting" unticked. Click **Register app**.
3. Firebase shows a block of code with `firebaseConfig = { apiKey: ..., ... }`.
4. Open `config.js` and replace each `PASTE_HERE` with the matching value from that block. Keep the quote marks.

## 3. Turn on sign-in and add the dashboard users

1. Left menu: **Build > Authentication > Get started**.
2. **Sign-in method** tab: turn on **Anonymous** (this is how the workers' phones connect, no passwords for them) and **Email/Password**.
3. **Users** tab > **Add user**: add your email and a password. Do the same for Andrius.
4. **Settings** tab > **Authorized domains** > **Add domain**: `YOUR-GITHUB-USERNAME.github.io`

## 4. Create the database and lock it down

1. Left menu: **Build > Firestore Database > Create database**.
2. Location: **europe-west2 (London)**. Choose **Start in production mode**.
3. Open the **Rules** tab. Delete what's there and paste in everything from `firestore.rules`.
4. In the pasted rules, change `you@example.com` and `andrius@example.com` to the two emails from step 3, in lower case.
5. Click **Publish**.

## 5. Put it online with GitHub Pages

1. Sign in at **github.com**. Click **New repository**. Name it `ag-leaflets`, set it to **Public**, click **Create repository**.
2. Click **uploading an existing file**. Drag in all the files from this folder (including your edited `config.js`). Click **Commit changes**.
3. Go to **Settings > Pages**. Under "Build and deployment", Source: **Deploy from a branch**, Branch: **main**, folder **/ (root)**. Click **Save**.
4. After a minute or two the address appears at the top of that page.

Your links:

- Workers: `https://YOUR-GITHUB-USERNAME.github.io/ag-leaflets/`
- Dashboard: `https://YOUR-GITHUB-USERNAME.github.io/ag-leaflets/dashboard.html`

A public repository means anyone who finds it can see the code and the street lists (streets only, no house numbers). The data itself is protected by the rules in step 4, not by hiding the code. Private repositories need a paid GitHub plan for Pages.

## 6. Add the workers

Open the dashboard, sign in, scroll to **Workers** and add each first name (Mickael, Martin, Aiden). The names live in the database, not in the code, so they don't appear in the public GitHub repository. Add or remove workers here any time; the workers' page updates by itself.

## 7. Test it before the workers go out

1. On your phone, open the workers' link. Pick a name and area, allow location, start a round with 10 leaflets, finish one street, then finish the round.
2. Open the dashboard on your computer and sign in. Your test round should be there.
3. Delete the test data: Firebase > **Firestore Database > Data**, open `events` and `locations`, and delete the test entries.

Then send the workers their link. On iPhone: Safari > Share > **Add to Home Screen**. On Android: Chrome menu > **Add to Home screen**. It then opens like an app.

---

## Changing workers or streets

**Workers:** on the dashboard, under **Workers**.

**Streets and areas:** in `routes.js`: each area's streets in walking order, the "only if leaflets are left" streets, and the leaflet target. On GitHub, open `routes.js`, click the pencil icon, make the change, click **Commit changes**. It's live within a couple of minutes. Workers reload the page to see it.

NW10 has no streets yet, so it shows as "Route not ready". Add its streets to `routes.js` when the route is planned.

## Getting the data into the A&G app

**Now:** on the dashboard, choose a day (or "All days") and click **Download activity (CSV)** or **Download rounds (CSV)**. Upload that file to the A&G app.

- *Activity*: one row per tap: start, each street, finish. Includes worker, area, street, leaflets, time, minutes since the previous tap, and latitude/longitude.
- *Rounds*: one row per round: who, where, start and finish time, how long it took, leaflets taken and left, and the total logged on streets.

**Later, live:** all the data sits in the Firebase database in two collections, `events` and `locations`, with the same fields as the CSVs. The A&G app can either read from Firebase directly, or the workers' page can send each tap straight to the A&G app as it happens. Which one depends on how the A&G app accepts data.

## Delivered numbers: two ways of counting

The dashboard shows both, so you can spot problems:

- **Logged on streets**: the numbers the workers enter for each street.
- **Bag count**: leaflets taken at the start minus leaflets left at the end.

If the two don't match for a round, the bag count is highlighted.

## What's recorded, and telling the workers

For each start, street and finish: the worker's name, the area, the street, the number of leaflets, the time, and where the phone was at that moment. The page uses the phone's location while a round is open so it can get a quick reading, but it only saves the location when they tap. Nothing is tracked after they finish the round or close the page.

The workers are 16, so tell them, and their parents, what's recorded and why before they start.
