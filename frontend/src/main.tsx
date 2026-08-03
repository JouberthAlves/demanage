import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "@/App"
import { printBrand } from "@/lib/brand"

import "@/global.css"

printBrand()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
