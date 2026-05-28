# Anime Watchtower

דשבורד אנימה בעברית/RTL למעקב אחרי סדרות, פרקים, לוח שידורים ומקורות צפייה אישיים.

## Live

https://doravidan.github.io/anime-watchtower/

## מה יש בפנים

- חיפוש אנימה דרך AniList GraphQL.
- הוספה לרשימת מעקב עם שמירה מקומית בדפדפן (`localStorage`).
- כרטיסי סדרות עם סטטוס, פרק הבא וספירה חיה.
- התקדמות צפייה אישית: פרק נוכחי, סטטוס צפייה, עדיפות כתוביות ושם עברי ידני.
- לוח שבועי לפי `Asia/Jerusalem`.
- איזור **הכי נצפים עכשיו** עם פילטרים:
  - היום — AniList `TRENDING_DESC`
  - השבוע — AniList `POPULARITY_DESC`
  - החודש — AniList `SCORE_DESC` עם סף פופולריות
- מנהל מקורות צפייה אישיים עם templates של `{title}`, `{episode}`, `{query}`.
- קישורי גילוי חוקיים/חינמיים כשזמין: YouTube רשמי, Tubi, Pluto TV, Plex Free, RetroCrush.

## פיתוח

```bash
npm install
npm run dev
```

## בדיקות ובנייה

```bash
npm run lint
npm run build
```

## Deploy

האתר נפרס דרך GitHub Pages באמצעות workflow ב־`.github/workflows/pages.yml`.

כל push ל־`main` מריץ build ומעלה את `dist/` ל־GitHub Pages.

## מקורות נתונים

- AniList GraphQL — metadata, search, trending, popularity, score, next airing episode, weekly airing schedules, external links.
- מקורות הצפייה האישיים נשמרים מקומית אצל המשתמש. אין אינטגרציה עם אתרי פיראטיות ואין הבטחה לזמינות כתוביות בעברית.