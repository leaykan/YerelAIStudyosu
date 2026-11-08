import React, { memo, useState, useRef, useEffect } from "react";
import { Square, RefreshCw, Sun, Moon, Palette, Check, PanelLeftClose, PanelLeft } from "lucide-react";
import { THEMES } from "../themes";

const truncateModelName = (name) => {
  if (!name || typeof name !== "string") return "";
  let cleanName = name;
  if (name.includes("--")) {
    const parts = name.split("--");
    cleanName = parts[parts.length - 1];
  }
  if (cleanName.length > 25) {
    return cleanName.substring(0, 22) + "...";
  }
  return cleanName;
};

function TopStatusBar({ 
  telemetry, 
  serverRunning, 
  activeModel, 
  isLlmLoaded = false, 
  onStopServer, 
  isStoppingServer = false, 
  theme, 
  setTheme,
  sidebarVisible,
  onToggleSidebar,
  sagEk = null,
}) {
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowThemeMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatGb = (value, { allowZero = false } = {}) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return "--";
    if (number === 0 && !allowZero) return "--";
    return number.toFixed(number >= 10 ? 0 : 1);
  };

  const getStatusText = () => {
    if (isLlmLoaded) return "Model Yüklü (Metin)";
    if (activeModel) return serverRunning ? "Model Yüklü (Görsel)" : "Model Seçili (Görsel)";
    if (serverRunning) return "Sunucu Çalışıyor";
    return "Yerel Mod";
  };

  const getStatusClass = () => {
    if ((activeModel && serverRunning) || isLlmLoaded) return "status-indicator";
    if (activeModel) return "status-indicator busy";
    if (serverRunning) return "status-indicator busy";
    return "status-indicator offline";
  };

  const isDark = (theme || "dark").startsWith("dark");

  return (
    <div className="top-status-bar">
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <button
          onClick={onToggleSidebar}
          className="sidebar-toggle-btn"
          title={sidebarVisible ? "Yan menüyü daralt" : "Yan menüyü genişlet"}
        >
          {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>

        <div className="current-model-info">
          <div className={getStatusClass()}></div>
          <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
            {getStatusText()}
          </span>
          {(activeModel || (typeof isLlmLoaded === "string" && isLlmLoaded)) && (
            <>
              <span style={{ color: "var(--md-sys-color-outline-variant)" }}>|</span>
              <span 
                style={{ color: "var(--md-sys-color-primary)", fontWeight: 700 }}
                title={activeModel || isLlmLoaded}
              >
                {truncateModelName(activeModel || isLlmLoaded)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="telemetry-group" style={{ position: "relative" }}>
        {serverRunning && (
          <button
            className="m3-btn m3-btn-error"
            style={{ height: "34px", padding: "0 14px" }}
            onClick={onStopServer}
            disabled={isStoppingServer}
            title="Yerel model sunucusunu durdur"
          >
            {isStoppingServer ? <RefreshCw className="progress-spinner" size={14} /> : <Square size={14} />}
            <span>{isStoppingServer ? "Durduruluyor" : "Sunucuyu Durdur"}</span>
          </button>
        )}

        {/* Ağ kalkanı göstergesi (CPU'nun yanında). Tema seçimi Ayarlar'da. */}
        {sagEk}

        {/* CPU Telemetry Chip */}
        <div className="telemetry-chip" title="CPU kullanımı">
          <span>CPU: {Number.isFinite(Number(telemetry.cpu_usage)) ? telemetry.cpu_usage : "--"}%</span>
        </div>

        {/* RAM Telemetry Chip */}
        <div className="telemetry-chip" title="Sistem belleği kullanımı">
          <span>RAM: {formatGb(telemetry.ram_used_gb)} / {formatGb(telemetry.ram_total_gb)} GB</span>
        </div>

        {/* GPU VRAM Telemetry Chip */}
        {telemetry.vram_total_gb > 0 && (() => {
          // Tümleşik ekran kartlarının ayrı belleği yoktur; sürücünün bildirdiği
          // değer sistem RAM'inden paylaşılan kısımdır.
          const tumlesik = /intel.*(hd|uhd|iris)|radeon\(tm\) graphics|vega \d+ graphics/i.test(telemetry.gpu_name || "");
          return (
            <div
              className="telemetry-chip"
              title={tumlesik
                ? `${telemetry.gpu_name}: ayrı ekran belleği yok. Bu değer sürücünün kullanabileceği, RAM'den paylaşılan bellektir.`
                : `${telemetry.gpu_name} ekran belleği`}
            >
              <span>{tumlesik ? "GPU (paylaşımlı)" : "VRAM"}: {formatGb(telemetry.vram_used_gb, { allowZero: true })} / {formatGb(telemetry.vram_total_gb)} GB</span>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default memo(TopStatusBar);
