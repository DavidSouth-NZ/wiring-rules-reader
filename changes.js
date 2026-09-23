// NZ quick reference: the biggest changes from AS/NZS 3000:2007 to AS/NZS 3000:2018 (incl. Amendments 1–3).
// Written for this app as a summary to find the right clause fast. It is not the Standard's wording,
// and the clause itself always governs. Sources: the Standard's preface ("Changes in this edition"),
// its NZ-only clauses and amendment control sheet, and the Electricity (Safety) Amendment Regulations 2025.
// Tags: nz = New Zealand-only requirement, regs = modified by NZ regulations, new = new in 2018, amd = changed by an amendment.

export const NZ_DATES = {
  cited: '2025-11-13',       // 2018 edition cited in the Electricity (Safety) Regulations 2010
  mandatory: '2026-11-13',   // new work starting on/after this date must use 2018
  lastOld: '2026-11-12'      // work started after 13 Nov 2025 under 2007 must be finished by this date
};

export const TIMELINE = [
  { when: '13 Nov 2025', what: 'The 2018 edition (with Amendments 1–3) is cited in the Electricity (Safety) Regulations, with NZ modifications. You can use it from this date.' },
  { when: '13 Nov 2025 – 12 Nov 2026', what: 'Transition year. Work started in this period under the 2007 edition must be finished by 12 Nov 2026. Otherwise, certify what is done and complete the rest to the 2018 edition.' },
  { when: 'From 13 Nov 2026', what: 'New work must comply with the 2018 edition.' },
  { when: 'Any time', what: 'Existing installations do not have to be upgraded. Repairs can follow the edition the installation was built to. Alterations and additions follow the new edition for the parts that change.' }
];

export const REGS_MODS = [
  { refs: ['Clause 1.5.6.3'], text: 'Added: every RCD must suit the loads it will see, including pulsating or smooth d.c. fault currents and waveform distortion.' },
  { refs: ['Clause 2.6.2.2.3'], text: 'RCD type: Type A (IEC 61008.1 / 61009.1), or Type F or Type B (IEC 62423). The requirement to break all live conductors stays.' },
  { refs: ['Clause 2.6.3.3.2'], text: 'Exception 2, second bullet deleted. Socket-outlets marked for IT or cleaning equipment in junior education and childcare areas no longer escape 10 mA RCD protection.' },
  { refs: ['Clause 2.6.3.3.3'], text: 'Home care medical installations built to AS/NZS 3003 do not also need to meet the residential RCD clause 2.6.3.3.1.' },
  { refs: ['Clause 8.3.10'], text: 'Pressing the RCD’s integral test button no longer counts as verifying it. Use test equipment. Note 4 is deleted.' },
  { refs: ['Clause 4.18.2.3', 'Clause 4.18.5'], text: 'Gas clauses and figures: “hazardous area” is renamed “exclusion zone”, and “lighter-than-air” is dropped from the 4.18.5 heading.' },
  { refs: ['Clause 1.6.2', 'Clause 2.3.2.1.2'], text: 'Clause 1.6.2(c) note (b) (NZ supply voltage tolerance) is deleted, and items (b) and (c) of 2.3.2.1.2 are deleted. Read these clauses together with the regulations.' }
];

// Pinned at the top of the Changes tab: things that catch people out on site.
export const HIGHLIGHTS = [
  {
    head: 'Flush switchboards in internal walls: earthed steel back plate',
    text: 'In a flush-mounted board in an internal wall, the live parts at the back of the board end up within 50 mm of the surface on the other side of the wall. Clause 3.9.4.2 (changed in 2018) says wiring fixed within 50 mm of a surface must be protected by a method from 3.9.4.4, and Figure 3.3 shows this can apply at the rear of equipment such as switchboards. A plastic back gives no protection against a screw or nail from the other side. The usual answer is an earthed steel back plate: method (b), an earthed metal covering that makes the circuit protection operate if it is pierced. A 30 mA RCD, method (c), can’t protect the incoming side of the board ahead of the RCDs.',
    bullets: [
      'Fit the manufacturer’s steel back plate to plastic-backed flush boards in internal walls, and connect it to the earth bar.',
      'Other allowed methods: WSX3 mechanical protection (a) or 30 mA RCD protection (c) where these actually cover the parts at risk.',
      'Surface-mounted boards, and boards on an external wall with nothing within 50 mm behind them, may not need it. Check against 3.9.4.2.'
    ],
    refs: ['Clause 3.9.4.2', 'Clause 3.9.4.4', 'Figure 3.3'],
    source: { label: 'Vynco Industries (manufacturer guidance)', url: 'https://www.facebook.com/vyncoindustriesltd/posts/installing-a-domestic-switchboardfollowing-changes-to-asnzs-30002018-wiring-rule/1690384783095614/' }
  }
];

export const TOPICS = [
  {
    title: 'RCDs',
    items: [
      { tags: ['nz'], head: 'Residential: 30 mA on every socket, light and hand-held circuit', text: 'Final subcircuits supplying socket-outlets, lighting points or directly connected hand-held equipment need 30 mA RCDs, fitted at the switchboard where the circuit starts. Fans, combination fan/light/heater units and smoke alarms count as lighting points.', refs: ['Clause 2.6.3.3.1'] },
      { tags: ['nz', 'regs'], head: 'Type A (or F/B) and break all live conductors', text: 'In NZ, RCDs must switch active and neutral. The regulations allow Type A, F or B.', refs: ['Clause 2.6.2.2.3'] },
      { tags: [], head: 'No more than 3 circuits per RCD', text: 'In residential installations: at most three final subcircuits per RCD, at least two RCDs when there is more than one circuit, and lighting circuits split across RCDs.', refs: ['Clause 2.6.2.4'] },
      { tags: ['nz'], head: 'Schools, childcare and public areas', text: '30 mA on sockets up to 30 A in schools (to Year 13), kindergartens, daycare and teaching areas. 10 mA on sockets where young children are taught or cared for. 30 mA outdoors, in public-access areas and arcades, and for vending machines and children’s rides.', refs: ['Clause 2.6.3.3.2'] },
      { tags: ['nz'], head: 'Alterations: board replacement and added sockets', text: 'If all the circuit protection on a board is replaced, its final subcircuits need RCDs to this clause. Sockets added to an existing circuit need RCD protection, which can be fitted at the start of the new wiring. Replacing an existing socket like-for-like is exempt.', refs: ['Clause 2.6.3.3.4'] },
      { tags: [], head: 'Test RCDs with an instrument', text: 'Every RCD is tested, and isolation of all switched poles is confirmed after it trips. In NZ the test button alone is no longer enough (see the regulation changes above).', refs: ['Clause 8.3.10'] }
    ]
  },
  {
    title: 'Arc fault detection (AFDDs)',
    items: [
      { tags: ['nz', 'new'], head: 'AFDDs are compulsory in some NZ locations', text: 'Final subcircuits of 20 A or less need an AFDD at the switchboard in locations where stored or processed materials are a fire risk (barns, woodworking shops), locations holding irreplaceable items, and historic buildings built mostly of flammable materials. School dormitory socket circuits need one too.', refs: ['Clause 2.9.7', 'Clause 2.9.4'] },
      { tags: ['new'], head: 'Device rules and guidance', text: 'AFDDs must comply with IEC 62606 and be rated at least as high as the circuit protection. Consider them when altering old or vermin-damaged wiring. Appendix O gives guidance.', refs: ['Clause 2.9.2', 'Clause 2.9.5', 'App O'] }
    ]
  },
  {
    title: 'Switchboards',
    items: [
      { tags: ['new'], head: 'Flush boards: protect the back', text: 'Plastic-backed flush boards in internal walls need an earthed steel back plate (or another 3.9.4.4 method), because the back sits within 50 mm of the far wall surface. See the highlight at the top of this tab.', refs: ['Clause 3.9.4.2', 'Clause 3.9.4.4'] },
      { tags: ['amd'], head: 'Internal arcing faults', text: 'Protection against internal arcing faults in switchboards is stronger, and Amendment 3 revised it again.', refs: ['Clause 2.5.5'] },
      { tags: [], head: 'Access, clearances and switchrooms', text: 'Clearance drawings are updated. Boards of 800 A or more have added rules for access and egress, switchroom door sizes and clearances.', refs: ['Clause 2.10.2'] },
      { tags: ['new'], head: 'Switchboard checklist', text: 'Appendix K is a new summary of switchboard requirements.', refs: ['App K'] },
      { tags: [], head: 'Main switch and origin of circuits', text: 'New rules cover how main switches operate and where submains and final subcircuits originate, and clarify where overload devices may sit.', refs: ['Clause 2.3.3', 'Clause 2.5.3'] }
    ]
  },
  {
    title: 'Earthing and bonding',
    items: [
      { tags: [], head: 'MEN link must be accessible', text: 'The MEN system is defined more clearly, and the MEN connection must be in an accessible position.', refs: ['Clause 5.3.5', 'Clause 1.4.83'] },
      { tags: [], head: 'Earth electrodes', text: 'The list of acceptable earth electrode types is updated.', refs: ['Clause 5.3.6', 'Table 5.2'] },
      { tags: [], head: 'Showers, bathrooms, pools and spas', text: 'Equipotential bonding is expanded. Pools need a bonding connection point regardless of other requirements, and Figure 5.9 shows the arrangement.', refs: ['Clause 5.6.2.5', 'Clause 5.6.2.6', 'Figure 5.9'] },
      { tags: [], head: 'Outbuildings', text: 'Earthing requirements for individual and combined outbuildings are new, including conductive reinforcing in outbuildings with showers or baths.', refs: ['Clause 5.5.3.1', 'Clause 1.4.88'] }
    ]
  },
  {
    title: 'Cables and wiring',
    items: [
      { tags: ['nz'], head: 'Assume insulation will be added', text: 'In NZ homes, install appliances and accessories as if ceilings, walls and floors will be insulated in the future, even if they aren’t yet.', refs: ['Clause 4.2.2.7'] },
      { tags: [], head: 'Cables through bulk thermal insulation', text: 'Installation requirements for cables that pass through bulk thermal insulation are improved.', refs: ['Clause 3.3.2.13'] },
      { tags: [], head: 'Conductor colours', text: 'Colour identification of active, neutral and earth conductors is clarified, including green/yellow and alternative European colours.', refs: ['Clause 3.8.2', 'Clause 3.8.3.4', 'Table 3.4'] },
      { tags: [], head: 'Segregation', text: 'Segregation of different installations in common enclosures and of different voltage levels is clarified.', refs: ['Clause 3.9.8.2.2', 'Clause 3.9.8.3'] }
    ]
  },
  {
    title: 'Equipment and appliances',
    items: [
      { tags: [], head: 'Recessed luminaires', text: 'Safety requirements are stronger, and the luminaire classifications are updated. This matters in insulated NZ ceilings.', refs: ['Clause 4.5.2.3', 'Table 4.3'] },
      { tags: ['nz'], head: 'Freestanding cookers: plug or coupler', text: 'In NZ a freestanding cooking appliance connects by socket-outlet or installation coupler. Built-in hobs and ovens are exempt.', refs: ['Clause 4.7.2'] },
      { tags: ['new'], head: '150 mm from cooktops', text: 'No switches or socket-outlets within 150 mm of an open gas or electric cooking surface, in the zone shown in Figure 4.17.', refs: ['Clause 4.7.3', 'Figure 4.17'] },
      { tags: ['new'], head: 'Isolator at every fixed-wired water heater', text: 'An isolating switch is required next to every fixed-wired water heater.', refs: ['Clause 4.8.2.3'] },
      { tags: [], head: 'Heat pumps and aircon', text: 'Isolator rules are clarified, including indoor units supplied separately from the compressor, and there are new exceptions.', refs: ['Clause 4.19'] },
      { tags: ['nz', 'regs'], head: 'Gas cylinders and relief vents', text: 'NZ rules cover gas cylinders indoors and outdoors and electrical equipment near the gas supply. Vent terminals are now called “exclusion zones”.', refs: ['Clause 4.18.1.3', 'Clause 4.18.2.3', 'Clause 4.18.3', 'Clause 4.18.4'] },
      { tags: ['new'], head: 'Outdoor and weather-exposed equipment', text: 'New figures show where IP-rated equipment is needed and how to protect it from the weather.', refs: ['Section 4'] }
    ]
  },
  {
    title: 'Electric vehicles',
    items: [
      { tags: ['nz', 'new'], head: 'EV charging rules (NZ only)', text: 'No Mode 1 socket-outlets. No EV supply from an outbuilding board with its own MEN. A Mode 2 circuit is at least 20 A, dedicated, with the socket at least 800 mm high. A Mode 3/4 circuit is at least 32 A single-phase, dedicated, on its own 30 mA Type B RCD (or Type A plus an RDC-DD for Mode 3).', refs: ['Clause 7.9.2', 'Clause 7.9.3.2', 'Clause 7.9.3.3'] },
      { tags: ['nz', 'new'], head: 'New homes with attached garages', text: 'A new home with a garage built into the dwelling must have an EV charging facility (Mode 2 or Mode 3/4).', refs: ['Clause 7.9.3.1'] },
      { tags: ['new'], head: 'EV guidance', text: 'Appendix P explains charging modes and gives guidance on EV circuits. Allow for EV load in maximum demand.', refs: ['App P', 'Clause 2.2.1.4', 'Table C1'] }
    ]
  },
  {
    title: 'Bathrooms, pools and damp areas',
    items: [
      { tags: [], head: 'Thresholds changed', text: 'The fixed water container threshold drops from 45 L to 40 L. The spa pool/tub threshold rises from 500 L to 680 L.', refs: ['Clause 6.2.2.1', 'Clause 6.3.2.2'] },
      { tags: [], head: 'Shower zones', text: 'Zone 1 is clarified for different shower-head layouts, and a figure for showers with a hinged door is added.', refs: ['Section 6'] },
      { tags: ['new'], head: 'No inverters in zones', text: 'Electricity generation equipment, including inverters, must not be installed in classified zones.', refs: ['Clause 6.2.4.7', 'Clause 6.3.4.7'] }
    ]
  },
  {
    title: 'Solar, batteries and safety services',
    items: [
      { tags: [], head: 'Generation systems', text: 'Rules for PV, inverters and other generation are reviewed to align with the current equipment Standards, including systems with batteries.', refs: ['Clause 7.3', 'Clause 7.3.4.2'] },
      { tags: [], head: 'Safety services restructured', text: 'Clause 7.2 is reorganised. Lifts for general use that aren’t emergency lifts are now covered.', refs: ['Clause 7.2'] }
    ]
  },
  {
    title: 'Testing and records',
    items: [
      { tags: [], head: 'EFLI and RCD testing clarified', text: 'Section 8 now separates general requirements, visual inspection, tests and accepted values. ELV testing has moved into Section 8.', refs: ['Clause 8.3.9', 'Clause 8.3.10', 'Table 8.1'] },
      { tags: ['new'], head: 'Mark the certification date', text: 'The date of initial certification must be permanently marked on or at the main switchboard.', refs: ['Clause 8.4'] }
    ]
  },
  {
    title: 'Structure, terms and appendices',
    items: [
      { tags: [], head: 'New terms', text: '“Direct contact” is now “basic protection” and “indirect contact” is now “fault protection”. IP ratings are revised, and there are new Part 1 solutions.', refs: ['Clause 1.5.3', 'Clause 1.4'] },
      { tags: [], head: 'Alterations and repairs', text: 'The general rules for alterations and repairs are clarified and expanded.', refs: ['Clause 1.9.3'] },
      { tags: ['new'], head: 'New appendices', text: 'M covers power outages for assisted living. N covers conduits. O covers AFDDs. P covers EV circuits. Q covers d.c. circuit protection. C (maximum demand) is expanded. The first aid appendices are removed.', refs: ['App M', 'App N', 'App O', 'App P', 'App Q', 'App C'] }
    ]
  }
];

export const BUILT_IN_AMENDMENTS = [
  { name: 'Amendment 1', date: 'Jan 2020', text: 'Wide revision: switchboards, RCD clauses for Australia and NZ, water heaters, bathrooms, safety services, generation systems and testing.', refs: ['Clause 2.6.3.3.1', 'Clause 2.10.2.2', 'Clause 4.8.2.3', 'Clause 8.2.2'] },
  { name: 'Amendment 2', date: 'Apr 2021', text: 'RCD types (Type A for NZ; Type AC phased out in Australia), switchboard access, gas relief vents, and changes to test recording and RCD testing.', refs: ['Clause 2.6.2.2.3', 'Clause 4.18.4', 'Clause 8.3.2.2', 'Clause 8.3.10'] },
  { name: 'Amendment 3', date: 'May 2023', text: 'Switchboard internal arcing and switchboard clauses, current-carrying capacity, cable identification, socket-outlets, and Appendices A and C.', refs: ['Clause 2.5.5.1', 'Clause 2.10.1', 'Clause 3.4.1', 'Clause 4.4.2.2'] },
  { name: 'Ruling 1', date: '2024', text: 'Interprets where an RCD can be located under the Australia-only clause 2.6.3.2.3.2. It does not affect NZ work.', refs: [] }
];
