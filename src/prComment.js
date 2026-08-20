'use strict'

// מפרסם תגובת סיכום יחידה על ה-PR, ומחליף אותה בכל push חדש (ולא מצטבר).
// הזיהוי הוא ע"י MARKER חבוי בתוכן: תגובה קיימת שמכילה אותו נמחקת לפני
// שנוצרת החדשה, כך שנשארת תמיד תגובת סיכום אחת בלבד לכל PR.
const MARKER = '<!-- otzaria-plugin-validator:summary -->'

function buildCommentBody(markdown, runUrl) {
  const link = runUrl ? `\n\n[הרצה מלאה](${runUrl})` : ''
  return `${MARKER}\n${markdown}${link}`
}

async function githubRequest(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'otzaria-plugin-validator-action',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = typeof res.text === 'function' ? await res.text().catch(() => '') : ''
    throw new Error(`HTTP ${res.status} ${method} ${url}${text ? ` — ${text.slice(0, 300)}` : ''}`)
  }
  return res.status === 204 ? null : res.json()
}

// מוחק כל תגובה קיימת עם ה-MARKER (בד"כ אחת) ואז יוצר תגובה חדשה עם התוכן
// הנוכחי. per_page=100 בלי pagination — PR ולידציה לא צפוי לצבור יותר תגובות.
async function replaceSummaryComment({ token, apiBase, prNumber, markdown, runUrl }) {
  const body = buildCommentBody(markdown, runUrl)
  const comments = await githubRequest(token, 'GET', `${apiBase}/issues/${prNumber}/comments?per_page=100`)
  const previous = Array.isArray(comments)
    ? comments.filter((c) => typeof c.body === 'string' && c.body.includes(MARKER))
    : []
  for (const c of previous) {
    await githubRequest(token, 'DELETE', `${apiBase}/issues/comments/${c.id}`)
  }
  return githubRequest(token, 'POST', `${apiBase}/issues/${prNumber}/comments`, { body })
}

module.exports = { MARKER, buildCommentBody, replaceSummaryComment }
