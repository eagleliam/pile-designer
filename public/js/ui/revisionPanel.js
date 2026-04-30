'use strict';
// ─── Revision Bar & History Panel ────────────────────────────────────────────

// Load a specific revision by IDs and populate the whole form
async function loadRevisionById(designId, revisionId, revisionsListOrNull) {
  try {
    // Fetch revision, design metadata, and (if not provided) revision list — all in parallel
    const [rev, design, revListFetched] = await Promise.all([
      API.getRevision(designId, revisionId),
      API.getDesign(designId),
      revisionsListOrNull ? Promise.resolve(revisionsListOrNull) : API.listRevisions(designId),
    ]);
    const revList = revListFetched;

    AppState.currentDesignId     = designId;
    AppState.currentRevisionId   = revisionId;
    AppState.currentRevisionCode = rev.revision_code;

    // Populate form from the state blob
    populateFormFromState(rev.state);

    // Populate the project info fields from the design row (these live on `designs`, not in state)
    _setProjField('projName',     design.project_name || '');
    _setProjField('projRef',      design.project_ref  || '');
    _setProjField('projClient',   design.client       || '');
    _setProjField('projDesigner', rev.created_by      || '');
    _setProjField('projDate',     (rev.created_at || '').slice(0, 10));
    _setProjField('projRev',      rev.revision_code   || '');
    syncProjectMeta();

    // Update revision bar
    document.getElementById('revisionBar').style.display = '';
    document.getElementById('revBarCode').textContent    = rev.revision_code;

    populateRevisionDropdown(revList, revisionId);
    renderRevisionHistoryTable(revList);

    // Show delete button only if more than one revision
    const delRevBtn = document.getElementById('deleteRevBtn');
    if (delRevBtn) delRevBtn.style.display = revList.length > 1 ? '' : 'none';

    // Mark clean since we just loaded
    markClean();

    // Visual cue: flash project name + show toast
    flashLoadedDesign(rev.revision_code);
    const rs = document.getElementById('resultsSection'); if (rs) rs.style.display = 'none';
  } catch (err) {
    alert('Failed to load revision: ' + err.message);
  }
}

function renderRevisionHistoryTable(revisions) {
  const section = document.getElementById('revisionHistorySection');
  const tbody   = document.getElementById('revHistoryTableBody');
  if (!section || !tbody) return;
  if (!revisions || revisions.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';
  // Show oldest first (P01 at top)
  tbody.innerHTML = revisions.slice().sort((a,b) => a.revision_number - b.revision_number).map(r => {
    const d = new Date(r.created_at);
    const date = isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    return `<tr data-rev-id="${r.id}">
      <td>${escHtml(r.revision_code)}</td>
      <td>${date}</td>
      <td class="rev-cell-by">${escHtml(r.created_by || '—')}</td>
      <td class="rev-cell-desc">${escHtml(r.description || '—')}</td>
      <td class="no-print"><button class="btn-edit-rev" onclick="editRevisionRow(${r.id})">Edit</button></td>
    </tr>`;
  }).join('');
}

function editRevisionRow(revId) {
  const tr = document.querySelector(`#revHistoryTableBody tr[data-rev-id="${revId}"]`);
  if (!tr) return;
  const byCell   = tr.querySelector('.rev-cell-by');
  const descCell = tr.querySelector('.rev-cell-desc');
  const actCell  = tr.querySelector('.no-print');
  const curBy   = byCell.textContent === '—' ? '' : byCell.textContent;
  const curDesc = descCell.textContent === '—' ? '' : descCell.textContent;
  byCell.innerHTML   = `<input class="rev-edit-input" id="revEditBy_${revId}"   value="${escHtml(curBy)}">`;
  descCell.innerHTML = `<input class="rev-edit-input" id="revEditDesc_${revId}" value="${escHtml(curDesc)}">`;
  actCell.innerHTML  = `<button class="btn-edit-rev btn-edit-rev-save" onclick="saveRevisionRow(${revId})">Save</button>
                        <button class="btn-edit-rev" onclick="cancelRevisionRowEdit()">Cancel</button>`;
  byCell.querySelector('input').focus();
}

function cancelRevisionRowEdit() {
  // Easiest: just re-render from cached list
  if (AppState.currentDesignId) API.listRevisions(AppState.currentDesignId).then(renderRevisionHistoryTable);
}

async function saveRevisionRow(revId) {
  const by   = document.getElementById('revEditBy_' + revId)?.value ?? '';
  const desc = document.getElementById('revEditDesc_' + revId)?.value ?? '';
  try {
    await API.saveRevision(AppState.currentDesignId, revId, { createdBy: by, description: desc });
    const revs = await API.listRevisions(AppState.currentDesignId);
    renderRevisionHistoryTable(revs);
    populateRevisionDropdown(revs, AppState.currentRevisionId);
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

function populateRevisionDropdown(revisions, activeRevId) {
  const sel = document.getElementById('revisionSelect');
  if (!sel) return;
  sel.innerHTML = revisions.map(r =>
    `<option value="${r.id}" ${r.id === activeRevId ? 'selected' : ''}>${r.revision_code} — ${escHtml(r.description || 'No description')}</option>`
  ).join('');
}

async function onRevisionSelectChange(revId) {
  if (!revId || !AppState.currentDesignId) return;
  if (AppState.isDirty) {
    if (!confirm('You have unsaved changes. Switch revision without saving?')) return;
  }
  await loadRevisionById(AppState.currentDesignId, parseInt(revId), null);
}

// Save current form state to the current revision AND the project metadata to the design row
async function saveCurrentRevision() {
  if (!AppState.currentRevisionId) return;
  try {
    const state    = collectStateFromForm();
    const designer = document.getElementById('projDesigner')?.value || '';
    const projectMeta = {
      projectName: document.getElementById('projName')?.value   || '',
      projectRef:  document.getElementById('projRef')?.value    || '',
      client:      document.getElementById('projClient')?.value || '',
    };
    await Promise.all([
      API.saveRevision(AppState.currentDesignId, AppState.currentRevisionId, { state, createdBy: designer }),
      API.updateDesign(AppState.currentDesignId, projectMeta),
    ]);
    markClean();
    await loadDesignsList();  // Refresh sidebar (project name + updated_at may have changed)
    // Also refresh the Revision History table so the "By" column reflects the new designer immediately
    if (AppState.currentDesignId) {
      const revs = await API.listRevisions(AppState.currentDesignId);
      renderRevisionHistoryTable(revs);
      populateRevisionDropdown(revs, AppState.currentRevisionId);
    }
  } catch (err) {
    console.error('Auto-save failed:', err);
    const status = document.getElementById('saveStatus');
    if (status) { status.textContent = 'Save failed!'; status.style.color = 'var(--red)'; }
  }
}

// Show modal to create a new revision
function showNewRevisionModal() {
  if (!AppState.currentDesignId) {
    alert('Please load or create a design first.');
    return;
  }
  if (AppState.isDirty) {
    if (!confirm('Save current changes before creating a new revision?')) return;
    saveCurrentRevision();
  }
  const desc = prompt('Describe what changes in this new revision:');
  if (desc === null) return;  // user cancelled
  const designer = document.getElementById('projDesigner')?.value || '';
  createNewRevision(desc, designer);
}

async function createNewRevision(description, createdBy) {
  try {
    const result = await API.createRevision(AppState.currentDesignId, { description, createdBy });
    const revisions = await API.listRevisions(AppState.currentDesignId);
    await loadRevisionById(AppState.currentDesignId, result.revisionId, revisions);
    await loadDesignsList();

    // Update projRev field
    document.getElementById('projRev').value = result.revisionCode;
    syncProjectMeta();
  } catch (err) {
    alert('Failed to create revision: ' + err.message);
  }
}

// History panel
async function showRevisionHistory() {
  if (!AppState.currentDesignId) return;
  try {
    const revisions = await API.listRevisions(AppState.currentDesignId);
    const panel = document.getElementById('historyPanel');
    const list  = document.getElementById('historyList');

    list.innerHTML = revisions.slice().reverse().map(r => {
      const date = new Date(r.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
      const isActive = r.id === AppState.currentRevisionId;
      return `
        <div class="history-entry ${isActive ? 'history-entry-active' : ''}">
          <div class="history-entry-top">
            <span class="history-entry-code">${escHtml(r.revision_code)}</span>
            ${isActive ? '<span class="history-entry-current">CURRENT</span>' : ''}
          </div>
          <div class="history-entry-desc">${escHtml(r.description || 'No description')}</div>
          <div class="history-entry-meta">${escHtml(r.created_by || '—')} &middot; ${date}</div>
          ${!isActive ? `<button class="btn-load-rev" onclick="loadRevisionFromHistory(${r.id})">Load this revision</button>` : ''}
        </div>`;
    }).join('');

    panel.classList.add('open');
  } catch (err) {
    alert('Failed to load history: ' + err.message);
  }
}

async function loadRevisionFromHistory(revId) {
  if (AppState.isDirty) {
    if (!confirm('You have unsaved changes. Switch without saving?')) return;
  }
  closeRevisionHistory();
  await loadRevisionById(AppState.currentDesignId, revId, null);
}

function closeRevisionHistory() {
  document.getElementById('historyPanel').classList.remove('open');
}

function _setProjField(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function flashLoadedDesign(revCode) {
  const name = document.getElementById('projName')?.value || 'Design';
  // Toast
  let toast = document.getElementById('loadToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'loadToast';
    toast.className = 'load-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<strong>Loaded:</strong> ${escHtml(name)} <span class="load-toast-rev">${escHtml(revCode || '')}</span>`;
  toast.classList.remove('show');
  // Force reflow so re-adding .show retriggers animation
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(flashLoadedDesign._t);
  flashLoadedDesign._t = setTimeout(() => toast.classList.remove('show'), 2200);

  // Flash the project name input
  const projInput = document.getElementById('projName');
  if (projInput) {
    projInput.classList.remove('field-flash');
    void projInput.offsetWidth;
    projInput.classList.add('field-flash');
  }
}

async function deleteCurrentRevision() {
  if (!AppState.currentRevisionId) return;
  if (!confirm('Delete this revision? This cannot be undone.')) return;
  try {
    await API.deleteRevision(AppState.currentDesignId, AppState.currentRevisionId);
    const revisions = await API.listRevisions(AppState.currentDesignId);
    const latest = revisions[revisions.length - 1];
    await loadRevisionById(AppState.currentDesignId, latest.id, revisions);
    await loadDesignsList();
  } catch (err) {
    alert('Failed to delete revision: ' + err.message);
  }
}
