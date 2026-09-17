# Otzaria Plugin Validator &amp; Publisher

> מאמת את התוסף ו**מפרסם אותו אוטומטית לחנות אוצריא** — push אחד ל‑main, והגרסה החדשה בדרך לחנות.
>
> Validate an Otzaria plugin and **auto‑publish it to the Otzaria store** — one push, one new version live.

[![CI](https://github.com/Otzaria/otzaria-plugin-validator/actions/workflows/ci.yml/badge.svg)](https://github.com/Otzaria/otzaria-plugin-validator/actions/workflows/ci.yml)

---

## מה זה עושה

GitHub Action אחד שעושה את כל מסלול ההפצה של תוסף אוצריא:

1. **מאמת** — אותן בדיקות בדיוק שרצות בעת אריזה (`pack-plugin`) ובהעלאה לחנות. נכשל על שגיאות, מצביע על מה לתקן.
2. **בונה** — אורז `.otzplugin` תקני מתיקיית התוסף (מכבד תיקיות פיתוח כמו `node_modules`/`.git`, וקובץ [`.otzignore`](#החרגת-קבצים-מהבנייה-otzignore) אופציונלי).
3. **מפרסם לחנות** — דוחף את הגרסה החדשה ל‑[otzaria.org](https://otzaria.org) אוטומטית, כשמוגדרים הסודות.

**המטרה: לא להיכנס לחנות ידנית בכל עדכון.** מעדכנים את `manifest.json`, דוחפים ל‑main, וה‑Action
מאמת → בונה → מפרסם. הפרסום מתבצע **רק** כשהסודות מוגדרים ו**לעולם לא** באירוע `pull_request`.

**רשימת ה‑APIים, ההרשאות, האירועים וההרשאה שכל API דורש** מגיעות מ‑`docs/plugin-sdk/spec.json`
שבריפו הרשמי — מפרט שמחולל שם מקוד האפליקציה, בדיוק כמו בבדיקה האוטומטית בחנות.
**עותק שלו מצורף כאן** (`src/spec.json`), ולכן התוצאה אינה תלויה בזמינות רשת:
בלי רשת נעשה שימוש באותו הארטיפקט עצמו. איחול חי של הקובץ נעשה בנוסף, והוא
יכול רק **להרחיב** את המשטח המוכר (API שנוסף אחרי גרסת הוולידטור), לא לצמצם אותו.

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

> ⚠️ **שני דברים שחשוב לדעת על הפרסום:**
> - **חובה עליית גרסה** מעל הקיימת בחנות, אחרת הדחיפה מדולגת/נכשלת.
> - **דחיפה ראשונה (תוסף חדש)** מחייבת לפחות צילום מסך — ספק אותו עם הקלט `screenshots: screenshots/main.png` —
>   ורק היא ממתינה לאישור מנהל לפני שהתוסף עולה לחנות (`pending-approval=true`). עדכון גרסה לתוסף
>   **קיים** עולה לחנות מיידית, בלי אישור.

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

### תגובת סיכום על ה-PR (`pr-comment`)

כדי שהתוצאות (כולל טבלת השגיאות/אזהרות/עיצוב) יופיעו כתגובה על ה-PR ולא רק ב-Job Summary,
הוסף `pr-comment: true` וטוקן עם הרשאת כתיבה על תגובות:

```yaml
on: [pull_request]
permissions:
  pull-requests: write
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Otzaria/otzaria-plugin-validator@v1
        with:
          pr-comment: 'true'
          github-token: ${{ github.token }}
```

כל push חדש ל-PR מוחק את תגובת הסיכום הקודמת (מזוהה ע"י סמן חבוי) ומפרסם חדשה במקומה —
כך שיש תמיד תגובה אחת, לא שרשרת שמצטברת. ב-PR שמגיע מ-fork, ל-`GITHUB_TOKEN`
יש הרשאת קריאה בלבד תמיד (מגבלת GitHub, בלי קשר ל-`permissions:` שהוגדר) —
הפרסום ידולג עם אזהרה, בלי להפיל את הריצה.

## קלטים (inputs)

| קלט | ברירת מחדל | תיאור |
|---|---|---|
| `path` | `.` | תיקיית תוסף, תיקיית‑אב עם כמה תוספים, `manifest.json`, או קובץ `.otzplugin`. |
| `fail-on-warnings` | `false` | `true` — אזהרות מפילות את הריצה (כמו החנות). `false` — רק שגיאות מפילות (כמו ה‑CLI). |
| `app-version` | `''` | גרסת אוצריא לבדיקת תאימות `minAppVersion`/`maxAppVersion`. ריק = דילוג. |
| `spec-url` | `''` | דריסת כתובת ה‑`spec.json` הנמשך בזמן אמת. |
| `api-reference-url` | `''` | מיושן ומתעלמים ממנו. המפרט נקרא מ‑`spec.json`. |
| `pr-comment` | `false` | `true` — מפרסם/מחליף תגובת סיכום יחידה על ה‑PR (ראו [למעלה](#תגובת-סיכום-על-ה-pr-pr-comment)). פועל רק ב‑`pull_request(_target)`. |
| `github-token` | `''` | טוקן לפרסום תגובת ה‑PR (נדרש כשל‑`pr-comment` הוא `true`). בד"כ `${{ github.token }}`. |
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
| `pending-approval` | `'true'` אם הדחיפה ממתינה לאישור מנהל — קורה רק ביצירת תוסף חדש (דחיפה ראשונה), לא בעדכון גרסה. |
| `plugin-file` / `sha256` | נתיב ה‑`.otzplugin` שנבנה ו‑hash שלו. |

## החרגת קבצים מהבנייה (`.otzignore`)

מעבר לתיקיות הפיתוח והמטא‑דאטה שמוחרגות אוטומטית (`node_modules`, `.git`,
`README`/`LICENSE`, קבצי `.md`, dotfiles, `.github`, `screenshots`…), אפשר להחריג
קבצים נוספים שאין בהם צורך בזמן ריצה (מקורות גולמיים, source maps, נתוני בנייה גדולים).
הוסף קובץ **`.otzignore`** בשורש תיקיית התוסף. התחביר זהה ל‑`.gitignore`:

```gitignore
# הערות מותרות בתחילת שורה בלבד (כמו .gitignore) — לא בסוף שורת תבנית

# glob לפי basename בכל עומק
*.map

# תיקייה שלמה (וכל מה שתחתיה)
src/

# נתיב מעוגן לשורש התוסף
data/raw.json

# ** חוצה מפרידי נתיב
build/**

# ! מחזיר קובץ שהוחרג ע"י כלל קודם
!src/keep.js
```

- `*` מתאים בתוך מקטע נתיב יחיד, `**` חוצה מקטעים, `?` תו בודד.
- `/` בסוף = תיקייה בלבד; `/` בתוך התבנית מעגן אותה לשורש; בלי `/` ההתאמה לפי שם הקובץ בכל עומק.
- `!` בתחילת שורה מחזיר נתיב שהוחרג קודם (הכלל האחרון שמתאים קובע).
- ה‑`.otzignore` עצמו לעולם לא נארז. מספר הקבצים שהוחרגו נכתב ללוג הבנייה.

ההחרגה משפיעה רק על **בניית ה‑`.otzplugin`** (`build`/פרסום) — האימות עצמו עדיין סורק את כל הקבצים.
אל תחריג את ה‑`entrypoint` או נכסים שהוא טוען, אחרת התוסף יישבר בזמן ריצה.

## מנהל מול יוצר

ה‑Action עובד עם אותו workflow בין אם חשבון החנות הוא **היוצר** של התוסף ובין אם הוא **מנהל** —
השרת מתאים את עצמו:

- **יוצר (לא מנהל):** השרת גוזר את שדות התוסף ישירות מה‑`manifest.json` שבקובץ; עדכון גרסה לתוסף
  **קיים** עולה **לחנות מיידית**, בלי אישור מנהל. חובה עליית גרסה.
- **מנהל:** העדכון עולה **לחנות מיידית** גם כן. ההבדל הוא מקור השדות: השרת לוקח אותם מהבקשה,
  **לא** מה‑manifest. לכן `sync-metadata: true` (ברירת מחדל) דואג שה‑Action ימלא את השדות מתוך ה‑manifest —
  וכך גם עדכון של מנהל מסנכרן את כל השדות ל‑manifest, בדיוק כמו אצל יוצר. התיאור הארוך והתגיות בחנות נשמרים.

**אישור מנהל נדרש רק בדחיפה הראשונה** שיוצרת תוסף חדש בחנות (`pending-approval=true`) — לא בעדכוני
גרסה לתוסף קיים, בין אם דרך נתיב היוצר ובין אם דרך נתיב האדמין.

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
- `name` ארוך מ‑14 תווים (מוצג בראש לשונית התוסף ב"כלים").
- `description` (התיאור הקצר בחנות) ארוך מ‑150 תווים.
- `contributes.toolTab.title` שהוגדר במפורש ואינו זהה ל‑`name` (הכותרת המוצגת בטאב חייבת להיות זהה לשם).
- `version` שאינו SemVer תקין (`^\d+\.\d+\.\d+(?:\+.*)?$`).
- הרשאה שאינה ברשימת ההרשאות הרשמית (עם רמז לתיקון).
- `contributes.databaseSources` ללא הרשאת `database.read`, או רשומות לא תקינות.
- `toolTab.iconName` שאינו שם אייקון FluentUI 24px תקין.
- `entrypoint` שחורג מגבולות התיקייה, לא קיים, או יושב בתיקייה מוחרגת מאריזה.
- הרשאה או API שקיימים רק בגרסה חדשה מ‑`minAppVersion` שהוצהר.
- תנאי `when` פגום על תרומה ב‑`contributes.startup` (`toolbarItems`,
  `contextMenuItems`, `searchDialogItems` או איבר `{topic, when}` ב‑`activationEvents`):
  חריגה מהסכימה (מפתח יחיד לכל צומת, בדיוק אחד מ‑`equals`/`notEquals`/`exists` בעלה),
  עומק מעל 5, מעל 20 עלים, `key` ריק או ארוך מ‑128 תווים, שדה לא מוכר באיבר
  `activationEvents` (טעות כתיב כמו `wen`), עלה `setting` על הגדרה שתוספים אינם
  רשאים לקרוא, או `when` עם `minAppVersion` נמוך מ‑0.9.97. תוסף בלי `when` אינו נבדק.
- תוסף ללא ממשק (`"headless": true`) שקובץ הכניסה שלו אינו `.js`, שאין לו דרך
  להתעורר (`activationEvents`, או פקד/פריט תפריט שמפעילים את התוסף), שאינו מבקש
  `app.run_on_startup`, שמצהיר על `contributes.toolTab` / `contributes.background.entrypoint`
  / `openPlugin` / `openPluginOnSubmit`, או עם `minAppVersion` נמוך מ‑0.9.98.
- (אופציונלי, עם `app-version`) אי‑תאימות `minAppVersion`/`maxAppVersion`.

**אזהרות** (מוצגות; מפילות רק עם `fail-on-warnings` — זהה ל‑`PluginExtendedValidator`):

- קריאה ל‑API לא מוכר, או רישום ל‑event לא מוכר.
- שימוש ב‑method ללא ההרשאה הנדרשת, או event ללא `events.subscribe:*`.
- `network.access`/`network.enabled` עם `network.allowlist` ריק או כתובות לא תקינות.

**הערות עיצוב** (notices; לעולם לא מפילות — לפי `DESIGN_GUIDE.md`):

- `<html>` ללא `dir="rtl"` / `lang="he"`, צבעי hex/rgb/שמות באנגלית מקודדים,
  `font-family`/`font-size`/`border-radius` מקודדים, או היעדר שימוש ב‑`var(--color-*)`.

## הרצה מקומית

מתוך שכפול של המאגר הזה:

```bash
node src/cli.js path/to/plugin
node src/cli.js path/to/plugin --fail-on-warnings --app-version 0.9.95
```

או — בלי לשכפל דבר — ישירות מתיקיית התוסף:

```bash
npx --yes github:Otzaria/otzaria-plugin-validator#v1 . --publish false
```

**זה מתעדכן מעצמו.** `npm` פותר את התג `v1` מחדש בכל הרצה ושומר במטמון לפי ה‑commit
שנפתר, ולא לפי שם הספק. ברגע ש‑`v1` זז, ההרצה המקומית הבאה — אצל כל מפתח ובכל מכונה —
כבר רצה מול הקוד החדש, בלי שיתקין או יעדכן דבר. אין מצב של וולידטור ישן שנתקע אצל מישהו.

`--publish false` מוודא שהרצה מקומית לעולם אינה נוגעת בחנות. גם בלעדיו הפרסום היה מדולג
בהיעדר סודות, וזו חגורה שנייה.

### אימות לפני קומיט (git hook)

כדי לתפוס שגיאות לפני הדחיפה במקום אחריה, בריפו של התוסף:

```sh
# .githooks/pre-commit
#!/bin/sh
CMD="npx --yes github:Otzaria/otzaria-plugin-validator#v1 . --publish false"

# timeout כדי שרשת תקועה לא תשתק קומיט; היכן שאינו קיים, מריצים בלעדיו
if command -v timeout >/dev/null 2>&1; then out=$(timeout 120 $CMD 2>&1); else out=$($CMD 2>&1); fi
printf '%s\n' "$out"

case "$out" in
  *"OUTPUT passed=true"*)  exit 0 ;;   # התוסף תקין
  *"OUTPUT passed=false"*) exit 1 ;;   # נכשל באימות — הקומיט נעצר
esac

# לא הודפסה שורת פסיקה ⇒ הוולידטור לא רץ כלל (רשת, node, GitHub, תעודות).
# זו אינה סיבה לחסום עבודה — ה‑CI הוא הסמכות הסופית וממילא יאמת בדחיפה.
echo "אזהרה: הוולידטור לא רץ. הקומיט ממשיך; האימות יתבצע ב‑CI."
exit 0
```

ומפעילים אותו פעם אחת, כך שגם כל מי שישכפל את הריפו יקבל אותו:

```bash
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

**הפסיקה נלקחת מהפלט של הוולידטור, לא מקוד היציאה של `npx` — וזה מכוון.** הוולידטור מדפיס
`OUTPUT passed=true|false` גם בהרצה מקומית, וזו העדות היחידה האמינה לכך שהוא באמת רץ:

| מה הודפס | מה קרה | ה‑hook |
|---|---|---|
| `OUTPUT passed=true` | התוסף תקין | ממשיך |
| `OUTPUT passed=false` | האימות מצא שגיאות | **עוצר את הקומיט** |
| לא הודפסה שורת פסיקה | הוולידטור לא רץ כלל | מזהיר וממשיך |

קוד היציאה של `npx` **אינו** מבחין בין השניים: הוא מחזיר `1` גם כשהתוסף נכשל באימות וגם על
תקלות תשתית — למשל `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` מאחורי proxy ממסר‑TLS, שנתקלנו בו
בפועל. hook שנשען על קוד היציאה היה חוסם קומיטים בגלל תעודה, ולא בגלל התוסף.

בנוסף, `npx` מול ספק git **אינו יכול לרוץ ללא רשת** — הוא חייב לפתור את הרפרנס מול GitHub,
ו‑`--offline`/`--prefer-offline` אינם עוזרים (שניהם יוצאים ב‑`128`). ברשת גרועה הוא אף עלול
לנסות שוב ושוב ולהיתקע, ומכאן ה‑`timeout`. הכלל: **כשל אימות חוסם, כשל תשתית לא.**

> לעקוף פעם אחת בכוונה: `git commit --no-verify`.

## תחזוקת מפרט ה‑SDK (`src/spec.json`)

`src/spec.json` הוא **עותק מצורף** של `docs/plugin-sdk/spec.json` מריפו האפליקציה,
שמחולל שם מקבועי הקוד ע"י `dart run tool/plugins/generate_plugin_spec.dart`.
**אין לערוך אותו ביד** — וגם לא את הרשימות ב‑`src/knownApi.js`, שנגזרות ממנו.

```bash
npm run sync:spec                        # מ‑Otzaria/otzaria@dev
npm run sync:spec -- --from ../otzaria    # מ‑checkout מקומי
npm run test:spec-drift                  # נכשל כשהעותק סחף מהמפרט החי
```

**מה נכשל אם שוכחים:** ה‑job `spec-drift` ב‑CI משווה את העותק למפרט החי
ונכשל על כל הפרש (מדלג בשקט אם המפרט אינו נגיש, כדי שרשת נופלת לא
תצבע אותו אדום). בלי ריענון, API חדש לא יוכר במסלול שללא רשת.

כללים שאין להם מקביל באפליקציה נשארים ב‑`src/knownApi.js` ומסומנים שם
`VALIDATOR-LOCAL` (למשל `PERMISSION_MIN_VERSION`, ומתודות לא‑מתועדות שבתוספים
קיימים). כללי הרשת אינם חלק מהמפרט.

## שימוש כחבילה — החנות נשענת על הריפו הזה

המאגר הוא גם **חבילת npm**, והחנות (`Otzaria_Website`) צורכת אותה: אין באתר
מימוש שני של אותם כללים. שם היא מוצהרת כך:

```json
"otzaria-plugin-validator": "github:Otzaria/otzaria-plugin-validator#v1"
```

### מי אחראי על מה

| שכבה | סמכות | איפה |
|---|---|---|
| **נתונים** — מתודות, הרשאות, אירועים, גרסאות מינימום, מדיניות ההגדרות | `spec.json`, מחולל בריפו של אוצריא מקוד האפליקציה | `src/spec.json` (נוסע בתוך החבילה) |
| **לוגיקה** — תאימות למפרט: כללי מניפסט, תנאי `when`, סריקת קוד, הצלבת הרשאות, תאימות עיצוב, reachability | החבילה הזאת | `src/index.js` ומה שהוא מייצא |
| **מדיניות** — מה חוסם, באיזו חומרה, ומה נדרש כדי להתפרסם (צילומי מסך, רצפת `minAppVersion`, `homepage`, חסימה על אזהרות) | החנות | `Otzaria_Website/src/lib/pluginValidation.js` והנתיבים שקוראים לו |

`src/index.js` הוא **ייצוא טהור בלי תופעות לוואי** — טעינתו אינה מריצה את
ה‑Action. עטיפת ה‑Action היא `src/action.js`, וזה מה ש‑`action.yml` מצביע אליו.

### רענון: החנות מקבלת את ראש `v1` בכל בנייה

התגית `v1` נעה — `release.yml` מזיז אותה לכל גרסה חדשה. אבל `npm ci` נאמן
ל‑SHA שב‑`package-lock.json`, ולכן ב‑`deploy.yml` של האתר יש **צעד רענון מפורש**
אחרי ההתקנה, בשני מקומות ההתקנה (בדיקת ה‑CI והדריסה לשרת):

```bash
npm install "github:Otzaria/otzaria-plugin-validator#v1" --legacy-peer-deps --no-save
```

**המשמעות: כלל ולידציה חדש כאן משפיע על החנות בבנייה הבאה שלה, בלי שער סקירה
ביניהן.** זה מכוון — מי שיש לו גישת כתיבה לריפו אחד יש לו גם לשני. לכן שינוי
בחומרה של כלל, או כלל חוסם חדש, פוסל מכאן ואילך גם *עדכון* של תוסף שכבר בחנות.

### חומרה נקבעת אצל הצרכן

`analyzeApiUsage` מחזיר את הממצאים **מקובצים לפי סוג ובלי חומרה**, וכל צרכן
ממפה אותם: ה‑Action מדווח על הצהרת הרשאת בסיס כאזהרה, והחנות כ‑advisory שאינו
פוסל — שם אזהרה חוסמת פרסום, ולכן היא חסמה כל עדכון של כל תוסף שמצהיר הרשאת
בסיס. זה מה שמאפשר מימוש אחד לשני חוזי חומרה.

באותה רוח `MANIFEST_RULES` מפוצל לכלל‑לפונקציה, ו‑`validateManifestFields`
מקבל `rules` לבחירת תת‑קבוצה. ה‑Action והאריזה באוצריא מריצים את כולם; החנות
מריצה `schemaVersion, name, description, toolTabTitle, permissions` בלבד —
הרחבת הרשימה שם היא **החלטת מדיניות**, לא רפקטור.

## פיתוח

ה‑Action כתוב ב‑Node.js נטו, **ללא תלויות ריצה וללא שלב build** — אין `node_modules`
לבנות או `dist` לבאנדל. הבדיקות:

```bash
npm test
```

## רישיון

MIT
