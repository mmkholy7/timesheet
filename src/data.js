import { sb } from './supabase.js'
import { toast, setSyncStatus } from './ui.js'

export let allSheets = {}
let currentUserId = null
let saveTimer = null

export function setUser(userId) {
  currentUserId = userId
}

export function newRow() {
  return { rate: 'Regular - Hourly', proj: '', hours: [0, 0, 0, 0, 0, 0, 0] }
}

export function getLocalSheet(wk) {
  if (!allSheets[wk]) {
    allSheets[wk] = { status: 'Draft', rows: [newRow()], _dirty: false }
  }
  return allSheets[wk]
}

export async function loadAllSheets() {
  const { data, error } = await sb
    .from('timesheets')
    .select('*')
    .eq('user_id', currentUserId)

  if (error) { toast('Error loading data: ' + error.message); return }

  allSheets = {}
  ;(data || []).forEach(row => {
    allSheets[row.week_start] = {
      id: row.id,
      status: row.status,
      rows: row.rows?.length ? row.rows : [newRow()],
      _dirty: false
    }
  })
}

export async function saveSheet(wk) {
  const sheet = allSheets[wk]
  if (!sheet) return

  setSyncStatus('saving', 'Saving…')

  const payload = {
    user_id: currentUserId,
    week_start: wk,
    status: sheet.status,
    rows: sheet.rows,
    updated_at: new Date().toISOString()
  }

  const result = sheet.id
    ? await sb.from('timesheets').update(payload).eq('id', sheet.id).select().single()
    : await sb.from('timesheets').insert(payload).select().single()

  if (result.error) {
    setSyncStatus('error', 'Save failed')
    toast('Save error: ' + result.error.message)
    return
  }

  sheet.id = result.data.id
  sheet._dirty = false
  setSyncStatus('saved', 'Saved ✓')
  setTimeout(() => setSyncStatus('', ''), 2000)
}

export function scheduleSave(wk) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveSheet(wk), 900)
}

export function clearSheets() {
  allSheets = {}
  currentUserId = null
}
