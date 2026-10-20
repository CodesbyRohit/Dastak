// Strict request-body validation. Unknown fields are rejected so that nothing beyond the
// documented fields (for example a beneficiary name) can be passed through to an AI provider.
'use strict';

const MAX_ROSTER = 50;
const MAX_VISITS = 500;
const MAX_FLAGS_PER_VISIT = 50;

function isShortString(v, max) { return typeof v === 'string' && v.trim().length > 0 && v.length <= max; }
function onlyKeys(obj, allowed) { return Object.keys(obj).every(k => allowed.indexOf(k) !== -1); }

// Returns { ok: true, value } or { ok: false, error }.
function validateRoster(roster) {
  if (!Array.isArray(roster)) return { ok: false, error: 'roster must be an array' };
  if (roster.length > MAX_ROSTER) return { ok: false, error: 'roster may contain at most ' + MAX_ROSTER + ' households' };
  const seen = new Set();
  const value = [];
  for (let i = 0; i < roster.length; i++) {
    const h = roster[i];
    const at = 'roster[' + i + ']';
    if (!h || typeof h !== 'object' || Array.isArray(h)) return { ok: false, error: at + ' must be an object' };
    if (!onlyKeys(h, ['id', 'area', 'protocol', 'dueIn', 'lastFlag'])) return { ok: false, error: at + ' has unexpected fields; allowed: id, area, protocol, dueIn, lastFlag' };
    if (typeof h.id !== 'string' || !/^[A-Za-z0-9-]{1,32}$/.test(h.id)) return { ok: false, error: at + '.id must be an opaque ID (letters, digits, hyphens)' };
    if (seen.has(h.id)) return { ok: false, error: at + '.id is duplicated' };
    seen.add(h.id);
    if (!isShortString(h.area, 40)) return { ok: false, error: at + '.area must be a non-empty string of at most 40 characters' };
    if (h.protocol !== undefined && !isShortString(h.protocol, 60)) return { ok: false, error: at + '.protocol must be a string of at most 60 characters' };
    if (!Number.isInteger(h.dueIn) || h.dueIn < -365 || h.dueIn > 365) return { ok: false, error: at + '.dueIn must be an integer between -365 and 365' };
    if (!(h.lastFlag === undefined || h.lastFlag === null || isShortString(h.lastFlag, 64))) return { ok: false, error: at + '.lastFlag must be null or a string of at most 64 characters' };
    value.push({ id: h.id, area: h.area, protocol: h.protocol || '', dueIn: h.dueIn, lastFlag: h.lastFlag || null });
  }
  return { ok: true, value };
}

function validateVisits(visits) {
  if (!Array.isArray(visits)) return { ok: false, error: 'visits must be an array' };
  if (visits.length > MAX_VISITS) return { ok: false, error: 'visits may contain at most ' + MAX_VISITS + ' entries' };
  const value = [];
  for (let i = 0; i < visits.length; i++) {
    const v = visits[i];
    const at = 'visits[' + i + ']';
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: at + ' must be an object' };
    if (!onlyKeys(v, ['area', 'flags'])) return { ok: false, error: at + ' has unexpected fields; allowed: area, flags' };
    if (v.area !== undefined && !isShortString(v.area, 40)) return { ok: false, error: at + '.area must be a string of at most 40 characters' };
    const flags = v.flags === undefined ? [] : v.flags;
    if (!Array.isArray(flags) || flags.length > MAX_FLAGS_PER_VISIT) return { ok: false, error: at + '.flags must be an array of at most ' + MAX_FLAGS_PER_VISIT };
    const types = [];
    for (let j = 0; j < flags.length; j++) {
      const f = flags[j];
      if (!f || typeof f !== 'object' || Array.isArray(f)) return { ok: false, error: at + '.flags[' + j + '] must be an object' };
      if (!onlyKeys(f, ['type', 'referral'])) return { ok: false, error: at + '.flags[' + j + '] has unexpected fields; allowed: type, referral' };
      if (typeof f.type !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(f.type)) return { ok: false, error: at + '.flags[' + j + '].type must be a step ID' };
      if (f.referral !== undefined && !isShortString(f.referral, 120)) return { ok: false, error: at + '.flags[' + j + '].referral must be a string of at most 120 characters' };
      types.push(f.type); // referral text is accepted for compatibility but never used or forwarded
    }
    value.push({ area: v.area || null, flagTypes: types });
  }
  return { ok: true, value };
}

module.exports = { validateRoster, validateVisits, MAX_ROSTER, MAX_VISITS };
