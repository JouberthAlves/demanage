export const BRAND_ASCII = `
      _      __  __                                   
   __| | ___|  \\/  | __ _ _ __   __ _  __ _  ___ 
  / _\` |/ _ \\ |\\/| |/ _\` | '_ \\ / _\` |/ _\` |/ _ \\
 | (_| |  __/ |  | | (_| | | | | (_| | (_| |  __/
  \\__,_|\\___|_|  |_|\\__,_|_| |_|\\__,_|\\__, |\\___|
                                      |___/       
`

export function printBrand() {
  console.log(`%c${BRAND_ASCII}`, "color: #FFB800; font-family: monospace;")
}
