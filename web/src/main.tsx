import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Sem StrictMode: ele monta os componentes 2x em dev, o que reinicializa o mapa
// do OpenLayers (biblioteca imperativa) e causa instabilidade.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
