import { createRoot } from "react-dom/client";
import { LibraryList } from "../../components/organisms/LibraryList";
import { recordBrowserPrincipal } from "../../lib/browser-principal-state";
import { fixtureOwner } from "./library-fixture-api";
import "../../design-system/tokens.css";

recordBrowserPrincipal(fixtureOwner);
createRoot(document.getElementById("root")!).render(
  <main style={{ fontFamily: "Arial, sans-serif", maxWidth: 800, margin: "0 auto", padding: 12 }}>
    <h1>My work</h1>
    <p>Synthetic library for local browser verification.</p>
    <LibraryList userId={fixtureOwner} />
  </main>,
);
