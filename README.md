# Pile Designer

A 2D embedded sheet pile retaining wall designer for Ward & Burke. Built as a single-page web app with persistent project storage, mirroring the architecture of the [Working Platform Designer](https://github.com/eagleliam/working-platform-designer).

## What it does

- **Wall types**: cantilever, single-prop / single-anchor (free earth support), multi-prop (Terzaghi-Peck apparent earth pressure envelope)
- **Earth pressures**: drained (Coulomb Ka/Kp with wall friction δ) and undrained (2cu method) — switchable per soil layer so a stratigraphy can mix
- **Water**: independent active/passive water tables, hydrostatic or steady-state seepage modes
- **Surcharges**: uniform surcharge at top of wall + Boussinesq strip / line loads, permanent or variable load type
- **EC7 verification**: Design Approach 1 — Combination 1 + Combination 2 + SLS, with editable partial factor table (γφ, γc', γcu, γG, γQ, γRe, γM0). Traditional global FoS mode also available.
- **Diagram views**: outline, gross pressures, net pressure, factored pressure, bending moment, shear force, deflection, rotational stability — switchable on the SVG cross-section
- **Section catalogue**: ~70 ArcelorMittal sections (AZ, GU, AU, PU, AS500, LX) with auto-pick by required moment of resistance
- **Rotational stability**: Bishop simplified circular slip with grid + radius search; optional wall-shear contribution
- **Persistence**: project-and-revision history in SQLite; auto-saves every 3 s when a revision is loaded
- **Output**: Print to PDF with cover page, project metadata, design results

## Stack

- **Backend**: Node 24 + Express + `node:sqlite` (built-in, no native compilation)
- **Frontend**: plain JavaScript ES modules + SVG (no framework)
- **Deploy**: Dockerfile → Railway with persistent volume for the SQLite database

## Local development

```bash
npm install
npm run dev      # auto-reload on file changes
```

Opens at http://localhost:3000. The SQLite DB lives at `./data/pile-designer.db` (gitignored).

## Railway deployment

1. Push this repo to GitHub.
2. In the Railway dashboard, **New Project → Deploy from GitHub repo**, select `eagleliam/pile-designer`.
3. Add a **Volume** to the service (mount path: `/data`).
4. In **Variables**, set `RAILWAY_VOLUME_MOUNT_PATH=/data`.
5. Deploy. The Dockerfile takes care of the rest.

The SQLite file (`pile-designer.db`) lives on the persistent volume, so saved designs survive deploys.

## Project structure

```
pile-designer/
├── server.js                    Express bootstrap, mounts /api routes, serves /public
├── db/                          node:sqlite + auto-migrations
├── routes/
│   ├── designs.js               CRUD for design metadata + auto-create P01 revision
│   └── revisions.js             CRUD for revisions + state blob
└── public/
    ├── index.html               Sidebar + header + sectioned page + cover page
    ├── data/sheet-piles.json    Sheet pile catalogue
    ├── css/app.css              Brand styling + pile-specific extensions
    └── js/
        ├── api.js               Fetch wrapper
        ├── state.js             AppState + dirty/auto-save tracking
        ├── catalogue.js         Sheet pile loader + W/I/M_Rd helpers
        ├── factors.js           EC7 partial factor table + presets
        ├── soils.js             Active/passive layer + surcharge + prop UIs
        ├── pressures.js         Coulomb/Rankine, drained + undrained σ profiles, Boussinesq strip
        ├── solver.js            Limit-equilibrium for cantilever / single-prop / multi-prop
        ├── stability.js         Bishop simplified rotational stability search
        ├── diagram.js           SVG cross-section + view switcher
        ├── results.js           Run Design Check + results panel renderer
        └── ui/
            ├── designPanel.js, revisionPanel.js   Sidebar + revision UI
            └── sectionPicker.js                   Sheet pile catalogue modal
```

## References

- EN 1997-1 Eurocode 7: Geotechnical Design — General Rules
- CIRIA C760 *Guidance on Embedded Retaining Wall Design* (2017)
- ArcelorMittal *General Catalogue — Steel Sheet Piling*
- Bishop, A.W. (1955) *The use of the slip circle in the stability analysis of slopes*

## Status

v1 — covers the most common UK/IE design cases. Out of scope for now: subgrade reaction (Winkler springs) solver, HZ/HZM combined walls, seismic / pseudo-static analysis, non-circular slip surfaces.
