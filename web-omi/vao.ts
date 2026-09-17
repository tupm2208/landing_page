/**
 * @file Entry of the web OMI bundle: the web bridge FIRST (it sets `window.vo`), then OMI's own page.
 * Import order is evaluation order, so `main.ts` finds the bridge when it boots.
 */

import "./cau-noi-web";
import "../../omi/packages/omi-ui/src/main";
