// NOTE: The `react-router` and `virtual:load-fonts.jsx` module declarations are
// leftover React Router / Vite scaffolding. This project uses the Next.js App
// Router and does not depend on `react-router` (see package.json), so these
// declarations are unreferenced. Kept for reference only; lint rules are
// disabled inline rather than globally.
import "react-router";
module "virtual:load-fonts.jsx" {
  export function LoadFonts(): null;
}
/* eslint-disable @typescript-eslint/no-empty-object-type */
declare module "react-router" {
  interface AppLoadContext {
    // add context properties here
  }
}
declare module "npm:stripe" {
  import Stripe from "stripe";
  export default Stripe;
}
