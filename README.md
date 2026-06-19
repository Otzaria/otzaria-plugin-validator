# Otzaria Plugin Validator

> בודק תוספי אוצריא ב‑CI — אותן בדיקות בדיוק שרצות בעת אריזה בפרויקט וב‑העלאה לחנות התוספים.
>
> Validate Otzaria plugins in CI — the same checks the Otzaria packager and store run.

[![Validate](https://github.com/Otzaria/otzaria-plugin-validator/actions/workflows/ci.yml/badge.svg)](https://github.com/Otzaria/otzaria-plugin-validator/actions/workflows/ci.yml)

---

## מה זה עושה

GitHub Action שמריץ ולידציה מלאה על תוסף אוצריא — או על מספר תוספים בו‑זמנית — ומסמן
שגיאות ואזהרות ישירות על הקובץ ב‑Pull Request. הלוגיקה היא פורט מדויק (1:1) של:

- `PluginManifestValidator` ו‑`PluginExtendedValidator` שבפרויקט [Otzaria/otzaria](https://github.com/Otzaria/otzaria) (סקריפט האריזה `pack-plugin`).
- ולידטור החנות (`pluginValidation.js`) שרץ בעת העלאת תוסף.

**רשימת ה‑APIים, ההרשאות והאירועים נמשכת בזמן אמת** מ‑`docs/plugin-sdk/API_REFERENCE.md`
שבריפו הרשמי (ענף `dev`) — בדיוק כמו בבדיקה האוטומטית בחנות. כך תוסף שמשתמש ב‑API חדש
שתועד זה עתה יעבור, ואילו נפילת רשת חוזרת לרשימת fallback מובנית כדי שה‑CI לעולם לא יישבר.

## למה להשתמש

מי שמפתח תוסף יכול להוסיף את ה‑Action הזה ל‑CI שלו ולקבל **בדיוק את אותה תשובה** שיקבל
כשינסה לארוז (`pack-plugin`) או להעלות לחנות — לפני שהוא מגיע לשם.

## שימוש מהיר

```yaml
# .github/workflows/validate.yml
name: Validate plugin
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Otzaria/otzaria-plugin-validator@v1
```

זהו. ברירת המחדל סורקת את כל הריפו, מגלה כל `manifest.json` או קובץ `.otzplugin`,
ונכשלת רק על שגיאות חוסמות (אזהרות מוצגות אך אינן מפילות) — בדיוק כמו ה‑CLI.

## דוגמאות

תוסף בתת‑תיקייה, עם כשל גם על אזהרות (התנהגות זהה ל‑העלאה לחנות):

```yaml
      - uses: Otzaria/otzaria-plugin-validator@v1
        with:
          path: plugins/my-plugin
          fail-on-warnings: true
```

בדיקת תאימות לגרסת אוצריא מסוימת (מפעיל את בדיקת `minAppVersion`/`maxAppVersion`):

```yaml
      - uses: Otzaria/otzaria-plugin-validator@v1
        with:
          path: my-plugin
          app-version: '0.9.95'
```

בדיקת קובץ ארוז:

```yaml
      - uses: Otzaria/otzaria-plugin-validator@v1
        with:
          path: dist/my-plugin-1.0.0.otzplugin
```

מונורפו עם כמה תוספים — פשוט הצביעו על תיקיית האב (או השאירו ברירת מחדל):

```yaml
      - uses: Otzaria/otzaria-plugin-validator@v1
        with:
          path: plugins
```

## קלטים (inputs)

| קלט | ברירת מחדל | תיאור |
|---|---|---|
| `path` | `.` | תיקיית תוסף, תיקיית‑אב עם כמה תוספים, `manifest.json`, או קובץ `.otzplugin`. |
| `fail-on-warnings` | `false` | `true` — אזהרות מפילות את הריצה (כמו החנות). `false` — רק שגיאות מפילות (כמו ה‑CLI). |
| `app-version` | `''` | גרסת אוצריא לבדיקת תאימות `minAppVersion`/`maxAppVersion`. ריק = דילוג (כמו האריזה). |
| `api-reference-url` | `''` | דריסת כתובת ה‑`API_REFERENCE.md` הנמשך בזמן אמת. |

## פלטים (outputs)

| פלט | תיאור |
|---|---|
| `passed` | `'true'` אם הבדיקה עברה. |
| `total-plugins` | מספר התוספים שנבדקו. |
| `total-errors` | סך השגיאות החוסמות. |
| `total-warnings` | סך האזהרות. |

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
