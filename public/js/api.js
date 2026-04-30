'use strict';
// ─── API client ───────────────────────────────────────────────────────────────
// All fetch() wrappers. Throws on non-OK responses so callers can catch.

async function _req(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

const API = {
  // ── Designs ─────────────────────────────────────────────────────────────
  listDesigns:  ()           => _req('/api/designs'),
  createDesign: (body)       => _req('/api/designs', 'POST', body),
  getDesign:    (id)         => _req(`/api/designs/${id}`),
  updateDesign: (id, body)   => _req(`/api/designs/${id}`, 'PATCH', body),
  deleteDesign: (id)         => _req(`/api/designs/${id}`, 'DELETE'),

  // ── Revisions ────────────────────────────────────────────────────────────
  listRevisions:  (dId)          => _req(`/api/designs/${dId}/revisions`),
  getRevision:    (dId, rId)     => _req(`/api/designs/${dId}/revisions/${rId}`),
  createRevision: (dId, body)    => _req(`/api/designs/${dId}/revisions`, 'POST', body),
  saveRevision:   (dId, rId, body) => _req(`/api/designs/${dId}/revisions/${rId}`, 'PATCH', body),
  deleteRevision: (dId, rId)     => _req(`/api/designs/${dId}/revisions/${rId}`, 'DELETE'),
};
