import { createRoot } from "react-dom/client";
import App from "./App";
// Bundled with the app so it looks the same with no internet connection.
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/500.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "@fontsource/open-sans/800.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
