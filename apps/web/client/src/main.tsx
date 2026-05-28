import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { getPublicLegalPage } from "./LegalPages.js";
import "./styles.css";

const root = document.getElementById("root");
const publicLegalPage = getPublicLegalPage(window.location.pathname);

if (root) {
    createRoot(root).render(
        <StrictMode>
            {publicLegalPage ?? <App />}
        </StrictMode>,
    );
}
