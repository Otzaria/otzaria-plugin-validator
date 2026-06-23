# Otzaria Plugin Validator &amp; Publisher

> מאמת את התוסף ו**מפרסם אותו אוטומטית לחנות אוצריא** — push אחד ל‑main, והגרסה החדשה בדרך לחנות.
>
> Validate an Otzaria plugin and **auto‑publish it to the Otzaria store** — one push, one new version live.

[![CI](https://github.com/Otzaria/otzaria-plugin-validator/actions/workflows/ci.yml/badge.svg)](https://github.com/Otzaria/otzaria-plugin-validator/actions/workflows/ci.yml)

---

## מה זה עושה

GitHub Action אחד שעושה את כל מסלול ההפצה של תוסף אוצריא:

1. **מאמת** — אותן בדיקות בדיוק שרצות בעת אריזה (`pack-plugin`) ובהעלאה לחנות. נכשל על שגיאות, מצביע על מה לתקן.
2. **בונה** — אורז `.otzplugin` תקני מתיקיית התוסף (מכבד תיקיות פיתוח כמו `node_modules`/`.git`).
3. **מפרסם לחנות** — דוחף את הגרסה החדשה ל‑[otzaria.org](https://otzaria.org) אוטומטית, כשמוגדרים הסודות.

**המטרה: לא להיכנס לחנות ידנית בכל עדכון.** מעדכנים את `manifest.json`, דוחפים ל‑main, וה‑Action
מאמת → בונה → מפרסם. הפרסום מתבצע **רק** כשהסודות מוגדרים ו**לעולם לא** באירוע `pull_request`.

**רשימת ה‑APIים, ההרשאות והאירועים נמשכת בזמן אמת** מ‑`docs/plugin-sdk/API_REFERENCE.md`
שבריפו הרשמי (ענף `dev`) — בדיוק כמו בבדיקה האוטומטית בחנות. נפילת רשת חוזרת לרשימת fallback מובנית.

## הגדרה — פרסום אוטומטי לחנות

הוסף שני **Secrets** בלבד ב‑`Settings → Secrets and variables → Actions` בריפו של התוסף:

| Secret | מה זה |
|---|---|
| `OTZARIA_USER` | אימייל / שם משתמש של חשבון החנות (היוצר של התוסף). |
| `OTZARIA_PASSWORD` | הסיסמה לאותו חשבון. |

**אין צורך במזהה תוסף** — התוסף מזוהה אוטומטית לפי ה‑`id` שב‑`manifest.json`. ואז workflow מינימלי:

```yaml
# .github/workflows/release.yml
name: Publish plugin
on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Otzaria/otzaria-plugin-validator@v1
        with:
          otzaria-user: ${{ secrets.OTZARIA_USER }}
          otzaria-password: ${{ secrets.OTZARIA_PASSWORD }}
```

זהו. כל push ל‑main שמעלה את הגרסה ב‑`manifest.json` → מאמת, בונה, ודוחף לחנות.
אם הגרסה כבר קיימת בחנות, הפרסום מדולג. ה‑Action תומך גם במונורפו (כמה תוספים) — כל אחד
מזוהה לפי ה‑`id` שלו.

> ⚠️ **שלושה דברים שחשוב לדעת על הפרסום:**
> - **עדכון של בעלים ממתין לאישור מנהל** לפני שהוא עולה לחנות (`pending-approval=true`).
> - **חובה עליית גרסה** מעל הקיימת בחנות, אחרת הדחיפה מדולגת/נכשלת.
> - **דחיפה ראשונה (תוסף חדש)** מחייבת לפחות צילום מסך — ספק אותו עם הקלט `screenshots: screenshots/main.png`.

## רק אימות (PR checks)

בלי הסודות ה‑Action פשוט מאמת — מושלם כבדיקת PR. אזהרות מוצגות אך אינן מפילות:

```yaml
on: [pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Otzaria/otzaria-plugin-validator@v1
        # אין סודות → publish=auto מדלג, מאמת בלבד. בכל מקרה פרסום חסום ב‑pull_request.
```

קלטים שימושיים נוספים: `fail-on-warnings: true` (אזהרות מפילות, כמו החנות),
`app-version: '0.9.95'` (בדיקת `minAppVersion`/`maxAppVersion`), `path` (תיקיית תוסף / מונורפו / `.otzplugin`).

## קלטים (inputs)

| קלט | ברירת מחדל | תיאור |
|---|---|---|
| `path` | `.` | תיקיית תוסף, תיקיית‑אב עם כמה תוספים, `manifest.json`, או קובץ `.otzplugin`. |
| `fail-on-warnings` | `false` | `true` — אזהרות מפילות את הריצה (כמו החנות). `false` — רק שגיאות מפילות (כמו ה‑CLI). |
| `app-version` | `''` | גרסת אוצריא לבדיקת תאימות `minAppVersion`/`maxAppVersion`. ריק = דילוג. |
| `api-reference-url` | `''` | דריסת כתובת ה‑`API_REFERENCE.md` הנמשך בזמן אמת. |
| `build` | `false` | `true` = בנה תמיד את ה‑`.otzplugin` וחשוף את הפלטים `plugin-file`/`sha256`, גם בלי פרסום. לא דורש סודות ורץ גם ב‑`pull_request`, כך שאפשר להעלות אותו כ‑artifact בצעד הבא. |
| `publish` | `auto` | `auto` = פרסם רק אם הסודות קיימים; `true` = חייב לפרסם (שגיאה אם חסר); `false` = אימות בלבד. תמיד מדולג ב‑`pull_request`. |
| `otzaria-user` | `''` | חשבון החנות (Secret). נדרש לפרסום. |
| `otzaria-password` | `''` | סיסמת החנות (Secret). נדרש לפרסום. |
| `otzaria-plugin-id` | `''` | **אופציונלי.** בדרך כלל לא נחוץ — התוסף מזוהה לפי ה‑`id` שב‑manifest. הגדר רק כדי לכוון למזהה ספציפי (תוסף יחיד). |
| `screenshots` | `''` | נתיבי צילומי מסך (מופרדים בפסיק/שורה). נדרש רק ב**דחיפה ראשונה** של תוסף חדש (החנות מחייבת לפחות אחד). |
| `description` | `''` | תיאור ארוך לחנות, בשימוש רק ביצירת תוסף חדש. ברירת מחדל: תיאור ה‑manifest. |
| `sync-metadata` | `true` | מעדכן את שדות התוסף בחנות (שם, יוצר, יציבות, minAppVersion, homepage, רשת) מתוך `manifest.json`. ראו "מנהל מול יוצר" למטה. `false` = משאיר כמו שהם. |
| `force` | `false` | פרסם גם אם הגרסה כבר בחנות (למנהל שמחליף קובץ באותה גרסה). ברירת מחדל מדלגת על פרסום no‑op. |
| `base-url` | `https://otzaria.org` | כתובת הבסיס של החנות. |
| `output` | `''` | שם קובץ ה‑`.otzplugin` הנבנה. ברירת מחדל `{id}-{version}.otzplugin`. |

## פלטים (outputs)

| פלט | תיאור |
|---|---|
| `passed` | `'true'` אם האימות עבר. |
| `total-plugins` / `total-errors` / `total-warnings` | מונים. |
| `published` | `'true'` אם נדחף עדכון לחנות. |
| `pending-approval` | `'true'` אם העדכון שנדחף ממתין לאישור מנהל. |
| `plugin-file` / `sha256` | נתיב ה‑`.otzplugin` שנבנה ו‑hash שלו. |

## מנהל מול יוצר

ה‑Action עובד עם אותו workflow בין אם חשבון החנות הוא **היוצר** של התוסף ובין אם הוא **מנהל** —
השרת מתאים את עצמו:

- **יוצר (לא מנהל):** השרת גוזר את שדות התוסף ישירות מה‑`manifest.json` שבקובץ; העדכון נכנס
  כ‑**ממתין לאישור מנהל** (`pending-approval=true`) והגרסה הקיימת ממשיכה בחנות עד אישור. חובה עליית גרסה.
- **מנהל:** העדכון עולה **לחנות מיידית**. אבל השרת לוקח את שדות התוסף מהבקשה, **לא** מה‑manifest.
  לכן `sync-metadata: true` (ברירת מחדל) דואג שה‑Action ימלא את השדות מתוך ה‑manifest — וכך גם
  עדכון של מנהל מסנכרן את כל השדות ל‑manifest, בדיוק כמו אצל יוצר. התיאור הארוך והתגיות בחנות נשמרים.

תגובת השרת המלאה (כולל אם העדכון ממתין לאישור) **נכתבת ללוג הריצה** בכל מקרה, כך שתמיד רואים מה החנות החזירה.

## איך הפרסום עובד (ולמה הוא שברירי)

לחנות אין API ייעודי לאוטומציה, לכן ה‑Action מחקה את זרימת הדפדפן: מושך CSRF token,
מתחבר דרך ה‑Credentials provider של NextAuth כדי לקבל session cookie, ואז שולח `PUT`
לעדכון התוסף. **זו תלות בפנימיות NextAuth של האתר** (שמות cookies, נתיבי `/api/auth/*`) —
שדרוג עתידי של האתר עלול לשבור אותה. הפתרון היציב ארוך‑הטווח הוא endpoint פרסום מבוסס‑token
ייעודי באתר; עד אז, הזרימה הזו עובדת (וזהה לזו שכבר רצה בפועל ב‑release workflows קיימים).

## מה נבדק

**שגיאות חוסמות** (מפילות תמיד — זהה ל‑`PluginManifestValidator` + ה‑packager):

- `manifest.json` חסר, JSON לא תקין, או שדות חובה חסרים (`id`, `name`, `version`, `entrypoint`).
- `schemaVersion` שונה מ‑`1`.
- `id` שלא תואם `^[a-z0-9_.-]+$`.
- `version` שאינו SemVer תקין (`^\d+\.\d+\.\d+(?:\+.*)?$`).
- הרשאה שאינה ברשימת ההרשאות הרשמית (עם רמז לתיקון).
- `contributes.databaseSources` ללא הרשאת `database.read`, או רשומות לא תקינות.
- `toolTab.iconName` שאינו שם אייקון FluentUI 24px תקין.
- `entrypoint` שחורג מגבולות התיקייה, לא קיים, או יושב בתיקייה מוחרגת מאריזה.
- (אופציונלי, עם `app-version`) אי‑תאימות `minAppVersion`/`maxAppVersion`.

**אזהרות** (מוצגות; מפילות רק עם `fail-on-warnings` — זהה ל‑`PluginExtendedValidator`):

- קריאה ל‑API לא מוכר, או רישום ל‑event לא מוכר.
- שימוש ב‑method ללא ההרשאה הנדרשת, או event ללא `events.subscribe:*`.
- `network.access`/`network.enabled` עם `network.allowlist` ריק או כתובות לא תקינות.

**הערות עיצוב** (notices; לעולם לא מפילות — לפי `DESIGN_GUIDE.md`):

- `<html>` ללא `dir="rtl"` / `lang="he"`, צבעי hex/rgb/שמות באנגלית מקודדים,
  `font-family`/`font-size`/`border-radius` מקודדים, או היעדר שימוש ב‑`var(--color-*)`.

## הרצה מקומית

```bash
node src/cli.js path/to/plugin
node src/cli.js path/to/plugin --fail-on-warnings --app-version 0.9.95
```

## פיתוח

ה‑Action כתוב ב‑Node.js נטו, **ללא תלויות ריצה וללא שלב build** — אין `node_modules`
לבנות או `dist` לבאנדל. הבדיקות:

```bash
npm test
```

## רישיון

MIT
