import { isAadhaar, isCardNumber, isGstin, isPan, isIfsc, isIndianMobile, isVerhoeffValid } from './checksums.ts';

// Build a Verhoeff-valid 12-digit number so we test against a genuine Aadhaar shape.
const D=[[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P=[[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV=[0,4,3,2,1,5,6,7,8,9];
function checkDigit(base: string){let c=0;for(let i=0;i<base.length;i++){c=D[c][P[(i+1)%8][Number(base[base.length-1-i])]];}return INV[c];}
const base='23456789012', aadhaar = base + checkDigit(base);

const cases: [string, boolean, boolean][] = [
  ['Aadhaar (generated valid)', isAadhaar(aadhaar), true],
  ['Aadhaar w/ spaces',         isAadhaar(aadhaar.replace(/(\d{4})(\d{4})(\d{4})/,'$1 $2 $3')), true],
  ['Aadhaar starting 1',        isAadhaar('1' + aadhaar.slice(1)), false],
  ['Order no. 123456789012',    isAadhaar('123456789012'), false],
  ['Card 4111111111111111',     isCardNumber('4111111111111111'), true],
  ['Card 4111111111111112',     isCardNumber('4111111111111112'), false],
  ['GSTIN 27AAPFU0939F1ZV',     isGstin('27AAPFU0939F1ZV'), true],
  ['GSTIN bad check char',      isGstin('27AAPFU0939F1ZX'), false],
  ['PAN ABCPE1234F',            isPan('ABCPE1234F'), true],
  ['PAN bad holder type (X)',   isPan('ABCXE1234F'), false],
  ['IFSC HDFC0001234',          isIfsc('HDFC0001234'), true],
  ['IFSC no 0 in pos5',         isIfsc('HDFC1001234'), false],
  ['Mobile +91 98765 43210',    isIndianMobile('+91 98765 43210'), true],
  ['Mobile starting 5',         isIndianMobile('5876543210'), false],
];
let fail=0;
for (const [name, got, want] of cases) {
  const ok = got===want;
  if(!ok) fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${name.padEnd(28)} got=${String(got).padEnd(5)} want=${want}`);
}

// The precision claim: how many random 12-digit strings survive the Aadhaar gate?
let survivors=0; const N=100000;
for(let i=0;i<N;i++){
  let s=''; for(let j=0;j<12;j++) s+=Math.floor(Math.random()*10);
  if(isAadhaar(s)) survivors++;
}
console.log(`\nrandom 12-digit strings passing Aadhaar gate: ${survivors}/${N} = ${(survivors/N*100).toFixed(2)}%`);
console.log(`naive /\\d{12}/ would have passed: 100.00%`);
console.log(fail? `\n${fail} FAILURES` : '\nall checksum cases pass');
