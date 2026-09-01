import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
// 思源黑体：CJK 统一走该字体（typo 度量 0.88/0.12 对称，字形天然垂直居中），
// 避免回落到微软雅黑（win 度量不对称导致中文在按钮里偏下）。参照 orkest-ui。
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/outfit";
import "./styles/global.css";
import App from "./App";
import { I18nProvider } from "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
