'use strict';
// Sheet pile catalogue loader. Loaded once on page boot.

window.Catalogue = {
  sections: [],
  steelGrades: [],
  byId: {},
};

async function loadCatalogue() {
  const res = await fetch('/data/sheet-piles.json');
  const data = await res.json();
  Catalogue.sections    = data.sections    || [];
  Catalogue.steelGrades = data.steelGrades || [];
  Catalogue.byId = {};
  for (const s of Catalogue.sections) Catalogue.byId[s.id] = s;
}

async function loadSoilPresets() {
  try {
    const res = await fetch('/data/soil-presets.json');
    const data = await res.json();
    if (typeof window !== 'undefined') window.SOIL_PRESETS = data.presets || [];
  } catch (e) {
    console.warn('Soil presets failed to load:', e);
    if (typeof window !== 'undefined') window.SOIL_PRESETS = [];
  }
}

// Inline summary of pile properties — drives the read-out below the section selector.
function pilePropertiesSummary(sectionId, gradeId, gM0) {
  const sec = getSection(sectionId);
  const gr  = getSteelGrade(gradeId);
  if (!sec || !gr) return null;
  return {
    designation:   sec.designation,
    family:        sec.family,
    width_mm:      sec.width_mm,
    height_mm:     sec.height_mm,
    flange_mm:     sec.thickness_flange_mm,
    web_mm:        sec.thickness_web_mm,
    mass_kg_per_m: sec.mass_kg_per_m,
    mass_kg_per_m2:sec.mass_kg_per_m2,
    A_cm2_per_m:   sec.A_cm2_per_m,
    I_cm4_per_m:   sec.I_cm4_per_m,
    W_el_cm3_per_m:sec.W_el_cm3_per_m,
    coating_m2_per_m: sec.coating_m2_per_m,
    fy_N_per_mm2:  gr.fy,
    M_Rd_kNm_per_m: bendingResistance_kNm_per_m(sectionId, gradeId, gM0 || 1),
    V_Rd_kN_per_m:  shearResistance_kN_per_m(sectionId, gradeId, gM0 || 1),
    EI_kNm2_per_m:  flexuralStiffness_kNm2_per_m(sectionId)
  };
}

function renderPilePropertiesPanel() {
  const host = document.getElementById('pileProperties');
  if (!host) return;
  const grade = AppState.wall.steelGrade || 'S355GP';
  const gM0   = (typeof currentFactors === 'function' ? currentFactors().gM0 : 1) || 1;
  const p     = pilePropertiesSummary(AppState.wall.sectionId, grade, gM0);
  if (!p) {
    host.innerHTML = `<div class="info-box">No section selected.</div>`;
    return;
  }
  const cells = [
    ['Width',         `${p.width_mm} mm`],
    ['Height',        `${p.height_mm} mm`],
    ['Flange / web',  `${p.flange_mm} / ${p.web_mm} mm`],
    ['Mass',          `${p.mass_kg_per_m.toFixed(1)} kg/m &middot; ${p.mass_kg_per_m2.toFixed(0)} kg/m²`],
    ['A',             `${p.A_cm2_per_m.toFixed(0)} cm²/m`],
    ['I',             `${p.I_cm4_per_m.toFixed(0)} cm⁴/m`],
    ['W_el',          `${p.W_el_cm3_per_m.toFixed(0)} cm³/m`],
    ['Coating',       `${p.coating_m2_per_m.toFixed(2)} m²/m`],
    [`f_y (${grade})`,`${p.fy_N_per_mm2} N/mm²`],
    ['M_Rd',          `<strong>${p.M_Rd_kNm_per_m.toFixed(0)} kNm/m</strong>`],
    ['V_Rd',          `${p.V_Rd_kN_per_m.toFixed(0)} kN/m`],
    ['EI',            `${p.EI_kNm2_per_m.toFixed(0)} kNm²/m`]
  ];
  host.innerHTML = `<div class="pile-props-grid">
    ${cells.map(([k, v]) => `<div class="pile-prop"><div class="pile-prop-key">${k}</div><div class="pile-prop-val">${v}</div></div>`).join('')}
  </div>`;
}

function getSection(id) {
  return Catalogue.byId[id] || null;
}

function getSteelGrade(id) {
  return Catalogue.steelGrades.find(g => g.id === id) || Catalogue.steelGrades[0];
}

// Plastic moment of resistance per metre run [kNm/m]
// W_el is in cm3/m, fy in N/mm2  =>  W_el [m3/m] = W_el_cm3 * 1e-6
//                                    fy [kN/m2] = fy_N_per_mm2 * 1e3
//   M_Rd = W_el * fy / γ_M0       (N/mm2 * cm3 = Nm /1e3 = kNm)
function bendingResistance_kNm_per_m(sectionId, gradeId, gM0 = 1.0) {
  const sec = getSection(sectionId);
  const gr  = getSteelGrade(gradeId);
  if (!sec || !gr) return 0;
  return (sec.W_el_cm3_per_m * gr.fy) / 1000 / gM0;   // kNm per m run
}

// Shear area per m  (web area)  [cm2/m]  →  V_Rd = (Av * fy / √3) / γ_M0   [kN/m]
function shearResistance_kN_per_m(sectionId, gradeId, gM0 = 1.0) {
  const sec = getSection(sectionId);
  const gr  = getSteelGrade(gradeId);
  if (!sec || !gr) return 0;
  // Approximate shear area as the web thickness x section height per metre run
  // Av_per_m = (h_mm × t_w_mm × 1000 / b_mm) / 100  →  cm2 per m
  const Av_per_m_cm2 = (sec.height_mm * sec.thickness_web_mm * 1000) / sec.width_mm / 100;
  return (Av_per_m_cm2 * gr.fy / Math.sqrt(3)) / 10 / gM0;   // kN / m
}

// Bending stiffness per m  (kNm² per m)
function flexuralStiffness_kNm2_per_m(sectionId, E_GPa = 210) {
  const sec = getSection(sectionId);
  if (!sec) return 0;
  // I [cm4/m] × E [GPa]
  // EI in kNm²/m  =  (I_cm4 × 1e-8 m4) × (E_GPa × 1e6 kN/m²)
  return sec.I_cm4_per_m * 1e-8 * E_GPa * 1e6;
}
