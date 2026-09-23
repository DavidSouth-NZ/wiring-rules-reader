// Guides: step-by-step on-site checklists. To add a guide, add an object to GUIDES.
// Each guide has sections, and each section has steps. A step can have:
//   refs   – clause/table references that open in the Standard (e.g. 'Clause 8.3.9', 'Table 8.1', 'App P')
//   record – { label, unit, pass?: 'min:1' | 'max:1.0' } adds a box to write down a reading
//   zs     – { t: 'C', In: 32 } adds a button that opens the Zs check with that MCB selected
//   warn   – true shows the step in red as a critical point
// These guides are written for this app as working checklists. They are not the Standard's wording:
// always follow the clause, the manufacturer's instructions and your own training.

export const GUIDES = [
  {
    id: 'ev-charger-testing',
    title: 'EV charger: testing and certification (NZ)',
    summary: 'Inspect, test and certify a new EV charger circuit, whether a Mode 3 wallbox or a Mode 2 socket, under AS/NZS 3000:2018 as cited by the NZ regulations.',
    tags: ['EV', 'Testing', 'NZ only'],
    updated: 'September 2026',
    intro: 'Use this for a new dedicated final subcircuit supplying EV charging equipment. Work through it in order: dead tests before livening, then live tests, then the charger’s own safety functions. This is prescribed electrical work. Isolate and prove dead before working, follow the charger manufacturer’s installation and commissioning instructions, and read each linked clause for the full requirement.',
    sections: [
      {
        title: 'Before you start: design checks',
        steps: [
          { text: 'Confirm the charging mode and charger rating. Mode 1 socket-outlets are not permitted in NZ.', refs: ['Clause 7.9.2.2', 'App P'] },
          { text: 'Check the supply source. The circuit must not come from a board in an outbuilding that has its own separate MEN (option (c) of 5.5.3.1). WorkSafe’s January 2026 addendum says a residential charging circuit should come from a MEN switchboard.', refs: ['Clause 7.9.2.1', 'Clause 5.5.3.1'], warn: true },
          { text: 'Check maximum demand can take the charger, and fit load management or upgrade the mains if needed. Tell the electricity distributor if it requires notification.', refs: ['Clause 7.9.1', 'Table C1', 'Table C2'] },
          { text: 'Dedicated final subcircuit that supplies nothing else. Mode 3/4 single-phase needs at least 32 A current-carrying capacity. A Mode 2 socket circuit needs at least 20 A.', refs: ['Clause 7.9.3.2', 'Clause 7.9.3.3'] },
          { text: 'Bidirectional chargers (vehicle-to-home or vehicle-to-grid) are mains parallel generation. That brings in extra requirements (AS/NZS 4777.1, distributor approval, high-risk work inspection). Confirm before quoting.', refs: ['Clause 7.3'], warn: true }
        ]
      },
      {
        title: 'Visual inspection',
        steps: [
          { text: 'RCD: a separate 30 mA Type B (IEC 62423) switching active and neutral, or an RCBO. For Mode 3 only, a 30 mA Type A plus an RDC-DD (IEC 62955) is allowed. If the charger has a built-in RDC-DD, check the manufacturer’s documentation shows it meets IEC 62955.', refs: ['Clause 7.9.3.3', 'Clause 7.9.4', 'Clause 2.6.2.2.3'], warn: true },
          { text: 'Overcurrent protection suits the cable size and installation method.', refs: ['Clause 3.4', 'Clause 2.5.3'] },
          { text: 'Isolating switch rated at least 32 A fitted next to the charger (Mode 3/4).', refs: ['Clause 7.9.3.3', 'Clause 2.3.2.2.1'] },
          { text: 'Charger directly connected (Mode 3/4). The outlet or cable holder is at least 800 mm above the floor or ground.', refs: ['Clause 7.9.3.3', 'Clause 4.3.2.1'] },
          { text: 'IP rating suits the location, the charger is protected from vehicle impact, and cables are protected where needed (including the 50 mm rule).', refs: ['Clause 4.1', 'Clause 3.9.4.2', 'Clause 3.9.4.4'] },
          { text: 'Voltage and frequency on the charger’s data plate match the supply. The supplier has evidence of compliance (EVSE is a medium-risk declared article that needs an SDoC).' },
          { text: 'RCD/RCBO and isolator labelled with their function and the charger’s location.', refs: ['Clause 2.10.5'] }
        ]
      },
      {
        title: 'Dead tests (isolated)',
        steps: [
          { text: 'Earth continuity from the main earth bar to the charger’s earth terminal. The main earthing conductor and bonding must be 0.5 Ω or less. The circuit protective earth should suit its length and size (Table 8.2 gives guidance values).', refs: ['Clause 8.3.5', 'Table 8.2'], record: { label: 'Circuit earth continuity', unit: 'Ω' } },
          { text: 'Insulation resistance at 500 V d.c.: at least 1 MΩ between live conductors and earth. Disconnect or switch off the charger’s electronics and SPDs first, or test that part at 250 V as allowed. A new short run should read well above 50 MΩ.', refs: ['Clause 8.3.6.2', 'Clause 8.3.6.3'], record: { label: 'Insulation resistance', unit: 'MΩ', pass: 'min:1' } },
          { text: 'Polarity and correct circuit connections, through the RCD/RCBO, the isolator and the charger terminals. For a three-phase charger, check phase rotation as well.', refs: ['Clause 8.3.7'] }
        ]
      },
      {
        title: 'Live tests',
        steps: [
          { text: 'Earth fault-loop impedance (Zs) at the charger’s supply terminals or outlet must not exceed Table 8.1 for the protective device. Examples: 32 A Type C is 1.0 Ω, 32 A Type B is 1.8 Ω.', refs: ['Clause 8.3.9', 'Table 8.1'], record: { label: 'Zs at charger', unit: 'Ω' }, zs: { t: 'C', In: 32 } },
          { text: 'Test the RCD with an RCD tester. Under the 2025 NZ regulations, pressing the test button no longer counts. Test at the rated current (30 mA) on both half-cycles and record the trip time.', refs: ['Clause 8.3.10'], record: { label: 'RCD trip time at 30 mA', unit: 'ms' }, warn: true },
          { text: 'Type B RCD: run the smooth d.c. ramp test if your tester has one. It should trip at no more than twice the rated current (60 mA d.c. for a 30 mA device). For Type A plus an RDC-DD: inject 6 mA d.c. and confirm it disconnects.', refs: ['Clause 7.9.3.3'], record: { label: 'd.c. trip current', unit: 'mA' } },
          { text: 'After each RCD trip, confirm every switched pole has opened, including the neutral.', refs: ['Clause 8.3.10'] }
        ]
      },
      {
        title: 'Charger function tests (EV test adapter)',
        steps: [
          { text: 'With an EV test adapter or simulator on the charging connector, step through the vehicle states: no vehicle, then connected, then charging. Confirm the charger switches on only when “charging” is requested.' },
          { text: 'Simulate a lost protective earth (PE fault). The charger must stop or refuse to supply. This checks its earth continuity monitoring.', warn: true },
          { text: 'Simulate a control-pilot fault (error state). The charger must stop supplying.' },
          { text: 'Through the adapter’s test sockets, check voltage, polarity and phase sequence at the connector. Repeat the Zs and RCD tests at the connector if the adapter allows.' },
          { text: 'Set the charger’s maximum current to suit the circuit rating and maximum demand, and set up and test any load management (CT clamp) and emergency stop.' }
        ]
      },
      {
        title: 'Records and certification',
        steps: [
          { text: 'Record all test results with the certification, and issue the Certificate of Compliance and Electrical Safety Certificate to the owner as required by the Electricity (Safety) Regulations.' },
          { text: 'For a new installation, the date of initial certification must be marked permanently on or at the main switchboard.', refs: ['Clause 8.4'] },
          { text: 'Leave the manufacturer’s manual and your settings (current limit, load management) with the owner.' },
          { text: 'Public and workplace chargers: WorkSafe expects a periodic assessment at least every 12 months, with a dated tag on the charger. Keep the assessment records for at least 3 years.' }
        ]
      }
    ],
    sources: [
      { label: 'AS/NZS 3000:2018 Clause 7.9 and Section 8 (your PDF)' },
      { label: 'WorkSafe: Guidelines for safe electric vehicle charging', url: 'https://www.worksafe.govt.nz/laws-and-regulations/regulations/electrical-regulations/regulatory-guidance-notes/electric-vehicle-charging-safety-guidelines/' },
      { label: 'WorkSafe: EV charging safety guidelines, 2nd edition (sections 2.6–2.7, testing and periodic assessment)', url: 'https://www.worksafe.govt.nz/dmsdocument/5169-electric-vehicle-charging-safety-guidelines-2nd-edition/' },
      { label: 'WorkSafe: Addendum to EV charging safety guidelines (January 2026)', url: 'https://www.worksafe.govt.nz/dmsdocument/72327-addendum-to-electric-vehicle-charging-safety-guidelines-3rd-edition/latest/' },
      { label: 'EWRB: Electric vehicle charging installations (December 2025)', url: 'https://www.ewrb.govt.nz/about-us/news-and-notices/electric-vehicle-charging-installations/' },
      { label: 'Electricity (Safety) Amendment Regulations 2025', url: 'https://www.legislation.govt.nz/regulation/public/2025/0225/latest/whole.html' }
    ]
  }
];
