/**
 * "Which country are you in?" (2026-10-29).
 *
 * One quiet question per account, asked in the module and on the storefront.
 * The answer goes onto the cloud account, so the download infrastructure can be
 * judged per country and the admin can filter users by country. The download
 * measurement itself detects the country from the IP; the answer corrects VPN
 * users and stays put while someone plays on a trip.
 *
 * The server decides whether to ask (foundry-manager.php?country_prompt=1): no
 * country chosen yet, not dismissed, and this world was connected to the
 * account at least a week ago, because the first days with the module are busy
 * enough. Closing the window with X pauses the question for a week in this
 * browser; only Save or "Don't ask again" end it. Every failure is silent,
 * like the What's New window this follows.
 */

import { BeneosUtility } from "../beneos_utility.js"

const FETCH_TIMEOUT_MS = 8000
const LATER_KEY = "beneos-country-prompt-later-until"
const LATER_MS = 7 * 24 * 60 * 60 * 1000

// Same list as beneos_country_codes() in beneos-cloud-server/lib/geo.php. The
// server rejects anything else, so a code missing here can only never be
// offered, never be stored wrongly.
const COUNTRY_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS",
  "BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN",
  "CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE",
  "EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF",
  "GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM",
  "HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM",
  "JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC",
  "LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK",
  "ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA",
  "NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG",
  "PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS",
  "ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO",
  "TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI",
  "VN","VU","WF","WS","YE","YT","ZA","ZM","ZW"
]

// X is "not now", not "never": a week of quiet in this browser. localStorage
// and not a world setting, because the question belongs to the person.
function snoozed() {
  try { return Number(globalThis.localStorage?.getItem(LATER_KEY) || 0) > Date.now() }
  catch (_e) { return false }
}

function snooze() {
  try { globalThis.localStorage?.setItem(LATER_KEY, String(Date.now() + LATER_MS)) }
  catch (_e) { /* storage blocked: the question simply comes back next load */ }
}

function storedFoundryId() {
  let id = ""
  try { id = game.settings.get(BeneosUtility.moduleID(), "beneos-cloud-foundry-id") || "" }
  catch (_e) { id = "" }
  return (!id || id === "anonymous") ? "" : id
}

function isOffline() {
  if (!!globalThis.navigator && globalThis.navigator.onLine === false) return true
  return game.beneos?.cloud?.serverOffline === true
}

// The login round trip is still in flight when the ready hook runs; same
// bounded wait as BeneosWhatsNewWindow.
async function waitForCloudLogin(timeoutMs = 15000, stepMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (game.beneos?.cloud?.isLoggedIn?.()) return true
    if (isOffline()) return false
    await new Promise(resolve => setTimeout(resolve, stepMs))
  }
  return false
}

function endpoint(id) {
  return `${BeneosUtility.cloudBase()}/foundry-manager.php?foundryId=${encodeURIComponent(id)}&country_prompt=1`
}

async function request(id, body = null) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const init = { cache: "no-cache", signal: controller.signal, credentials: "omit" }
    if (body) {
      init.method = "POST"
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" }
      init.body = new URLSearchParams(body)
    }
    const response = await fetch(endpoint(id), init)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (String(data?.result).toUpperCase() !== "OK") throw new Error(data?.information || "not OK")
    return data.data ?? {}
  } finally {
    clearTimeout(timer)
  }
}

/** Country options in the UI language, sorted by their visible name. */
export function countryOptions(lang) {
  let names = null
  try { names = new Intl.DisplayNames([lang, "en"], { type: "region" }) } catch (_e) { names = null }
  const label = (cc) => {
    try { return names?.of(cc) || cc } catch (_e) { return cc }
  }
  return COUNTRY_CODES
    .map(code => ({ code, name: label(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang))
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]))
}

async function ask(suggested) {
  const DialogV2 = foundry.applications?.api?.DialogV2
  if (!DialogV2?.wait) return null
  const t = (k) => game.i18n.localize(`BENEOS.CountryPrompt.${k}`)
  const options = countryOptions(game.i18n.lang)
    .map(o => `<option value="${o.code}"${o.code === suggested ? " selected" : ""}>${escapeHtml(o.name)}</option>`)
    .join("")
  const placeholder = suggested ? "" : `<option value="" selected disabled>${escapeHtml(t("Choose"))}</option>`
  const content = `
    <p class="beneos-country-prompt-text">${escapeHtml(t("Body"))}</p>
    <select name="beneos-country" aria-label="${escapeHtml(t("Label"))}">${placeholder}${options}</select>`
  const readCountry = (dialog) => dialog?.element?.querySelector?.('select[name="beneos-country"]')?.value || ""
  return DialogV2.wait({
    window: { title: t("Title") },
    classes: ["beneos-cloud-app", "beneos-confirm", "beneos-country-prompt"],
    content,
    buttons: [
      { action: "save", label: t("Save"), default: true, callback: (event, button, dialog) => ({ action: "set", country: readCountry(dialog) }) },
      { action: "never", label: t("DontAskAgain"), callback: () => ({ action: "dismiss" }) }
    ],
    rejectClose: false,
    modal: false,
    close: () => null
  })
}

/**
 * Ask if the server says so. Returns true when the window was shown, so the
 * startup chain in beneos_tours.js keeps its one-window-per-load rule.
 */
export async function presentCountryPrompt() {
  try {
    if (!game.user?.isGM) return false
    if (snoozed() || isOffline()) return false
    const id = storedFoundryId()
    if (!id) return false
    if (!(await waitForCloudLogin())) return false
    const state = await request(id)
    if (state?.ask !== true) return false

    // Only a code from the list may be preselected: an unknown one would leave
    // no option selected, the browser would show the first country, and Save
    // would store it.
    const suggested = COUNTRY_CODES.includes(state.suggested) ? state.suggested : ""
    const answer = await ask(suggested)
    // X or Esc: nothing stored on the account, a week of quiet here.
    if (!answer || (answer.action === "set" && !answer.country)) {
      snooze()
      return true
    }
    await request(id, answer.action === "set" ? { action: "set", country: answer.country } : { action: "dismiss" })
    return true
  } catch (err) {
    console.debug("[Beneos Country] not shown:", err?.message ?? err)
    return false
  }
}
