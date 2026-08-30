// tests/fixtures/detailPanelRenderBranches.js
//
// Purpose: option bags exercised by detailPanelRendering.test.js for zero-change
//   verification and branch coverage across DetailPanel payload shapes.

module.exports = {
  full: {
    eyebrow: 'RESEARCH PATH',
    title: 'Pion Torch',
    summary: 'Everything still to research before this drive can be fitted.',
    facts: [
      { label: 'FACTION RESEARCH', value: '1,300,325 RP' },
      { label: 'TOTAL REMAINING', value: 'UNKNOWN' },
    ],
    sections: [
      {
        title: 'FACTION PROJECTS',
        caption: '2 remaining · 1,300,325 RP',
        rows: [
          { label: 'Antimatter Beam-Core Torch', sublabel: 'via Antimatter Traps', status: 'LOCKED', statusTone: 'block', meta: '900,000 RP' },
          { label: 'Antimatter Traps', status: 'RESEARCHING 41.2%', statusTone: 'warn', meta: '400,325 RP' },
        ],
      },
      { title: 'GLOBAL TECHS', rows: [], empty: 'No global techs remain on this path.' },
    ],
    notes: ['Availability is rolled monthly and a cleared path is not a startable one.'],
    actions: [{ label: 'Close' }],
  },
  absence: {
    facts: [
      { label: 'MEASURED', value: 0 },
      { label: 'UNMEASURED', value: null },
      { label: 'MISSING' },
    ],
    sections: [
      {
        title: 'ROWS',
        rows: [
          { label: 'has a label', status: 'DONE', statusTone: 'ok' },
          { sublabel: 'no label at all', status: 'DONE' },
          { label: 'unrecognised tone', status: 'ODD', statusTone: 'chartreuse' },
          { label: 'meta dash', status: 'LOCKED', statusTone: 'block', meta: '—' },
        ],
      },
      { title: 'NOTHING HERE', rows: [] },
    ],
    notes: ['   ', '', 42, null],
  },
  factsOnly: {
    eyebrow: 'THEATER DETAIL',
    title: 'Mars Theater',
    summary: 'Active. No visible xenoforming sites are reported in this theater.',
    facts: [
      { label: 'Combined GDP', value: '$12.5T' },
      { label: 'Nations', value: 8 },
      { label: 'Observer control', value: 3 },
      { label: 'Expected Value', value: '—' },
    ],
  },
  ungated: {
    eyebrow: 'RESEARCH PATH',
    title: 'Laser Drive Mk1',
    facts: [
      { label: 'DRIVE', value: 'Laser Drive Mk1' },
      { label: 'GATE PROJECT', value: 'none — this drive names no gating project' },
      { label: 'AVAILABILITY', value: 'Available now' },
    ],
    summary: 'This drive is not gated by any project.',
    notes: ['Nothing unlocks this drive because nothing needs to.'],
  },
  actions: {
    title: 'Actions',
    actions: [
      { label: 'Stay', close: false },
      { label: 'Go', primary: true },
    ],
  },
};
