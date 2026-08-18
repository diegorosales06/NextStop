/** Shared MVP roster constants — kept in sync with ../mvp_config.py at the
 *  repo root. Update both together. */

export const MVP_YEAR_ID = 76 // 2026-27

export const MVP_SENDING_IDS = [
  { id: 62,  code: 'MTSAC',  name: 'Mt. San Antonio College' },
  { id: 64,  code: 'RIOHONDO', name: 'Rio Hondo College' },
  { id: 49,  code: 'PCC',    name: 'Pasadena City College' },
  { id: 113, code: 'DEANZA', name: 'De Anza College' },
  { id: 137, code: 'SMC',    name: 'Santa Monica College' },
  { id: 134, code: 'FULLC',  name: 'Fullerton College' },
] as const

export const MVP_RECEIVING_IDS = [
  { id: 79,  code: 'UCB',   name: 'UC Berkeley' },
  { id: 89,  code: 'UCD',   name: 'UC Davis' },
  { id: 120, code: 'UCI',   name: 'UC Irvine' },
  { id: 117, code: 'UCLA',  name: 'UC Los Angeles' },
  { id: 144, code: 'UCM',   name: 'UC Merced' },
  { id: 46,  code: 'UCR',   name: 'UC Riverside' },
  { id: 7,   code: 'UCSD',  name: 'UC San Diego' },
  { id: 128, code: 'UCSB',  name: 'UC Santa Barbara' },
  { id: 132, code: 'UCSC',  name: 'UC Santa Cruz' },
  { id: 75,  code: 'CPP',   name: 'Cal Poly Pomona' },
  { id: 129, code: 'CSUF',  name: 'CSU Fullerton' },
  { id: 81,  code: 'CSULB', name: 'CSU Long Beach' },
  { id: 11,  code: 'CPSLO', name: 'Cal Poly SLO' },
] as const
