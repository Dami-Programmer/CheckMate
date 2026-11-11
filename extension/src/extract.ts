// Injected into the current tab ONLY when the person clicks "Scan this page"
// (activeTab permission). It defines one function; the popup then calls it.
import { extractFromDocument } from "./extract-core.js";

(globalThis as any).__checkmateExtract = () => ({ ...extractFromDocument(document), url: location.href });
