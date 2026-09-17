/**
 * Build a held-out corpus on markup NOBODY ON THIS TEAM WROTE.
 *
 * THE PROBLEM THIS SOLVES
 * Every scored page in this project is a fixture we authored, including the two held-out
 * ones. They were written before the first scoring run and have never been tuned against,
 * which is a real discipline, but it is not the same as being drawn from an independent
 * distribution. A reader is entitled to say that we wrote our own exam. On the four real
 * websites we captured, recall cannot be scored at all, because we have no ground truth
 * for a stranger's page and no right to invent one.
 *
 * THE METHOD
 * Take a real captured page, keep its DOM exactly as it is, and inject a small block of
 * synthetic personal data with known ids into it. The values and their labels are ours,
 * because they have to be if the ground truth is to be exact. Everything the extractor
 * has to fight through -- thousands of nodes, real class names, nested wrappers, inline
 * SVG, cookie banners, lazy images, whatever the site happens to do -- is not ours.
 *
 * That is the half that actually breaks things. A form in a hand-written 30-node fixture
 * and the same form buried in a 6,000-node React tree are not the same test, and the
 * second is the one the finale will present.
 *
 * WHAT IT DOES NOT CLAIM
 * This is not real users' data, and it does not pretend the injected block is typical of
 * how these particular sites lay out their forms. It measures one thing: whether
 * detection and redaction survive contact with real-world markup. Section 5 says so
 * plainly rather than letting the word "real" do more work than it has earned.
 *
 * Every value below is synthetic. The PAN, Aadhaar and card numbers are checksum-valid
 * so that the detector's checksum layers are genuinely exercised, and none of them
 * belongs to anybody.
 *
 *   node bench/make-wild-holdout.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const SRC = new URL('./realpages/', import.meta.url);
const OUT = new URL('./holdout-wild/', import.meta.url);

/**
 * Four blocks, one per host page, so a single detector quirk cannot carry the whole
 * corpus. Ids are prefixed `wh_` to avoid colliding with anything the host page uses.
 *
 * Each block deliberately mixes values that MUST be redacted with decoys that must NOT:
 * a Verhoeff-valid number that is an application reference, a Luhn-valid number that is
 * a tracking id, a label cell whose text is a person's job title. Over-redaction is
 * scored as heavily as leaking, and a corpus with no decoys measures only half of it.
 */
const BLOCKS = [
  {
    host: 'hn.html', name: 'wild-hn',
    heading: 'Account verification',
    rows: [
      ['wh_name',  'Full Name',        'Ananya Krishnamurthy', 'NAME',     true],
      ['wh_pan',   'PAN',              'ABCPE1234F',           'PAN',      true],
      ['wh_email', 'Email',            'a.krishna@example.in', 'EMAIL',    true],
      ['wh_ref',   'Application Ref',  '123456789012',         null,       false,
       'reference number, not a personal identifier'],
    ],
  },
  {
    host: 'python_org.html', name: 'wild-python',
    heading: 'Payment details',
    rows: [
      ['wh_card',  'Card Number',      '4111 1111 1111 1111',  'CARD',     true],
      ['wh_pin',   'Payment PIN',      'hunter2',              'PASSWORD', true],
      ['wh_mob',   'Mobile Number',    '+91 98765 43210',      'PHONE',    true],
      ['wh_awb',   'Tracking (AWB)',   '4539578763621486',     null,       false,
       'Luhn-valid decoy: an airway bill, not a card'],
    ],
  },
  {
    host: 'rbi.html', name: 'wild-rbi',
    heading: 'Beneficiary registration',
    rows: [
      ['wh_aad',   'Aadhaar Number',   '234567890124',         'AADHAAR',  true],
      ['wh_ifsc',  'IFSC Code',        'HDFC0001234',          'IFSC',     true],
      ['wh_addr',  'Billing Address',  '12 MG Road, Indore 452001', 'ADDRESS', true],
      ['wh_amt',   'Sanctioned Amount','999999999999',         null,       false,
       'Verhoeff-valid decoy: a rupee figure, not an Aadhaar'],
    ],
  },
  {
    host: 'wikipedia.html', name: 'wild-wikipedia',
    heading: 'Grievance contact',
    rows: [
      ['wh_gst',   'GSTIN',            '27AAPFU0939F1ZV',      'GSTIN',    true],
      ['wh_nm2',   'Officer Name',     'Rajeshwari Balakrishnan', 'NAME',  true],
      ['wh_em2',   'Contact Email',    'grievance.cell@example.in', 'EMAIL', true],
      ['wh_desig', 'Designation',      'Deputy General Manager', null,     false,
       'a job title, not a person'],
    ],
  },

  // Six more real pages, added to widen the corpus. Twelve labelled values could not
  // separate a good system from a lucky one: by the rule of three, zero misses in twelve
  // still permits a true miss rate of 25%. These pages were chosen for the awkwardness of
  // their markup, and two of them are Wikipedia and ClearTax articles ABOUT Indian
  // identifiers, so their prose is already full of PAN-shaped and GSTIN-shaped strings
  // that must NOT be redacted.
  {
    host: 'india_gov.html', name: 'wild-indiagov',
    heading: 'Citizen service request',
    rows: [
      ['wh_n3',    'Applicant Name',   'Devika Ramachandran',  'NAME',     true],
      ['wh_a3',    'Aadhaar Number',   '345678901238',         'AADHAAR',  true],
      ['wh_p3',    'Mobile Number',    '+91 90123 45678',      'PHONE',    true],
      ['wh_e3',    'Email',            'd.ramachandran@example.in', 'EMAIL', true],
      ['wh_ad3',   'Residential Address', '44 Lodhi Estate, New Delhi 110003', 'ADDRESS', true],
      ['wh_sch3',  'Scheme Code',      '567890123458',         null,       false,
       'Verhoeff-valid decoy: a scheme code, not an Aadhaar'],
      ['wh_off3',  'Issuing Office',   'Regional Passport Office', null,   false,
       'an office, not a person'],
    ],
  },
  {
    host: 'uidai.html', name: 'wild-uidai',
    heading: 'Enrolment update',
    rows: [
      ['wh_n4',    'Resident Name',    'Pranav Venkataraman',  'NAME',     true],
      ['wh_a4',    'Aadhaar Number',   '456789012341',         'AADHAAR',  true],
      ['wh_p4',    'Registered Mobile','+91 88776 65544',      'PHONE',    true],
      ['wh_pan4',  'PAN',              'BQRPK4821M',           'PAN',      true],
      ['wh_pw4',   'Portal Password',  'correcthorse',         'PASSWORD', true],
      ['wh_enr4',  'Enrolment ID',     '1234/56789/01234',     null,       false,
       'enrolment id, not an Aadhaar number'],
      ['wh_ctr4',  'Enrolment Centre', 'Bandra East Centre',   null,       false,
       'a place, not a person'],
    ],
  },
  {
    host: 'mygov.html', name: 'wild-mygov',
    heading: 'Volunteer registration',
    rows: [
      ['wh_n5',    'Full Name',        'Aishwarya Subramanian','NAME',     true],
      ['wh_e5',    'Email',            'a.subramanian@example.in', 'EMAIL', true],
      ['wh_p5',    'Contact Number',   '+91 99887 76655',      'PHONE',    true],
      ['wh_pan5',  'PAN',              'CDEPS7391L',           'PAN',      true],
      ['wh_post5', 'Post Reference',   '678901234560',         null,       false,
       'Verhoeff-valid decoy: a post reference, not an Aadhaar'],
      ['wh_dept5', 'Department',       'Ministry of Education', null,      false,
       'an organisation, not a person'],
    ],
  },
  {
    host: 'sebi.html', name: 'wild-sebi',
    heading: 'Investor grievance',
    rows: [
      ['wh_n6',    'Investor Name',    'Meenakshi Raghavendra','NAME',     true],
      ['wh_pan6',  'PAN',              'DFGPR5024N',           'PAN',      true],
      ['wh_ifsc6', 'Bank IFSC',        'ICIC0004567',          'IFSC',     true],
      ['wh_e6',    'Email',            'm.raghavendra@example.in', 'EMAIL', true],
      ['wh_circ6', 'Circular Number',  'SEBI/HO/MIRSD/2024/117', null,     false,
       'a circular reference, not an identifier of a person'],
      ['wh_amt6',  'Claim Amount',     '789012345674',         null,       false,
       'Verhoeff-valid decoy: a rupee claim, not an Aadhaar'],
    ],
  },
  {
    host: 'cleartax.html', name: 'wild-cleartax',
    heading: 'Return filing details',
    rows: [
      ['wh_n7',    'Assessee Name',    'Harikrishnan Nambiar', 'NAME',     true],
      ['wh_pan7',  'PAN',              'EGHPN6135Q',           'PAN',      true],
      ['wh_card7', 'Card Number',      '5555 5555 5555 4444',  'CARD',     true],
      ['wh_ad7',   'Address',          '9 Residency Road, Bengaluru 560025', 'ADDRESS', true],
      ['wh_ay7',   'Assessment Year',  '2026-27',              null,       false,
       'a tax year, not a personal value'],
      ['wh_sec7',  'Section',          '80C',                  null,       false,
       'a section of the Act, not an identifier'],
    ],
  },
  {
    host: 'wiki_pan.html', name: 'wild-wikipan',
    heading: 'Correction request',
    rows: [
      ['wh_n8',    'Name on Card',     'Lakshmi Narasimhan',   'NAME',     true],
      ['wh_pan8',  'PAN',              'FHIPQ8246R',           'PAN',      true],
      ['wh_gst8',  'GSTIN',            '29AAGCB1286Q1ZT',      'GSTIN',    true],
      ['wh_e8',    'Email',            'l.narasimhan@example.in', 'EMAIL', true],
      ['wh_p8',    'Mobile',           '+91 77665 54433',      'PHONE',    true],
      ['wh_form8', 'Form Number',      'Form 49A',             null,       false,
       'a form name, not an identifier of a person'],
    ],
  },
];


mkdirSync(OUT, { recursive: true });
const available = new Set(readdirSync(SRC).filter((f) => f.endsWith('.html')));
let made = 0;

for (const block of BLOCKS) {
  if (!available.has(block.host)) {
    console.log(`  skip ${block.name}: ${block.host} not captured`);
    continue;
  }
  const host = readFileSync(new URL(block.host, SRC), 'utf8');

  const fields = block.rows.map(([id, label, value]) =>
    `<p><label for="${id}">${label}</label>`
    + `<input id="${id}" name="${id}" value="${value}"></p>`).join('\n    ');

  const injected =
    `\n<section id="wh_block">\n    <h2>${block.heading}</h2>\n    ${fields}\n`
    + `    <button id="wh_submit">Submit</button>\n</section>\n`;

  // Inject before </body> so the block sits INSIDE the host's real document, inheriting
  // its stylesheets, its ancestors and its node budget. Appending after </body> would
  // land it in a tidy corner and test nothing.
  const idx = host.toLowerCase().lastIndexOf('</body>');
  const out = idx === -1 ? host + injected
                         : host.slice(0, idx) + injected + host.slice(idx);

  writeFileSync(new URL(`${block.name}.html`, OUT), out);
  writeFileSync(new URL(`${block.name}.truth.json`, OUT), JSON.stringify({
    name: block.name,
    note: `HELD OUT. Real markup from ${block.host}; injected block is synthetic. `
        + 'Do not tune against this file.',
    elements: block.rows.map(([id, , , kind, redact, why]) =>
      why ? { id, kind, redact, why } : { id, kind, redact }),
    mustFind: ['Submit'],
    mustNotFind: [],
    visionQueueMin: 0,
  }, null, 1) + '\n');

  const n = block.rows.filter((r) => r[4]).length;
  console.log(`  ${block.name.padEnd(16)} <- ${block.host.padEnd(18)} `
            + `${block.rows.length} fields, ${n} to redact`);
  made += 1;
}

const values = BLOCKS.reduce((a, b) => a + b.rows.filter((r) => r[4]).length, 0);
console.log(`\nwrote ${made} pages, ${values} personal values to find, `
          + `${BLOCKS.reduce((a, b) => a + b.rows.length, 0) - values} decoys`);
