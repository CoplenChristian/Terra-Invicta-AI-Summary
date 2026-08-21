/*
 * Fleet Procurement & Refit Advisor Panel
 * ---------------------------------------
 * Purpose: renders the FLEET view procurement recommendations and validated refit advisor
 * from /api/intel/research-ranking and /api/intel/refit-advisor (fleet-procurement-spec.md).
 *
 * Follows the three rendering rules:
 * 1. Nothing is interpolated raw (absent stays null, rendered as em dash).
 * 2. Only strings this file authors reach the DOM (upstream reasons stay in tooltips).
 * 3. Truncation must announce itself (all items shown, or itemsOmittedCount reported).
 */
(function exposeFleetProcurement(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? ''));

  const UNAVAILABLE = '—';

  const DESIGN_ROLES = Object.freeze({
    warship: 'warship',
    transport: 'transport',
    unknown: 'unknown'
  });

  const RULE_SCALAR_KIND = 'rule-scalar';
  const RULE_SCALAR_TITLE = 'This module family has no engineering axis: the game gives each module one '
    + 'shared rule value and names no unit for it. The ratio is only formed against a module carrying the '
    + 'identical rule set. Ordered after every row whose axis has a unit.';

  const DELIVERY_FAILS_TITLE = 'Ranked below its damage. Each round that arrives has to survive '
    + 'measurably more point-defence fire than the best interceptable weapon you already field — usually '
    + 'because it is fired one round at a time while yours arrive in a salvo that splits the same '
    + 'defensive fire. Damage still leads the ordering; this decides whether the damage lands.';
  const DELIVERY_UNKNOWN_TITLE = 'Delivery could not be checked for this one. Either no point-defence '
    + 'battery is observable in this snapshot, you field nothing comparable to measure it against, or '
    + 'the templates do not describe its flight. This is not a pass — it is an unmeasured axis, and it '
    + 'does not move the row up or down.';

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function int(value) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    return Math.round(parsed).toLocaleString('en-US');
  }

  function dec(value, places = 1) {
    const parsed = num(value);
    return parsed === null ? UNAVAILABLE : parsed.toFixed(places);
  }

  function mult(value) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    const abs = Math.abs(parsed);
    if (abs >= 1e9) return `${(parsed / 1e9).toFixed(1)}B×`;
    if (abs >= 1e6) return `${(parsed / 1e6).toFixed(1)}M×`;
    if (abs >= 1000) return `${Math.round(parsed).toLocaleString('en-US')}×`;
    if (abs >= 10) return `${parsed.toFixed(1)}×`;
    return `${parsed.toFixed(2)}×`;
  }

  function attr(value) {
    return escapeHtml(value === null || value === undefined ? '' : String(value));
  }

  function formatProcurementName(row) {
    const item = row.displayName ? String(row.displayName).trim() : 'unnamed candidate';
    const project = row.gateProjectName ? String(row.gateProjectName).trim() : null;

    return {
      lead: item,
      sub: null,
      tooltip: project ? `${item} — unlocked by ${project} (completed)` : item
    };
  }

  function renderProcurementRow(row) {
    const notes = [];
    if (row.closesDeficit === true) notes.push('<span class="ra-tag ra-tag--deficit">closes gap</span>');
    if (row.clearsFloor === false) notes.push('<span class="ra-tag ra-tag--warn">fails floor</span>');
    if (row.clearsDeliveryFloor === false) {
      notes.push(`<span class="ra-tag ra-tag--warn" title="${attr(DELIVERY_FAILS_TITLE)}">fails delivery</span>`);
    } else if (row.clearsDeliveryFloor === null && row.context && row.context.delivery) {
      notes.push(`<span class="ra-tag" title="${attr(DELIVERY_UNKNOWN_TITLE)}">delivery unchecked</span>`);
    }
    if (row.axisKind === RULE_SCALAR_KIND) {
      notes.push(`<span class="ra-tag ra-tag--unitless" title="${attr(RULE_SCALAR_TITLE)}">no unit</span>`);
    }
    const duration = num(row.context && row.context.sustainedOutputDurationS);
    if (duration !== null) notes.push(`<span class="ra-tag">${attr(`${dec(duration, 0)}s of fire`)}</span>`);

    const action = row.action || ((row.context?.family === 'ship_hull' || row.classKey === 'ship_hull') ? 'build' : 'refit');
    const meta = [action];

    const axisTitle = row.axisBasis || row.axisLabel || '';
    const nameInfo = formatProcurementName(row);

    return `
      <li class="ra-row fp-row">
        <div class="ra-row__head">
          <span class="ra-row__name fp-row__name" title="${attr(nameInfo.tooltip)}">${escapeHtml(nameInfo.lead)}</span>
          <span class="ra-row__metric fp-row__metric" title="${attr(axisTitle)}">${attr(mult(row.improvementMultiple))} ${escapeHtml(row.axisLabel || 'unnamed axis')}</span>
        </div>
        <div class="ra-row__meta fp-row__meta">${escapeHtml(meta.join(' · '))}${notes.length ? ` ${notes.join(' ')}` : ''}</div>
      </li>
    `;
  }

  function openProcurementDetails(payload) {
    const panel = global.MissionControlDetailPanel;
    if (!panel || typeof panel.open !== 'function') return;

    const facts = [];
    const items = (payload?.military?.procurement?.items) || [];
    for (const row of items) {
      const delivery = (row.context && row.context.delivery) || null;
      const deliveryText = delivery
        ? ` · ${dec(delivery.shotsPerArrivingRound, 1)} PD shots per arriving round`
          + (num(delivery.flightTimeS) === null ? '' : `, ${dec(delivery.flightTimeS, 0)}s flight`)
          + (num(delivery.terminalSpeedKps) === null ? '' : ` at ${dec(delivery.terminalSpeedKps, 1)} km/s`)
        : '';
      const action = row.action || ((row.context?.family === 'ship_hull' || row.classKey === 'ship_hull') ? 'build' : 'refit');
      const projectTooltip = row.gateProjectName ? ` · unlocked by ${row.gateProjectName}` : '';
      facts.push({
        label: `PROCUREMENT · Already unlocked · ${row.displayName || 'unnamed candidate'}`,
        value: `${mult(row.improvementMultiple)} ${row.axisLabel || 'unnamed axis'} · ${action}${projectTooltip}`
          + (row.closesDeficit ? ' · closes the measured gap' : '')
          + (row.clearsFloor === false ? ' · fails its floor' : '')
          + deliveryText
          + (row.clearsDeliveryFloor === false ? ' · fails its delivery floor' : '')
          + (row.clearsDeliveryFloor === null && delivery ? ' · delivery floor could not be evaluated' : '')
      });
    }

    if (facts.length === 0) {
      facts.push({
        label: 'No unfielded procurement items',
        value: 'All unlocked military technologies in this save are currently in service or have no measured upgrade candidate.'
      });
    }

    panel.open({
      eyebrow: 'FLEET PROCUREMENT',
      title: 'Already Unlocked, Not in Service',
      summary: 'Procurement decisions ready for immediate shipyard order or ship refit. '
        + 'These components cost zero additional research points and are fittable immediately. '
        + 'Ranked internally by improvement multiple over what you currently field.',
      facts,
      actions: [{ label: 'Close' }]
    });
  }

  function openRefitDetails(designRow) {
    const panel = global.MissionControlDetailPanel;
    if (!panel || typeof panel.open !== 'function' || !designRow) return;

    const facts = [];
    const base = designRow.baseline || {};
    const rec = designRow.recommendations || {};
    const budgets = designRow.budgets || {};

    facts.push({
      label: 'INFERRED ROLE',
      value: `${String(designRow.role).toUpperCase()} · ${designRow.roleBasis || 'Structural inference'}`
    });

    facts.push({
      label: 'BASELINE FITTING',
      value: `Drive: ${base.drive?.displayName || base.drive?.driveId || UNAVAILABLE} · ΔV: ${dec(base.deltaVKps, 1)} km/s · Combat Accel: ${dec(base.combatAccelerationMps2, 3)} m/s²`
    });

    const fittedDriveId = base.drive?.driveId;
    const recDriveId = rec.drive?.candidateDriveId || rec.drive?.driveId;

    if (rec.drive && rec.drive.clearsFloor === true && recDriveId !== fittedDriveId) {
      facts.push({
        label: 'DRIVE SWAP (ASSUMES CURRENT WEAPONS & ARMOUR)',
        value: `→ ${rec.drive.displayName || recDriveId}: ΔV ${dec(base.deltaVKps, 1)} → ${dec(rec.drive.deltaVKps, 1)} km/s, Combat Accel ${dec(base.combatAccelerationMps2, 3)} → ${dec(rec.drive.combatAccelerationMps2, 3)} m/s²`
          + (rec.drive.dryMassCaveat ? ` (${rec.drive.dryMassCaveat})` : '')
      });
    } else if (rec.drive && rec.drive.clearsFloor === true && recDriveId === fittedDriveId) {
      facts.push({
        label: 'DRIVE SWAP',
        value: `Best available drive already fitted (${base.drive?.displayName || fittedDriveId || 'fitted drive'}).`
      });
    } else if (rec.drive && rec.drive.clearsFloor === false) {
      facts.push({
        label: 'DRIVE SWAP',
        value: `No available drive improves this design without unacceptable ΔV loss. Rejected alternative: ${rec.drive.displayName || recDriveId} (fails floor · ${rec.drive.floorReason || 'fails reach floor'})`
      });
    } else if (rec.drive && rec.drive.clearsFloor === null) {
      facts.push({
        label: 'DRIVE SWAP',
        value: 'Drive refit reach floor unknown; baseline ship metrics are unmeasured in this snapshot.'
      });
    } else {
      facts.push({
        label: 'DRIVE SWAP',
        value: 'No unlocked drive candidate improves on the fitted drive under the role metric without failing the reach floor.'
      });
    }

    if (rec.weapons && rec.weapons.length > 0) {
      for (const w of rec.weapons) {
        facts.push({
          label: `WEAPON UPGRADE · ${String(w.slot).toUpperCase()} HARDPOINT`,
          value: `${w.rationale} (Performance impact unknown due to unpinned mass model)`
        });
      }
    } else {
      facts.push({
        label: 'WEAPON UPGRADES',
        value: 'Fitted weapons match or exceed all available researchable/ungated options within hardpoint capacity.'
      });
    }

    if (rec.armor) {
      facts.push({
        label: 'ARMOUR RECOMMENDATION',
        value: `Recommended Material: ${rec.armor.recommendedMaterial || UNAVAILABLE} · ${rec.armor.threatBasis} (Performance impact unknown)`
      });
    }

    if (budgets.power) {
      facts.push({
        label: 'POWER BUDGET (INFORMATIONAL)',
        value: budgets.power.summary || 'Power evaluated'
      });
    }

    facts.push({
      label: 'NON-COMPOSABILITY NOTICE',
      value: 'Drive performance numbers hold dry mass constant. Combining a drive swap with weapon or armour modifications changes ship dry mass, making combined performance uncomputable.'
    });

    panel.open({
      eyebrow: 'VALIDATED REFIT ADVISOR',
      title: `${designRow.displayName || designRow.designId} Refit Specification`,
      summary: `Refit analysis for ${designRow.displayName || designRow.designId} (${designRow.hull || 'Standard Hull'}). Holds hull geometry and evaluates drive, weapons, and armour against observed fleet data.`,
      facts,
      actions: [{ label: 'Close' }]
    });
  }

  function renderRefitDesignCard(design) {
    const base = design.baseline || {};
    const rec = design.recommendations || {};
    const roleBadge = design.role === DESIGN_ROLES.warship
      ? '<span class="ra-tag ra-tag--deficit">WARSHIP</span>'
      : (design.role === DESIGN_ROLES.transport ? '<span class="ra-tag ra-tag--free">TRANSPORT</span>' : '<span class="ra-tag">UNKNOWN ROLE</span>');

    const driveRec = rec.drive;
    const fittedDriveId = base.drive?.driveId;
    const recDriveId = driveRec?.candidateDriveId || driveRec?.driveId;

    let driveText = '';
    if (driveRec && driveRec.clearsFloor === true && recDriveId !== fittedDriveId) {
      driveText = `
        <div class="fp-refit__drive">
          <span class="fp-refit__label">Drive Refit:</span>
          <strong>${escapeHtml(driveRec.displayName || recDriveId)}</strong>
          <span class="fp-refit__perf">ΔV: ${dec(base.deltaVKps, 1)} → ${dec(driveRec.deltaVKps, 1)} km/s · Accel: ${dec(base.combatAccelerationMps2, 2)} → ${dec(driveRec.combatAccelerationMps2, 2)} m/s²</span>
          ${driveRec.dryMassCaveat ? `<small class="fp-refit__caveat" title="${attr(driveRec.dryMassCaveat)}">constant-dry-mass caveat</small>` : ''}
        </div>
      `;
    } else if (driveRec && driveRec.clearsFloor === true && recDriveId === fittedDriveId) {
      driveText = `
        <div class="fp-refit__drive fp-refit__drive--none">
          <span class="fp-refit__label">Drive:</span>
          <span>Best available drive already fitted (${escapeHtml(base.drive?.displayName || fittedDriveId || 'fitted drive')}).</span>
        </div>
      `;
    } else if (driveRec && driveRec.clearsFloor === false) {
      driveText = `
        <div class="fp-refit__drive fp-refit__drive--warn">
          <span class="fp-refit__label">Drive:</span>
          <span>No available drive improves this design without unacceptable ΔV loss.</span>
          <div class="fp-refit__rejected">
            <span class="ra-tag ra-tag--warn">fails floor</span>
            <span class="fp-refit__rejected-name">${escapeHtml(driveRec.displayName || recDriveId)}</span>
            <small class="fp-refit__rejected-reason">${escapeHtml(driveRec.floorReason || 'fails reach floor')}</small>
          </div>
        </div>
      `;
    } else if (driveRec && driveRec.clearsFloor === null) {
      driveText = `
        <div class="fp-refit__drive fp-refit__drive--unknown">
          <span class="fp-refit__label">Drive:</span>
          <span>Drive refit reach floor unknown (baseline metrics unmeasured)</span>
        </div>
      `;
    } else {
      driveText = `
        <div class="fp-refit__drive fp-refit__drive--none">
          <span class="fp-refit__label">Drive:</span>
          <span>Fitted ${escapeHtml(base.drive?.displayName || 'drive')} optimal under current role</span>
        </div>
      `;
    }

    const weaponCount = (rec.weapons || []).length;
    const weaponText = weaponCount > 0
      ? `<div class="fp-refit__weapon">
          <span class="fp-refit__label">Weapons:</span>
          <span>${escapeHtml(`${int(weaponCount)} hardpoint upgrade(s) fittable`)}</span>
          <small class="fp-refit__impact" title="Weapon mass change makes ΔV impact unknown">perf impact unknown</small>
        </div>`
      : `<div class="fp-refit__weapon">
          <span class="fp-refit__label">Weapons:</span>
          <span>Current armament optimal</span>
        </div>`;

    const armorRec = rec.armor;
    const armorText = armorRec && armorRec.recommendedMaterial
      ? `<div class="fp-refit__armor">
          <span class="fp-refit__label">Armour:</span>
          <span>${escapeHtml(armorRec.recommendedMaterial)}</span>
          <small class="fp-refit__threat" title="${attr(armorRec.threatBasis)}">${escapeHtml(armorRec.weighted ? 'threat-weighted' : 'unweighted')}</small>
        </div>`
      : '';

    const powerInfo = design.budgets?.power;
    const powerText = powerInfo?.thrustScalingFactor !== null && powerInfo?.thrustScalingFactor < 1.0
      ? `<div class="fp-refit__power fp-refit__power--scaled" title="${attr(powerInfo.summary)}">
          <span class="ra-tag ra-tag--warn">Power scaled to ${attr(dec(powerInfo.thrustScalingFactor * 100, 0))}% thrust</span>
        </div>`
      : '';

    return `
      <div class="fp-refit-card" data-design-id="${attr(design.designId)}">
        <div class="fp-refit-card__head">
          <div class="fp-refit-card__title">
            <strong>${escapeHtml(design.displayName || design.designId)}</strong>
            <small>${escapeHtml(design.hull || 'Hull')}</small>
          </div>
          <div class="fp-refit-card__role">${roleBadge}</div>
        </div>
        <div class="fp-refit-card__body">
          ${driveText}
          ${weaponText}
          ${armorText}
          ${powerText}
        </div>
        <div class="fp-refit-card__foot">
          <button type="button" class="init-btn fp-refit-card__btn" data-refit-details="${attr(design.designId)}">Refit details</button>
        </div>
      </div>
    `;
  }

  function render(container, payload, refitPayload = null) {
    if (!container) return;

    // Normalize if payload carries both
    const procurementPayload = payload?.procurement ? payload.procurement : payload;
    const refits = refitPayload || payload?.refit || null;

    let procurementHtml = '';
    if (!procurementPayload || procurementPayload.success === false || !procurementPayload.military) {
      procurementHtml = `
        <div class="fleet-procurement">
          <div class="tech-card-header">
            <div class="tech-card-title">FLEET PROCUREMENT</div>
            <span>ALREADY UNLOCKED</span>
          </div>
          <p class="research-advisor__empty">PROCUREMENT DATA UNAVAILABLE</p>
          <p class="ra-census">The ranking endpoint did not answer for this snapshot.</p>
        </div>
      `;
    } else {
      const procurement = procurementPayload.military.procurement;
      const items = (procurement && procurement.items) || [];
      const count = num(procurement && procurement.count) ?? items.length;
      const label = (procurement && procurement.label) || 'Already unlocked, not in service';

      if (items.length === 0) {
        procurementHtml = `
          <div class="fleet-procurement">
            <div class="tech-card-header">
              <div class="tech-card-title">FLEET PROCUREMENT</div>
              <span>0 UNFIELDED</span>
            </div>
            <div class="fp-body">
              <p class="ra-empty-group">All researched components and ship hulls are currently in service across your fleet.</p>
            </div>
          </div>
        `;
      } else {
        const itemsShown = items.length;
        const omittedCount = Math.max(0, count - itemsShown);
        const truncationNote = omittedCount > 0
          ? `<p class="ra-census">${escapeHtml(`${int(itemsShown)} shown · ${int(omittedCount)} omitted`)}</p>`
          : '';

        procurementHtml = `
          <div class="fleet-procurement">
            <div class="tech-card-header">
              <div class="tech-card-title">FLEET PROCUREMENT</div>
              <span>${escapeHtml(`${int(count)} unfielded`)}</span>
            </div>
            <div class="fp-body">
              <div class="ra-procurement fp-procurement">
                <div class="ra-procurement__head fp-procurement__head">
                  <span>${escapeHtml(label)}</span>
                  <small>${escapeHtml(`${int(count)} unfielded`)}</small>
                </div>
                <ul class="ra-group__list fp-group__list">
                  ${items.map(renderProcurementRow).join('')}
                </ul>
                ${truncationNote}
              </div>
            </div>
            <div class="ra-foot fp-foot">
              <span>Zero research cost · ready for shipyard build or refit</span>
              <button type="button" class="init-btn ra-foot__btn" data-fleet-procurement-full>Full breakdown</button>
            </div>
          </div>
        `;
      }
    }

    // Refit Advisor Section
    let refitHtml = '';
    const refitItems = refits?.items || [];
    if (refits && refits.success !== false && refitItems.length > 0) {
      refitHtml = `
        <div class="tech-card init-view__span fp-refit-section">
          <div class="tech-card-header">
            <div class="tech-card-title">VALIDATED REFIT ADVISOR</div>
            <span>${escapeHtml(`${int(refitItems.length)} FLEET DESIGNS EVALUATED`)}</span>
          </div>
          <div class="tech-card-body">
            <div class="fp-refit-notice">
              <span>Drive figures hold dry mass constant. Combined drive + weapon + armour swaps yield uncomputable mass.</span>
            </div>
            <div class="fp-refit-grid">
              ${refitItems.map(renderRefitDesignCard).join('')}
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="fleet-dashboard-layout">
        ${procurementHtml}
        ${refitHtml}
      </div>
    `;

    const procurementBtn = container.querySelector('[data-fleet-procurement-full]');
    if (procurementBtn) procurementBtn.addEventListener('click', () => openProcurementDetails(procurementPayload));

    if (refits && refitItems.length > 0) {
      container.querySelectorAll('[data-refit-details]').forEach(btn => {
        const dId = btn.getAttribute('data-refit-details');
        const dRow = refitItems.find(item => item.designId === dId);
        if (dRow) {
          btn.addEventListener('click', () => openRefitDetails(dRow));
        }
      });
    }
  }

  async function fetchProcurement(observerId, mode) {
    const observer = encodeURIComponent(String(observerId));
    const intelMode = encodeURIComponent(String(mode));
    try {
      const [procurementRes, refitRes] = await Promise.all([
        fetch(`/api/intel/research-ranking?observer=${observer}&mode=${intelMode}&detail=full`),
        fetch(`/api/intel/refit-advisor?observer=${observer}&mode=${intelMode}&detail=full`)
      ]);
      const procurement = procurementRes.ok ? await procurementRes.json() : null;
      const refit = refitRes.ok ? await refitRes.json() : null;
      return { procurement, refit, military: procurement?.military || null };
    } catch (err) {
      console.warn('[FleetProcurement] Failed to fetch fleet procurement or refit data:', err);
      return null;
    }
  }

  global.MissionControlFleetProcurement = {
    render,
    fetchProcurement,
    renderRefitDesignCard
  };
})(window);
