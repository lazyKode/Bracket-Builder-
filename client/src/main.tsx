import { createRoot } from "react-dom/client";
import App from "./App";
import { startOfflineCopy } from "./lib/offline-copy";
// Bundled with the app so it looks the same with no internet connection.
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/500.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "@fontsource/open-sans/800.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Installable web version: keep a copy of the whole app on the device so it works offline.
startOfflineCopy();
