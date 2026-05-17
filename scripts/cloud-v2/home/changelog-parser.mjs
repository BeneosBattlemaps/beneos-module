/* Pure parser for the Beneos module CHANGELOG.md.
   Returns the most recent `limit` version blocks as structured objects so the
   Patchlog window can render them without re-parsing markdown at view time. */

const HEADER_RE = /^###\s+([0-9]+\.[0-9]+\.[0-9]+)\s+#\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s*$/
const BULLET_RE = /^-\s+(New|Improved|Fixed|Added|Updated|Changed):\s*(.+)$/i

const TYPE_NORMALIZE = {
  new: "new",
  added: "new",
  improved: "improved",
  updated: "improved",
  changed: "improved",
  fixed: "fixed"
}

function stripBold(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1")
}

function extractTitle(rawText) {
  const stripped = rawText.trim()
  const boldMatch = stripped.match(/^\*\*(.+?)\*\*\s*\.?\s*(.*)$/)
  if (boldMatch) {
    return { title: boldMatch[1].trim().replace(/\.$/, ""), body: stripBold(boldMatch[2]).trim() }
  }
  return { title: "", body: stripBold(stripped) }
}

export function parseChangelog(markdown, limit = 2) {
  if (!markdown || typeof markdown !== "string") return []
  const lines = markdown.split(/\r?\n/)
  const versions = []
  let current = null

  for (const line of lines) {
    const headerMatch = line.match(HEADER_RE)
    if (headerMatch) {
      if (current) versions.push(current)
      if (versions.length >= limit) {
        current = null
        break
      }
      current = {
        version: headerMatch[1],
        date: headerMatch[2],
        entries: { new: [], improved: [], fixed: [] }
      }
      continue
    }
    if (!current) continue

    const bulletMatch = line.match(BULLET_RE)
    if (bulletMatch) {
      const rawType = bulletMatch[1].toLowerCase()
      const type = TYPE_NORMALIZE[rawType] || "improved"
      const { title, body } = extractTitle(bulletMatch[2])
      current.entries[type].push({ title, body })
    }
  }

  if (current && versions.length < limit) versions.push(current)
  return versions
}

export async function loadAndParseChangelog(limit = 2) {
  try {
    const response = await fetch("modules/beneos-module/changelog.md", { cache: "no-cache" })
    if (!response.ok) return []
    const markdown = await response.text()
    return parseChangelog(markdown, limit)
  } catch (err) {
    console.warn("[Beneos] Failed to load changelog.md:", err)
    return []
  }
}
