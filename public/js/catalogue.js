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
