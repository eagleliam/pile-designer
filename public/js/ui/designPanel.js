'use strict';
// Sidebar designs list.

let _allDesigns = [];

async function loadDesignsList() {
  try {
    _allDesigns = await API.listDesigns();
    renderDesignsList(_allDesigns);
  } catch (err) {
    console.error('Failed to load designs:', err);
  }
}

function renderDesignsList(designs) {
  const el = document.getElementById('designsList');
  if (!el) return;
  if (designs.length === 0) {
    el.innerHTML = `<div class="sidebar-empty">No saved designs yet.<br>Click <strong>+ New Design</strong> below.</div>`;
    return;
  }
  el.innerHTML = designs.map(d => {
    const active = d.id === AppState.currentDesignId ? 'active' : '';
    const date = d.updated_at ? new Date(d.updated_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '';
    return `
      <div class="design-card ${active}" onclick="selectDesign(${d.id})" data-id="${d.id}">
        <div class="design-card-top">
          <span class="design-card-name">${escHtml(d.project_name)}</span>
          <span class="revision-badge">${d.latest_revision || 'P01'}</span>
        </div>
        <div class="design-card-ref">${escHtml(d.project_ref || '—')}</div>
        <div class="design-card-meta">${escHtml(d.client || '')} &middot; ${date} &middot; ${d.revision_count} rev${d.revision_count !== 1 ? 's' : ''}</div>
      </div>`;
  }).join('');
}

function filterDesigns(query) {
  const q = query.toLowerCase();
  const filtered = q
    ? _allDesigns.filter(d =>
        d.project_name.toLowerCase().includes(q) ||
        (d.project_ref || '').toLowerCase().includes(q) ||
        (d.client || '').toLowerCase().includes(q))
    : _allDesigns;
  renderDesignsList(filtered);
}

async function selectDesign(designId) {
  try {
    document.querySelectorAll('.design-card').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.id) === designId);
    });
    const revisions = await API.listRevisions(designId);
    if (!revisions.length) return;
    const latest = revisions[revisions.length - 1];
    await loadRevisionById(designId, latest.id, revisions);
  } catch (err) {
    alert('Failed to load design: ' + err.message);
  }
}

function showNewDesignModal() {
  const name    = prompt('Project Name:');
  if (!name) return;
  const ref     = prompt('Reference Number:')  || '';
  const client  = prompt('Client:')            || '';
  const designer = prompt('Designer:')         || '';
  createNewDesign(name, ref, client, designer);
}

async function createNewDesign(projectName, projectRef, client, createdBy) {
  try {
    const result = await API.createDesign({ projectName, projectRef, client, createdBy });
    await loadRevisionById(result.designId, result.revisionId, null);
    await loadDesignsList();
    setVal('projName',     projectName);
    setVal('projRef',      projectRef);
    setVal('projClient',   client);
    setVal('projDesigner', createdBy);
    setVal('projDate',     new Date().toISOString().split('T')[0]);
    setVal('projRev',      'P01');
    syncProjectMeta();
  } catch (err) {
    alert('Failed to create design: ' + err.message);
  }
}

async function deleteCurrentDesign() {
  if (!AppState.currentDesignId) return;
  const design = _allDesigns.find(d => d.id === AppState.currentDesignId);
  if (!confirm(`Delete "${design?.project_name || 'this design'}" and all its revisions? This cannot be undone.`)) return;
  try {
    await API.deleteDesign(AppState.currentDesignId);
    AppState.currentDesignId = null;
    AppState.currentRevisionId = null;
    AppState.currentRevisionCode = null;
    document.getElementById('revisionBar').style.display = 'none';
    await loadDesignsList();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('designsSidebar');
  const main    = document.getElementById('mainWrapper');
  const btn     = document.getElementById('sidebarCollapseBtn');
  sidebar.classList.toggle('collapsed');
  main.classList.toggle('sidebar-collapsed');
  btn.textContent = sidebar.classList.contains('collapsed') ? '›' : '‹';
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
