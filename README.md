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

הוסף שלושה **Secrets** ב‑`Settings → Secrets and variables → Actions` בריפו של התוסף:

| Secret | מה זה |
|---|---|
| `OTZARIA_USER` | אימייל / שם משתמש של חשבון החנות (היוצר של התוסף). |
| `OTZARIA_PASSWORD` | הסיסמה לאותו חשבון. |
| `OTZARIA_PLUGIN_ID` | מזהה התוסף בחנות — ה‑id הפנימי מדף ניהול התוסף שלך (לא ה‑`id` שב‑manifest). |

ואז workflow שרץ רק על push ל‑main / tag:

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
          path: .
          otzaria-user: ${{ secrets.OTZARIA_USER }}
          otzaria-password: ${{ secrets.OTZARIA_PASSWORD }}
          otzaria-plugin-id: ${{ secrets.OTZARIA_PLUGIN_ID }}
```

זהו. כל push ל‑main שמעלה את הגרסה ב‑`manifest.json` → מאמת, בונה, ודוחף לחנות.
אם הגרסה כבר קיימת בחנות, הפרסום מדולג. ה‑Action בלבד לא יוצר GitHub Release —
[ראו workflow מלא עם release](examples/release.yml) שמשלב גם את זה.

> ⚠️ **שני דברים שחשוב לדעת על הפרסום:**
> - **עדכון של בעלים ממתין לאישור מנהל** לפני שהוא עולה לחנות. ה‑Action ידחוף בהצלחה ויסמן `pending-approval=true`, אך הפרסום בפועל אינו מיידי.
> - **חובה עליית גרסה** מעל הקיימת בחנות, אחרת הדחיפה תיכשל.

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
| `path` | `.` | תיקיית תוסף, תיקיית‑אב עם כמה תוספים, `manifest.json`, או קובץ `.otzplugin`. פרסום דורש תיקיית תוסף בודדת. |
| `fail-on-warnings` | `false` | `true` — אזהרות מפילות את הריצה (כמו החנות). `false` — רק שגיאות מפילות (כמו ה‑CLI). |
| `app-version` | `''` | גרסת אוצריא לבדיקת תאימות `minAppVersion`/`maxAppVersion`. ריק = דילוג. |
| `api-reference-url` | `''` | דריסת כתובת ה‑`API_REFERENCE.md` הנמשך בזמן אמת. |
| `publish` | `auto` | `auto` = פרסם רק אם שלושת הסודות קיימים; `true` = חייב לפרסם (שגיאה אם חסר סוד); `false` = אימות בלבד. תמיד מדולג ב‑`pull_request`. |
| `otzaria-user` | `''` | חשבון החנות (Secret). נדרש לפרסום. |
| `otzaria-password` | `''` | סיסמת החנות (Secret). נדרש לפרסום. |
| `otzaria-plugin-id` | `''` | מזהה התוסף בחנות (Secret). נדרש לפרסום. |
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
